import { randomUUID } from 'node:crypto';
import { accessError, hashSecret, verifyAccessCode, type AccessCode } from '../access/codes';
import { DomainError } from '../domain-error';
import { mutationSchema, type StoredEvent } from '../model';
import { canMutate } from '../mutation-permissions';
import { readJson } from '../read-json';
import { loadAccessCode } from '../storage/access-records';
import { canonical } from '../storage/cell-write';
import { checkPersistentLoginLimit, LoginRateLimitError, loginClientKey, recordPersistentLoginFailure } from '../storage/login-limit';
import { createNeonRepository, type Sql } from '../storage/neon';
import { createNormalizedRepository } from '../storage/normalized';
import { neonHttp } from '../storage/sql-client';
import { isUndefinedTable } from '../storage/switch';
import { agentError, auditAgentChange, eventStatus, previewMutation, resultChanges } from './api';
import { agentCommandSchema, isAgentAction } from './commands';

const mutationActions = new Set<string>(mutationSchema.options.map((schema) => schema.shape.action.value));

type Operation = 'status' | 'preview' | 'mutations';
type Configuration = { sql: Sql; sessionSecret: string };

function configuration(): Configuration | undefined {
  const { DATABASE_URL, SESSION_SECRET, STORAGE_MODE } = process.env;
  if (!DATABASE_URL || !SESSION_SECRET || (STORAGE_MODE && STORAGE_MODE !== 'neon')) return;
  return { sql: neonHttp(DATABASE_URL), sessionSecret: SESSION_SECRET };
}

function normalizedStorageRequired() {
  return new DomainError('代理 API 寫入需要啟用正規化儲存', 503, 'AGENT_NORMALIZED_STORAGE_REQUIRED');
}

async function assertNormalizedStorage(sql: Sql) {
  const rows = await sql`SELECT mode FROM bridge_storage_switch WHERE id = 1`.catch((error: unknown) => {
    if (isUndefinedTable(error)) throw normalizedStorageRequired();
    throw error;
  });
  if (rows[0]?.mode !== 'normalized') throw normalizedStorageRequired();
}

function forbidden(message: string) {
  return new DomainError(message, 403, accessError.forbiddenRole);
}

function assertEventAccess(stored: StoredEvent, actor: AccessCode) {
  if (actor.organizerId && actor.organizerId !== stored.event.organizerId)
    throw new DomainError('通行碼不適用於這場賽事', 403, 'FORBIDDEN_SCOPE');
  if (actor.role !== 'referee' && (stored.event.stageArchived || stored.event.competition?.archived))
    throw new DomainError('找不到賽事', 404);
}

function revisionConflict() {
  return new DomainError('賽段版本已更新，請重新載入後再提交。', 409, 'stage-revision');
}

function reusedRequest() {
  return new DomainError('此 requestId 已用於另一個冪等鍵', 409, 'REQUEST_ID_CONFLICT');
}

export async function agentRoute(
  operation: Operation,
  request: Request,
  eventId: string,
  config?: Configuration,
) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  try {
    const secret = /^Bearer ([^\s,]{1,200})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    config ??= configuration();
    if (!config) {
      if (!secret) throw new DomainError('請提供有效的通行碼', 401, accessError.codeUnknown);
      if (operation === 'mutations' && (process.env.STORAGE_MODE === 'local' || process.env.STORAGE_MODE === 'demo'))
        throw normalizedStorageRequired();
      throw new DomainError('代理 API 尚未設定資料庫或工作階段密鑰', 503, 'AGENT_STORAGE_UNAVAILABLE');
    }
    const { sql, sessionSecret } = config;
    const client = loginClientKey(request, sessionSecret);
    await checkPersistentLoginLimit(sql, client);
    const candidate = secret ? await loadAccessCode(sql, hashSecret(secret)) : undefined;
    let actor: AccessCode;
    try {
      actor = verifyAccessCode(secret ?? '', candidate ? [candidate] : [], new Date());
    } catch (error) {
      await recordPersistentLoginFailure(sql, client);
      throw error;
    }
    if (actor.scope !== 'event' || !actor.role) throw forbidden('代理操作需要賽事通行碼');
    if (actor.eventId !== eventId)
      throw new DomainError('通行碼不適用於這場賽事', 403, 'FORBIDDEN_SCOPE');

    const writeRepo = operation === 'mutations' ? createNormalizedRepository(sql) : undefined;
    if (writeRepo) await assertNormalizedStorage(sql);
    const repo = writeRepo ?? createNeonRepository(sql);
    const stored = await repo.getEvent(eventId);
    assertEventAccess(stored, actor);
    if (operation === 'status') return respond({ revision: stored.event.revision, ...eventStatus(stored.event) });

    if (actor.role === 'read') throw forbidden('此操作需要收分或裁判權限');

    const body = await readJson(request);
    const key = request.headers.get('idempotency-key');
    const actorId = actor.id;
    const parsed = agentCommandSchema.safeParse(body);
    const requestId = parsed.success ? parsed.data.requestId : null;
    const bodyHash = operation === 'mutations' && parsed.success ? hashSecret(canonical(body)) : null;
    async function replay() {
      const rows = await sql`SELECT key, body_hash, response FROM bridge_agent_mutations
        WHERE event_id = ${eventId} AND actor_id = ${actorId}
          AND (key = ${key} OR request_id = ${requestId})`;
      const match = rows.find((row) => row.key === key);
      if (match) {
        if (match.body_hash !== bodyHash)
          throw new DomainError('同一冪等鍵已用於不同的請求內容', 409, 'IDEMPOTENCY_CONFLICT');
        return respond(match.response);
      }
      if (rows.length) throw reusedRequest();
    }

    if (operation === 'mutations') {
      if (!key || !/^[!-~]{1,200}$/.test(key) || key.includes(','))
        throw new DomainError('請提供有效的 Idempotency-Key', 422);
      const previous = await replay();
      if (previous) return previous;
    }

    const action = body?.command?.action;
    if (typeof action === 'string' && mutationActions.has(action) && !isAgentAction(action))
      throw forbidden('代理 API 僅支援輸入、匯入或清除單筆成績');
    if (!parsed.success) throw new DomainError('指令格式錯誤，請檢查必填欄位與 requestId', 422);
    const { command } = parsed.data;
    if (!canMutate(actor.role === 'referee' ? 'director' : 'admin', command))
      throw forbidden('此操作需要收分或裁判權限');

    const scopedCommand = { ...command, requestId: `agent:${hashSecret(canonical([actor.id, parsed.data.requestId]))}` };
    if (!writeRepo) return respond(previewMutation(stored, scopedCommand));
    try {
      const next = await writeRepo.mutateEvent(eventId, scopedCommand, {
        validate(current) {
          assertEventAccess(current, actor);
          if (current.requests.includes(scopedCommand.requestId)) throw reusedRequest();
          if (current.event.revision !== command.revision) throw revisionConflict();
        },
        queue(batch, before, after) {
          if (canonical(before.event.boards) !== canonical(after.event.boards))
            throw forbidden('代理 API 不可變更牌組或牌型公開設定');
          const response = { revision: after.event.revision };
          const changes = resultChanges(before.event.results, after.event.results);
          const audit = auditAgentChange(
            { ...actor, organizerId: before.event.organizerId },
            after.event.updatedAt,
            `${eventId}/${command.action}`,
            { revision: before.event.revision, results: changes.map(({ target, before }) => ({ target, result: before })) },
            { revision: after.event.revision, results: changes.map(({ target, after }) => ({ target, result: after })) },
          );
          batch`INSERT INTO bridge_agent_mutations (event_id, actor_id, key, request_id, body_hash, response)
            VALUES (${eventId}, ${actor.id}, ${key}, ${requestId}, ${bodyHash}, ${JSON.stringify(response)}::jsonb)`;
          batch`INSERT INTO bridge_access_audit (id, document) VALUES (${randomUUID()}, ${JSON.stringify(audit)}::jsonb)`;
        },
      });
      return respond({ revision: next.event.revision });
    } catch (error) {
      const raced = await replay();
      if (raced) return raced;
      throw error;
    }
  } catch (error) {
    if (error instanceof LoginRateLimitError) headers.set('Retry-After', String(error.retryAfter));
    if (isUndefinedTable(error))
      return respond({ error: '代理 API 缺少資料表，請先執行資料庫結構遷移', code: 'AGENT_SCHEMA_MISSING' }, 503);
    if (error instanceof DomainError) {
      const { message, code, status } = agentError(error);
      if (status === 400 || status === 413 || status === 422)
        return respond({ error: message, code: 'INVALID_MUTATION' }, 422);
      return respond({ error: message, code }, status);
    }
    console.error('Agent request failed:', error instanceof Error ? error.name : 'UnknownError');
    return respond({ error: '代理 API 暫時無法使用', code: 'AGENT_STORAGE_UNAVAILABLE' }, 503);
  }
}

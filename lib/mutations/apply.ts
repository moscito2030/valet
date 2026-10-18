import { DomainError } from '../domain-error';
import { Mutation, Result, StoredEvent } from '../model';
import { normalizeResults } from '../result-status';
import { roundProgress } from '../round-progress';
import { project } from '../scoring';
import { swissRoundComplete } from '../swiss';
import { validDeviceSchedule } from '../table-device';
import type { MutationContext } from './context';
import { dispatchMutation } from './dispatch';

export function applyMutation(stored: StoredEvent, command: Mutation): StoredEvent {
  if (stored.requests.includes(command.requestId)) return stored;
  if (command.revision !== stored.event.revision)
    throw new DomainError('成績已被其他操作更新，請重新載入後再提交。', 409);
  const e = structuredClone(stored.event),
    at = new Date().toISOString();
  e.results = normalizeResults(e.results);
  if (e.swiss && ['movement', 'movement-plan'].includes(command.action))
    throw new DomainError('Swiss 賽程請使用逐圈配對，不能以整場編排覆寫');
  if (
    !e.rounds &&
    ([
      'results',
      'results-import',
      'club-play',
      'club-finalize',
      'round-control',
      'movement',
      'pbn',
      'ruling',
      'split-contract',
    ].includes(command.action) ||
      (command.action === 'settings' && command.status === 'finished'))
  )
    throw new DomainError('待設定賽程，請先選擇賽程編排並設定圈數與每圈牌數');
  const changes: { key: string; before: Result | null; after: Result | null }[] = [];
  let detail: string | undefined;
  const context: MutationContext = { event: e, at, changes };
  dispatchMutation(context, command);
  detail = context.detail;
  if (e.club?.mode === 'table' && !validDeviceSchedule(e))
    throw new DomainError('同圈同桌有多筆安排，無法綁定收分裝置');
  if (
    e.status === 'live' &&
    !e.club?.enabled &&
    ['results', 'results-import', 'ruling', 'split-contract', 'round-control'].includes(
      command.action,
    )
  ) {
    if (command.action === 'results' || command.action === 'results-import') {
      const latest = roundProgress({ ...e, currentRound: 0 }).round;
      if (latest > (e.currentRound ?? 0)) {
        e.currentRound = latest;
        e.roundPhase = 'playing';
      }
    }
    const progress = roundProgress(e);
    if (
      progress.expected > 0 &&
      progress.received === progress.expected &&
      (!e.swiss || swissRoundComplete(e, progress.round))
    ) {
      e.currentRound = progress.round;
      e.roundPhase = 'break';
      detail = [detail, `第 ${progress.round} 圈成績收齊，自動進入圈間休息`]
        .filter(Boolean)
        .join('；');
    }
  }
  e.revision++;
  e.updatedAt = at;
  e.audit.push({
    at,
    action: {
      'competition-settings': '賽事共用資訊',
      'team-roster': '隊伍賽員名單',
      'rosters-import': '匯入隊伍賽員名單',
      'lineups-import': '匯入入座名單',
      'clear-results': '清除所有成績',
      'table-lineup': '桌次上場名單',
      'club-config': '裝置收分設定',
      'pair-name': '修改搭檔名稱',
      'club-play': '收分卡提交／確認',
      'club-finalize': '圈次結算',
      results: '收分／更正',
      'results-import': '匯入成績',
      settings: '發布設定',
      pbn: '匯入牌型',
      movement: '匯入賽程編排',
      'movement-plan': '套用賽程編排',
      'swiss-config': '設定 Swiss',
      'swiss-publish': '公布 Swiss 對戰',
      'board-publication': '逐副公開設定',
      'round-control': '設定目前圈數',
      'round-timing': '設定圈次時間',
      'round-times-import': '匯入各圈時間區間',
      ruling: '裁判取消／恢復',
      'split-contract': '不平衡合約',
      penalty: '判罰扣分',
    }[command.action],
    reason: command.reason,
    revision: e.revision,
    detail,
    ...(changes.length ? { changes } : {}),
  });
  return {
    event: e,
    requests: [...stored.requests, command.requestId].slice(-500),
    projection: project(e),
  };
}

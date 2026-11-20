import type { PairBinding, PartnerNotice, Player } from '../access/players';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';

export async function savePlayerRecords(
  sql: Sql,
  input: { players: Player[]; bindings: PairBinding[]; notices: PartnerNotice[] },
) {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  const cap = captureSql();
  for (const player of input.players) {
    const stored = { ...player };
    cap.sql`INSERT INTO bridge_players (id, email_key, document)
      VALUES (${player.id}, ${player.emailKey}, ${JSON.stringify(stored)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET email_key = EXCLUDED.email_key, document = EXCLUDED.document`;
  }
  for (const binding of input.bindings)
    cap.sql`INSERT INTO bridge_pair_bindings (player_id, event_id, participant_id, status)
      VALUES (${binding.playerId}, ${binding.eventId}, ${binding.participantId}, ${binding.status})
      ON CONFLICT (player_id, event_id, participant_id) DO UPDATE SET status = EXCLUDED.status`;
  for (const notice of input.notices)
    cap.sql`INSERT INTO bridge_partner_notices (player_id, event_id, participant_id, status)
      VALUES (${notice.playerId}, ${notice.eventId}, ${notice.participantId}, ${notice.status})
      ON CONFLICT (player_id, event_id, participant_id) DO UPDATE SET status = EXCLUDED.status`;
  await commitSql(sql, cap.batches);
}

export async function loadPlayerRecords(sql: Sql) {
  const players = await sql`SELECT document FROM bridge_players ORDER BY id`;
  const bindings = await sql`SELECT player_id, event_id, participant_id, status FROM bridge_pair_bindings ORDER BY player_id, event_id`;
  const notices = await sql`SELECT player_id, event_id, participant_id, status FROM bridge_partner_notices ORDER BY player_id, event_id`;
  return {
    players: players.map((row) => row.document as Player),
    bindings: bindings.map((row) => ({
      playerId: String(row.player_id),
      eventId: String(row.event_id),
      participantId: String(row.participant_id),
      status: row.status as PairBinding['status'],
    })),
    notices: notices.map((row) => ({
      playerId: String(row.player_id),
      eventId: String(row.event_id),
      participantId: String(row.participant_id),
      status: row.status as PartnerNotice['status'],
    })),
  };
}

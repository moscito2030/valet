import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { resolveCompetitionOrganizer } from '../competitions';
import { readOrganizerNames } from './organizer-names';
import { requireNormalizedStorage } from './switch';

const competitionId = '8b01f0c3-dc13-4a5f-9178-cae97fdf5b44';
const standaloneId = '64c0734e-00ce-4c16-9e9e-ecfa359cc9ba';
const standaloneBuilding = '台灣大學 第二學生活動中心';
const standaloneVenue = `${standaloneBuilding} 603`;
const rehearsalId = 'fed8635d-0737-48ca-a17b-5d4d96884f26';
const expectedOrganizer = { id: 'ntu-bridge-club', name: '台大橋藝社' };
const novemberId = '58f461bf-e3df-4dab-b5ac-88ba69025f2d';
const finalId = '55178a2a-1a1e-4106-b525-dc3fe9ae9f50';

type Metadata = Record<string, unknown>;
type CompetitionRow = { id: string; revision: number; document: Metadata };
type StageRow = { id: string; competition_id: string; revision: number; settings: Metadata };
type Entry = {
  competition: CompetitionRow;
  stages: StageRow[];
  changes: string[];
  skipped: string[];
};
const printable = (value: unknown) => JSON.stringify(value ?? null);
const stageName = (stage: StageRow) => stage.settings.stageName ?? stage.settings.name;
const roomSource = (stage: StageRow) => stage.settings.venueOverride ?? stage.settings.venue;

function planField(entry: Entry, patch: Metadata, label: string, field: string,
  current: unknown, before: readonly unknown[], target: string | null) {
  if (current === target || (target === null && current == null)) return;
  if (before.includes(current)) {
    patch[field] = target;
    entry.changes.push(`${label}: ${printable(current)} → ${printable(target)}`);
  } else {
    entry.skipped.push(`${label}: current ${printable(current)}, expected ${before.map(printable).join(' or ')}`);
  }
}

export async function convertVenuePrefix(sql: Sql, { dryRun }: { dryRun: boolean }) {
  await requireNormalizedStorage(sql);

  const competitions = await sql`SELECT id, revision, document FROM bridge_competitions ORDER BY id` as CompetitionRow[];
  const stages = await sql`SELECT id, competition_id, revision, settings FROM bridge_stages ORDER BY id` as StageRow[];
  const stagesByCompetition = new Map<string, StageRow[]>();
  for (const stage of stages) {
    const family = stagesByCompetition.get(stage.competition_id) ?? [];
    family.push(stage);
    stagesByCompetition.set(stage.competition_id, family);
  }

  const targetExists = competitions.some(({ id }) => id === competitionId);
  const organizerNames = targetExists ? await readOrganizerNames(sql) : new Map<string, string>();
  const targetStages = stagesByCompetition.get(competitionId) ?? [];
  const organizer = resolveCompetitionOrganizer(targetStages.map(stage => stage.settings.organizerId), organizerNames);
  const cap = captureSql();
  const at = new Date().toISOString();
  let stagesChanged = 0;
  const entries: Entry[] = competitions.map((competition) => {
    const family = stagesByCompetition.get(competition.id) ?? [];
    const entry: Entry = { competition, stages: family, changes: [], skipped: [] };
    const { document, id, revision } = competition;
    if (id !== competitionId && id !== standaloneId) {
      entry.skipped.push('No approved mapping');
      return entry;
    }

    const patch: Metadata = {};
    if (id === standaloneId) {
      planField(entry, patch, 'venue', 'venue', document.venue, [standaloneVenue], standaloneBuilding);
    } else {
      if (organizer.id !== expectedOrganizer.id || organizer.name !== expectedOrganizer.name) {
        entry.skipped.push(`Organizer: expected ${expectedOrganizer.name} (${expectedOrganizer.id})`);
      }
      if (!family.length) entry.skipped.push('No stages with organizer assignments');
      for (const stage of family) {
        const stageOrganizerId = stage.settings.organizerId;
        if (stageOrganizerId !== expectedOrganizer.id) {
          entry.skipped.push(`stage ${stage.id} ${printable(stageName(stage))} organizerId: ${printable(stageOrganizerId)}`);
        }
      }

      planField(entry, patch, 'name', 'name', document.name, ['社內賽'], '115-1 社內賽');
      planField(entry, patch, 'venue', 'venue', document.venue, ['臺灣大學 二活'], '臺灣大學 第二學生活動中心');
      if (document.prefix !== '') {
        planField(entry, patch, 'prefix', 'prefix', document.prefix,
          ['臺灣大學橋藝社 115-1', '台大橋藝社 115-1'], null);
      }
    }
    if (Object.keys(patch).length) {
      const removePrefix = 'prefix' in patch;
      delete patch.prefix;
      cap.sql`WITH upd AS (
        UPDATE bridge_competitions
        SET revision = revision + 1, updated_at = ${at}::timestamptz,
          document = (CASE WHEN ${removePrefix} THEN document - 'prefix' ELSE document END) || ${JSON.stringify({ ...patch, updatedAt: at, revision: revision + 1 })}::jsonb
        WHERE id = ${id} AND revision = ${revision} AND document = ${JSON.stringify(document)}::jsonb
        RETURNING 1
      ) SELECT 1 / (SELECT count(*)::int FROM upd)`;
    }

    for (const stage of family) {
      const label = `stage ${stage.id} ${printable(stageName(stage))}`;
      const stagePatch: Metadata = {};
      if (id === standaloneId) {
        if (stage.id !== standaloneId) {
          entry.skipped.push(`${label}: no approved room mapping`);
          continue;
        }
        const current = stage.settings.venueOverride ?? null;
        if (current === null && stage.settings.venue !== standaloneVenue) {
          entry.skipped.push(`${label} room: current ${printable(stage.settings.venue)}, expected ${printable(standaloneVenue)}`);
        } else {
          planField(entry, stagePatch, `${label} room field`, 'venueOverride', current, [null], '603');
        }
      } else {
        const november = stage.id === novemberId;
        const rehearsalOrFinal = stage.id === rehearsalId || stageName(stage) === '預演' || stageName(stage) === '正賽';
        if (!november && stage.id !== finalId && !rehearsalOrFinal) {
          entry.skipped.push(`${label}: no approved room mapping`);
          continue;
        }
        const room = november ? '705' : '704';
        const current = roomSource(stage);
        if (stage.settings.venueOverride == null && current === room) {
          // Older stages may contain the room only in the legacy venue slot.
          stagePatch.venueOverride = room;
          entry.changes.push(`${label} room field: null → ${printable(room)}`);
        } else {
          planField(entry, stagePatch, `${label} room`, 'venueOverride', current,
            november ? ['臺灣大學 二活705'] : rehearsalOrFinal && stage.settings.venueOverride == null
              ? ['704', '臺灣大學 二活704'] : ['704'], room);
        }
        if (november && (current === room || 'venueOverride' in stagePatch) && stage.settings.venue === '臺灣大學 二活705') {
          stagePatch.venue = room;
          entry.changes.push(`${label} legacy venue: ${printable(stage.settings.venue)} → ${printable(room)}`);
        }
      }
      if (!Object.keys(stagePatch).length) continue;
      stagesChanged++;
      cap.sql`WITH upd AS (
        UPDATE bridge_stages
        SET revision = revision + 1, updated_at = ${at}::timestamptz,
          settings = settings || ${JSON.stringify({ ...stagePatch, updatedAt: at, revision: stage.revision + 1 })}::jsonb
        WHERE id = ${stage.id} AND competition_id = ${id} AND revision = ${stage.revision}
          AND settings = ${JSON.stringify(stage.settings)}::jsonb
        RETURNING 1
      ) SELECT 1 / (SELECT count(*)::int FROM upd)`;
    }
    return entry;
  });

  if (!dryRun && cap.batches.length) {
    const guard = captureSql();
    guard.sql`WITH active AS (
      SELECT 1 FROM bridge_storage_switch WHERE id = 1 AND mode = 'normalized' FOR SHARE
    ) SELECT 1 / (SELECT count(*)::int FROM active)`;
    await commitSql(sql, [...guard.batches, ...cap.batches]);
  }
  return {
    dryRun,
    organizer,
    targetExists,
    entries,
    competitionsChanged: entries.filter(entry => entry.changes.length).length,
    competitionsSkipped: entries.filter(entry => !entry.changes.length && entry.skipped.length).length,
    competitionsUnchanged: entries.filter(entry => !entry.changes.length && !entry.skipped.length).length,
    stagesChanged,
  };
}

export function formatVenueConversion(report: Awaited<ReturnType<typeof convertVenuePrefix>>) {
  const lines = [
    report.dryRun ? 'Mode: dry-run (planned changes)' : 'Mode: write',
    `Competitions changed: ${report.competitionsChanged}, skipped: ${report.competitionsSkipped}, unchanged: ${report.competitionsUnchanged}`,
    `Stages changed: ${report.stagesChanged}`,
    `Competition ${competitionId} organizer: ${report.targetExists
      ? `${printable(report.organizer.name)} (organizerId: ${printable(report.organizer.id)})`
      : 'competition missing'}`,
  ];
  for (const { competition, changes } of report.entries) {
    if (changes.length) lines.push(`Competition ${competition.id} ${printable(competition.document.name)}`, ...changes.map(line => `  ${line}`));
  }
  lines.push('Skipped – needs a human decision');
  if (!report.targetExists) lines.push(`  Competition ${competitionId} is missing`);
  for (const { competition, stages, skipped } of report.entries) {
    if (!skipped.length) continue;
    const { id, document } = competition;
    lines.push(`  ${id} name=${printable(document.name)} prefix=${printable(document.prefix)} venue=${printable(document.venue)}`);
    for (const stage of stages)
      lines.push(`    ${stage.id} name=${printable(stageName(stage))} venue=${printable(stage.settings.venue)} venueOverride=${printable(stage.settings.venueOverride)}`);
    lines.push(...skipped.map(line => `    ${line}`));
  }
  return lines.join('\n');
}

import { findCompetition, isStage, type StoredCompetition, type StoredDocument } from '../competition-record';
import type { BridgeEvent, StoredEvent } from '../model';
import { project } from '../scoring';
import { canonical, seedResultWrites } from './cell-write';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import {
  loadCompetitions,
  loadStages,
  queueCompetition,
  queueDeleteCompetition,
  queueStage,
  type StagePrior,
} from './rows';
import { storageGate } from './switch';

export const stageMerge = {
  competitionId: '8b01f0c3-dc13-4a5f-9178-cae97fdf5b44',
  retiredId: '58f461bf-e3df-4dab-b5ac-88ba69025f2d',
  prefix: '台大橋藝社 115-1',
  name: '社內賽',
  stages: [
    { id: 'fed8635d-0737-48ca-a17b-5d4d96884f26', name: '預演', stageOrder: 0 },
    { id: '55178a2a-1a1e-4106-b525-dc3fe9ae9f50', name: '正賽', stageOrder: 1 },
    { id: '58f461bf-e3df-4dab-b5ac-88ba69025f2d', name: '11月社內賽', stageOrder: 2 },
  ],
} as const;

export type StageMergePlan = {
  documents: StoredDocument[];
  redirect: { from: string; to: string };
  changed: boolean;
};

function isCompetition(document: StoredDocument): document is StoredCompetition {
  return !isStage(document);
}

function rootRecordVenue(event: BridgeEvent, documents: StoredDocument[]) {
  if (event.parentEventId) return undefined;
  try {
    const venue = findCompetition(documents, event.id).competition.venue;
    return venue || event.venue;
  } catch {
    return event.venue;
  }
}

export function planStageMerge(documents: StoredDocument[]): StageMergePlan {
  const stages = documents.filter(isStage);
  for (const spec of stageMerge.stages)
    if (!stages.some((stage) => stage.event.id === spec.id)) throw new Error(`missing stage ${spec.id}`);
  const competitions = documents.filter(isCompetition);
  const competition =
    competitions.find((item) => item.competition.id === stageMerge.competitionId) ??
    findCompetition(documents, stageMerge.competitionId);
  const redirect = { from: stageMerge.retiredId, to: stageMerge.competitionId };
  const ready = stages
    .filter((stage) => stageMerge.stages.some((spec) => spec.id === stage.event.id))
    .every((stage) => {
      const spec = stageMerge.stages.find((item) => item.id === stage.event.id)!;
      const carried = rootRecordVenue(stage.event, documents);
      const venue = carried === undefined || stage.event.venue === carried;
      return (
        stage.event.parentEventId === stageMerge.competitionId &&
        stage.event.stageName === spec.name &&
        stage.event.stageOrder === spec.stageOrder &&
        venue
      );
    });
  if (
    ready &&
    competition.competition.prefix === stageMerge.prefix &&
    competition.competition.name === stageMerge.name &&
    !competitions.some((item) => item.competition.id === stageMerge.retiredId)
  )
    return { documents, redirect, changed: false };
  const at = new Date().toISOString();
  const retired = competitions.find((item) => item.competition.id === stageMerge.retiredId);
  const nextCompetition = structuredClone(competition);
  nextCompetition.competition.prefix = stageMerge.prefix;
  nextCompetition.competition.name = stageMerge.name;
  nextCompetition.competition.hasStages = true;
  nextCompetition.competition.revision += 1;
  nextCompetition.competition.updatedAt = at;
  if (retired) {
    const seen = new Set(nextCompetition.requests);
    nextCompetition.competition.audit = [...nextCompetition.competition.audit, ...retired.competition.audit];
    nextCompetition.requests = [
      ...nextCompetition.requests,
      ...retired.requests.filter((id) => !seen.has(id)),
    ];
  }
  nextCompetition.competition.audit.push({
    at,
    action: '合併賽段',
    reason: '合併賽段',
    revision: nextCompetition.competition.revision,
    detail: stageMerge.stages.map((item) => item.id).join(','),
  });
  const nextStages = stages.map((stage) => {
    const spec = stageMerge.stages.find((item) => item.id === stage.event.id);
    if (!spec) return stage;
    const event = structuredClone(stage.event);
    const carried = rootRecordVenue(stage.event, documents);
    if (carried !== undefined) {
      event.venue = carried;
      event.venueOverride = carried;
    }
    event.parentEventId = stageMerge.competitionId;
    event.stageName = spec.name;
    event.stageOrder = spec.stageOrder;
    delete event.competition;
    event.revision += 1;
    event.updatedAt = at;
    return { ...stage, event };
  });
  return {
    documents: [
      ...nextStages,
      ...competitions.filter(
        (item) => item.competition.id !== stageMerge.competitionId && item.competition.id !== stageMerge.retiredId,
      ),
      nextCompetition,
    ],
    redirect,
    changed: true,
  };
}

export async function commitStageMerge(sql: Sql) {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  if ((await storageGate(sql)).mode !== 'normalized')
    throw new Error('merge writes require the normalized storage switch');
  const stages = await loadStages(sql);
  const competitions = await loadCompetitions(sql);
  const documents: StoredDocument[] = [...stages.map((stage) => stage.stored), ...competitions];
  const before = documents.filter(isStage);
  const plan = planStageMerge(documents);
  const after = plan.documents.filter(isStage);
  assertMergePreserved(before, after);
  const cap = captureSql();
  const touched = new Set<string>([stageMerge.competitionId, ...stageMerge.stages.map((item) => item.id)]);
  if (plan.changed) {
    for (const document of plan.documents) {
      if (isStage(document) && touched.has(document.event.id)) {
        const prior = stages.find((stage) => stage.stored.event.id === document.event.id);
        const guard: StagePrior | undefined = prior
          ? {
              eventRevision: prior.stored.event.revision,
              writes: prior.writes,
              revisions: prior.revisions,
              results: prior.stored.event.results,
            }
          : undefined;
        queueStage(cap.sql, document, prior?.writes ?? seedResultWrites(document.event), guard);
      } else if (!isStage(document) && document.competition.id === stageMerge.competitionId) {
        const existed = competitions.some((item) => item.competition.id === stageMerge.competitionId);
        queueCompetition(
          cap.sql,
          document,
          existed ? competitions.find((item) => item.competition.id === stageMerge.competitionId)?.competition.revision : undefined,
        );
      }
    }
    if (!plan.documents.some((document) => !isStage(document) && document.competition.id === stageMerge.retiredId))
      queueDeleteCompetition(cap.sql, stageMerge.retiredId);
  }
  cap.sql`INSERT INTO bridge_competition_redirects (from_id, to_id)
    VALUES (${plan.redirect.from}, ${plan.redirect.to})
    ON CONFLICT (from_id) DO UPDATE SET to_id = EXCLUDED.to_id`;
  await commitSql(sql, cap.batches);
  const reloaded = (await loadStages(sql))
    .map((stage) => stage.stored)
    .filter((stage) => stageMerge.stages.some((item) => item.id === stage.event.id));
  assertMergePreserved(before, reloaded);
  return plan;
}

export function mergeReport(plan: StageMergePlan, dryRun: boolean) {
  const stages = plan.documents.filter(isStage);
  const lines = [
    `mode: ${dryRun ? 'dry-run' : 'write'}`,
    `changed: ${plan.changed ? 'yes' : 'no'}`,
    `competition: ${stageMerge.competitionId}`,
    ...stageMerge.stages.map((spec) => {
      const stage = stages.find((item) => item.event.id === spec.id);
      return `stage: ${spec.id} name=${spec.name} order=${spec.stageOrder} venue=${stage?.event.venue ?? ''} archived=${stage?.event.stageArchived ? 'yes' : 'no'} boards=${stage?.event.boards.length ?? 0}`;
    }),
    `redirect: ${plan.redirect.from} -> ${plan.redirect.to}`,
    'preserved: deals, results, participants, penalties, audit, standings',
  ];
  return lines.join('\n');
}

export function assertMergePreserved(before: StoredEvent[], after: StoredEvent[]) {
  for (const spec of stageMerge.stages) {
    const left = before.find((stage) => stage.event.id === spec.id);
    const right = after.find((stage) => stage.event.id === spec.id);
    if (!left || !right) throw new Error(`missing stage ${spec.id}`);
    if (left.event.boards.length !== right.event.boards.length) throw new Error(`deals changed ${spec.id}`);
    for (let index = 0; index < left.event.boards.length; index++) {
      if (JSON.stringify(left.event.boards[index].deal) !== JSON.stringify(right.event.boards[index].deal))
        throw new Error(`deals changed ${spec.id}`);
    }
    if (canonical(left.event.results) !== canonical(right.event.results)) throw new Error(`results changed ${spec.id}`);
    if (canonical(left.event.participants) !== canonical(right.event.participants))
      throw new Error(`participants changed ${spec.id}`);
    if (canonical(left.event.penalties ?? {}) !== canonical(right.event.penalties ?? {}))
      throw new Error(`penalties changed ${spec.id}`);
    if (left.event.audit.length !== right.event.audit.length || canonical(left.event.audit) !== canonical(right.event.audit))
      throw new Error(`audit changed ${spec.id}`);
    if (canonical(project(left.event).standings) !== canonical(project(right.event).standings))
      throw new Error(`standings changed ${spec.id}`);
    if (Boolean(left.event.stageArchived) !== Boolean(right.event.stageArchived))
      throw new Error(`archive changed ${spec.id}`);
  }
}

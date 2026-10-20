import { hasDirectionalAwards } from '../awards';
import { DomainError } from '../domain-error';
import { Mutation } from '../model';
import { swissRoundComplete } from '../swiss';
import { allRoundsComplete } from '../round-progress';
import type { MutationContext } from './context';

export function applySettingsCommand(
  context: MutationContext,
  command: Extract<Mutation, { action: 'stage-archive' | 'competition-settings' | 'settings' }>,
) {
  const { event: e, at, changes } = context;
  let detail: string | undefined;
  if (command.action === 'stage-archive') {
    e.stageArchived = command.archived;
    detail = command.archived ? '封存賽段，僅裁判可見' : '解除封存賽段';
  } else if (command.action === 'competition-settings') {
    if (e.parentEventId) throw new DomainError('請從賽事主頁修改共用資訊');
    e.name = command.name;
    e.prefix = command.prefix;
    e.venue = command.venue;
    detail = '修改賽事共用名稱、前綴與地點';
  } else if (command.action === 'settings') {
    if (command.status === 'review' && e.status !== 'review' && !allRoundsComplete(e))
      throw new DomainError('全部圈次完成後才可進入成績覆核。');
    if (e.status === 'review' && command.status === 'live')
      throw new DomainError('目前為成績覆核中，請直接更正成績，完成覆核後再結束賽段。');
    if (
      command.status === 'finished' &&
      e.knockout &&
      e.knockout.nodes.some((n) => !e.knockout!.decisions[n.id])
    )
      throw new DomainError('淘汰賽尚有未決對局，不能結束賽事');
    if (
      command.status === 'finished' &&
      e.swiss &&
      Array.from({ length: e.rounds }, (_, i) => i + 1).some((r) => !swissRoundComplete(e, r))
    )
      throw new DomainError('Swiss 尚有圈次未完整公布，不能結束賽事。');
    if (
      command.status === 'finished' &&
      !e.knockout &&
      new Set(e.assignments.map((a) => a.round)).size !== e.rounds
    )
      throw new DomainError('尚有圈次未安排賽程，不能結束賽事。');
    if (
      command.status === 'finished' &&
      Object.keys(e.results).length !== e.assignments.reduce((n, a) => n + a.boards.length, 0)
    )
      throw new DomainError('還有未收齊的成績，不能結束賽事。');
    if (
      command.status === 'finished' &&
      e.club?.enabled &&
      e.assignments.some((a) => !e.club!.finalized.includes(a.round))
    )
      throw new DomainError('請先結算所有圈次');
    e.status = command.status;
    if (command.danmakuDefaultEnabled !== undefined) e.danmakuDefaultEnabled = command.danmakuDefaultEnabled;
    if (command.audienceRefreshSeconds !== undefined) e.audienceRefreshSeconds = command.audienceRefreshSeconds;
    if (command.maxBoardNumber !== undefined) e.maxBoardNumber = command.maxBoardNumber;
    if (
      (e.parentEventId || e.hasStages) &&
      (command.name !== undefined || command.prefix !== undefined)
    )
      throw new DomainError('賽事共用資訊請至賽事主頁修改');
    if (command.stageName !== undefined) {
      e.stageName = command.stageName;
    }
    if (command.venueOverride !== undefined) {
      if (command.venueOverride === null) delete e.venueOverride;
      else e.venueOverride = command.venueOverride;
    }
    if (command.date !== undefined) e.date = command.date;
    if (command.endDate !== undefined) {
      if (command.endDate === null) delete e.endDate;
      else e.endDate = command.endDate;
    }
    if (e.endDate && e.endDate < e.date) throw new DomainError('結束日期不可早於開始日期');
    if (command.name !== undefined) e.name = command.name;
    if (command.prefix !== undefined) e.prefix = command.prefix;
    if (command.awardPlacesNS !== undefined || command.awardPlacesEW !== undefined) {
      if (!hasDirectionalAwards(e)) throw new DomainError('NS／EW 給獎範圍僅適用 Double Winner');
      if (command.awardPlacesNS !== undefined) e.awardPlacesNS = command.awardPlacesNS;
      if (command.awardPlacesEW !== undefined) e.awardPlacesEW = command.awardPlacesEW;
    }
    if (command.teamMethod !== undefined || command.bam !== undefined) {
      if (e.kind !== 'teams') throw new DomainError('隊制計分僅適用隊制賽');
      if (
        Object.keys(e.results).length ||
        e.swiss?.publications.length ||
        (e.knockout && Object.keys(e.knockout.published).length) ||
        e.status === 'finished'
      )
        throw new DomainError('已有成績或已公布 Swiss 對戰，不能變更計分規則');
      const method = command.teamMethod ?? e.teamMethod ?? 'imp';
      if (command.bam && method !== 'bam') throw new DomainError('請選擇 Board-A-Match 計分');
      if (method !== (e.teamMethod ?? 'imp')) e.byeVp = method === 'bam' ? 0 : 12;
      e.teamMethod = method;
      if (method === 'bam') e.bam = command.bam ?? e.bam ?? { win: 2, draw: 1, loss: 0 };
      else delete e.bam;
    }
    if (command.awardPlaces !== undefined) e.awardPlaces = command.awardPlaces;
    if (command.winAward !== undefined) e.winAward = command.winAward;
    if (command.awardDescription !== undefined) e.awardDescription = command.awardDescription;
    if (command.movementDescription !== undefined)
      e.movementDescription = command.movementDescription;
    if (command.publishBoards !== undefined && command.publishBoards !== e.publishBoards)
      throw new DomainError('請使用每副牌的公開開關。');
  }
  context.detail = detail;
}

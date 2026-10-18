import { resultKey, StoredEvent } from '../model';
import { contractScore, project } from '../scoring';
import { makeBoard } from './board-factory';
import { createEvent } from './event-factory';
export function seedEvents(): StoredEvent[] {
  const names = ['臺北松山', '新竹交大', '臺中青鳥', '臺南南風', '高雄海港', '花蓮山海'];
  const team = createEvent(
    {
      name: '秋季橋牌邀請賽',
      kind: 'teams',
      date: '2026-10-12',
      venue: '臺北・橋牌交流中心',
      names,
      rounds: 5,
      boardsPerRound: 8,
    },
    'autumn-teams',
  );
  const pairs = createEvent(
    {
      name: '週末雙人積分賽',
      kind: 'pairs',
      date: '2026-10-12',
      venue: '臺北・橋牌交流中心',
      names: [
        '林冠宇 / 陳思妤',
        '張哲維 / 王品涵',
        '李柏翰 / 黃詠晴',
        '吳承恩 / 劉芷瑜',
        '蔡宗翰 / 楊庭安',
        '許家豪 / 鄭雅文',
        '謝宇軒 / 郭子晴',
        '洪偉倫 / 曾心怡',
        '邱俊傑 / 賴佩珊',
        '徐博文 / 周佳穎',
        '蘇奕辰 / 葉婉婷',
        '莊凱翔 / 廖昀潔',
        '江紹廷 / 何映彤',
        '蕭立衡 / 宋采蓉',
        '梁昱廷 / 方予安',
      ],
      rounds: 13,
      boardsPerRound: 2,
    },
    'weekend-pairs',
  );
  return [team, pairs].map((e) => {
    e.demo = true;
    e.publishBoards = true;
    e.boards = e.boards.map((b) => makeBoard(b.number));
    const lastRound = e.kind === 'teams' ? 3 : 9;
    for (const a of e.assignments)
      for (const board of a.boards) {
        const tableIndex = Number(a.table) || e.assignments.indexOf(a) + 1;
        if (a.round > lastRound || (a.round === lastRound && (tableIndex + board) % 3 === 0))
          continue;
        const n = board * 13 + tableIndex * 7 + (a.room === 'closed' ? 3 : 0);
        const level = [3, 4, 2, 3, 4, 6][n % 6],
          strain = (['NT', 'S', 'H', 'D', 'S', 'NT'] as const)[n % 6];
        const r = {
          assignmentId: a.id,
          board,
          level,
          strain,
          doubled: 1 as const,
          declarer: (['N', 'E', 'S', 'W'] as const)[n % 4],
          tricks: Math.min(13, level + 6 + (n % 4) - 1),
          lead: '',
          updatedAt: e.updatedAt,
        };
        e.results[resultKey(a.id, board)] = {
          ...r,
          nsScore: contractScore(r, e.boards[board - 1].vulnerability),
        };
      }
    return { event: e, requests: [], projection: project(e) };
  });
}

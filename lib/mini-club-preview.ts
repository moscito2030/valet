import { seedEvents } from '@/lib/domain/demo-events';
import { clubView, type ClubView } from '@/lib/club-view';
import { contractScore } from '@/lib/scoring';
export function miniClubPreview(): ClubView {
  const event = seedEvents()[1].event;
  event.currentRound = 1;
  const assignment = event.assignments.find(a => a.round === 1)!;
  const view = clubView(event, assignment.ns);
  return {...view, name:'迷你橋牌 · 本機介面預覽',gameMode:'minibridge',mode:'table',deviceLabel:'第 1 桌',role:'shared',status:'live',phase:'playing',locked:false,accepted:false,finalized:false,guide:null,tableGuide:null,reviewVersion:'preview',
    roles:{inputPair:assignment.ns,confirmPair:assignment.ew},
    boards:view.boards.slice(0,2).map(b => { const r = {assignmentId:assignment.id,board:b.number,level:3,strain:'NT' as const,declarer:'N' as const,doubled:1 as const,tricks:9,lead:'',miniBridge:true,hcp:{N:14,E:8,S:12,W:6}}; return {...b,hcp:undefined,result:{...r,nsScore:contractScore(r,'None',true),updatedAt:event.updatedAt}}; })};
}

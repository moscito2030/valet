import { AdminEvent } from '../scoreboard-shared';
import { allRoundsComplete, roundProgress } from '@/lib/round-progress';
import { roundHasActivity, roundStartProblem, unsettledRoundsBefore } from '@/lib/round-workflow';
import { roundLabel } from '@/lib/team-movement';
import { StartRoundButton } from './StartRoundButton';
import { SkipBack, SkipForward, Play, Pause, ListChecks, SlidersHorizontal } from 'lucide-react';
type Props = {
  onOpenSettings?: () => void;
  collection?: {
    pending: number;
    total: number;
    toggle: () => void;
    finish: () => void;
  };
  busy: boolean;
  event: AdminEvent;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
};
export function RoundControlPanel({ busy, event, save, collection, onOpenSettings }: Props) {
  const round = event.club?.enabled ? (event.currentRound ?? 0) : roundProgress(event).round;
  const progress = roundProgress({ ...event, currentRound: round });
  const settled = event.club?.enabled
    ? event.club.finalized.includes(round)
    : progress.expected > 0 && progress.received === progress.expected;
  const finished = event.status === 'finished';
  const reviewing = event.status === 'review' || allRoundsComplete(event);
  const paused = event.roundPhase === 'break' && !settled;
  const next = round + 1;
  const nextProblem =
    roundStartProblem(event, next) ??
    (unsettledRoundsBefore(event, next).length ? '請先處理前圈未完成桌次並結算。' : null);
  const locked = busy || !event.canDirect;
  const change = (target: number, phase: 'playing' | 'break', reason: string) =>
    save({ action: 'round-control', round: target, phase, reason });
  const canWithdraw = round > 0 && !settled && !roundHasActivity(event, round);
  return (
    <section className="round-workflow" aria-label="圈次進度">
      <div className="round-workflow-heading">
        <div>
          <p className="eyebrow">圈次進度</p>
          <h4>
            {finished
              ? '賽段已結束'
              : reviewing
                ? '成績覆核中'
                : round === 0
                  ? '準備開始'
                  : `第 ${roundLabel(event, round)} 圈 · ${settled ? '圈間休息' : paused ? '收分暫停' : '進行中'}`}
          </h4>
        </div>
        {onOpenSettings ? (
          <button type="button" className="button subtle round-settings-trigger" aria-haspopup="dialog" onClick={onOpenSettings}>
            <SlidersHorizontal aria-hidden="true" />
            <span>收分詳細設定</span>
          </button>
        ) : round > 0 && !reviewing && !finished && !collection ? (
          <span className="badge">{settled ? '成績已發布' : `已收 ${progress.received}／${progress.expected} 副`}</span>
        ) : null}
      </div>
      <p className="round-workflow-description">
        {finished
          ? '成績已定案，不再接受更正。'
          : reviewing
            ? '所有圈次已完成，請處理選手的更正請求，再正式結束賽段。'
            : settled
              ? '排名已更新。待選手就位後，再開始下一圈。'
              : round === 0
                ? '確認選手與桌次就緒後，開始第一圈。'
                : paused
                  ? '選手暫時無法輸入或確認；已有成績保留。'
                  : event.club?.enabled
                    ? '全桌確認完成後，系統自動結算並更新排名。'
                    : '本圈收齊後自動進入休息，由裁判開始下一圈。'}
      </p>
      {collection && (
        <>
          <div className="round-console" role="group" aria-label="收分控制台">
            <button
              type="button"
              disabled={locked || finished || reviewing || !canWithdraw}
              title={canWithdraw ? '撤回本圈開始' : '已有登分紀錄或尚未開始，無法撤回'}
              onClick={() => {
                if (window.confirm('撤回本圈開始？將返回上一圈休息；第一圈則回到尚未開始。'))
                  void change(
                    round - 1,
                    round === 1 ? 'playing' : 'break',
                    '撤回尚無登分紀錄的圈次開始',
                  );
              }}
            >
              <SkipBack aria-hidden="true" />
              <span>撤回</span>
            </button>
            {round === 0 || settled ? (
              <StartRoundButton
                event={event}
                round={next}
                save={save}
                compact
                disabled={locked || finished || reviewing || !!nextProblem}
              />
            ) : (
              <button
                type="button"
                className="round-console-play"
                disabled={locked || finished || reviewing}
                aria-label={paused ? '繼續本圈收分' : '暫停收分'}
                onClick={() =>
                  void change(
                    round,
                    paused ? 'playing' : 'break',
                    paused ? '繼續本圈收分' : '暫停本圈收分',
                  )
                }
              >
                {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                <span>{paused ? '繼續' : '暫停'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={locked || round === 0}
              aria-haspopup="dialog"
              onClick={collection.toggle}
            >
              <ListChecks aria-hidden="true" />
              <span>{collection.pending > 0 ? '待處理 ' + collection.pending : '桌次成績'}</span>
            </button>
            <button
              type="button"
              className="round-console-end"
              disabled={locked || finished || reviewing || round === 0 || settled}
              aria-label="提前結束本圈"
              title="核對未完成桌次，再結算並進入下一階段"
              onClick={collection.finish}
            >
              <SkipForward aria-hidden="true" />
              <span>提前結束</span>
            </button>
          </div>
        </>
      )}
      <div className="button-row round-workflow-actions">
        {!finished && reviewing ? (
          <button
            type="button"
            className="button primary"
            disabled={locked || !allRoundsComplete(event)}
            onClick={() => {
              if (
                !window.confirm(
                  '完成覆核並結束賽段？成績將正式定案，不再接受更正，也無法重新開放。',
                )
              )
                return;
              return save({ action: 'settings', status: 'finished', reason: '完成覆核並結束賽段' });
            }}
          >
            完成覆核並結束賽段
          </button>
        ) : collection ? null : !finished && (round === 0 || settled) ? (
          <StartRoundButton
            key={round}
            event={event}
            round={next}
            disabled={locked || !!nextProblem}
            save={save}
          />
        ) : !finished ? (
          <>
            <button
              type="button"
              className={`button ${paused ? 'primary' : 'subtle'}`}
              disabled={locked}
              onClick={() =>
                change(
                  round,
                  paused ? 'playing' : 'break',
                  paused ? '繼續本圈收分' : '暫停本圈收分',
                )
              }
            >
              {paused ? '繼續本圈' : '暫停收分'}
            </button>
            {canWithdraw && (
              <button
                type="button"
                className="button subtle"
                disabled={locked}
                onClick={() => {
                  if (
                    !window.confirm(
                      '撤回本圈開始？本圈尚無登分或處理紀錄，將返回上一圈休息；第一圈則回到尚未開始。',
                    )
                  )
                    return;
                  return change(
                    round - 1,
                    round === 1 ? 'playing' : 'break',
                    '撤回尚無登分紀錄的圈次開始',
                  );
                }}
              >
                撤回本圈開始
              </button>
            )}
          </>
        ) : null}
      </div>
      {!finished && !reviewing && (round === 0 || settled) && nextProblem && (
        <p className="footnote" role="status">
          {nextProblem}
        </p>
      )}
    </section>
  );
}

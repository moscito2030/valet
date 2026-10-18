import type { PublicEvent } from '@/lib/model';
import { allRoundsComplete, roundProgress } from '@/lib/round-progress';
import { roundLabel } from '@/lib/team-movement';
import { useState } from 'react';
export function RoundStateFields({ event }: { event: PublicEvent }) {
  const progress = roundProgress(event);
  const [selectedRound, setSelectedRound] = useState(progress.round);
  const complete = allRoundsComplete(event) || event.status === 'finished';
  const selectedProgress = roundProgress({ ...event, currentRound: selectedRound });
  const collected =
    selectedRound > 0 &&
    selectedProgress.expected > 0 &&
    selectedProgress.received === selectedProgress.expected;
  return (
    <div className="form-grid">
      <label className="field">
        目前圈數
        <select
          name="round"
          value={selectedRound}
          onChange={(e) => setSelectedRound(Number(e.target.value))}
        >
          <option value="0">尚未開始</option>
          {Array.from({ length: event.rounds }, (_, i) => (
            <option
              key={i}
              value={i + 1}
              disabled={!event.assignments.some((a) => a.round === i + 1)}
            >
              第 {roundLabel(event, i + 1)} 圈
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        進度狀態
        {selectedRound === 0 || complete || collected ? (
          <>
            <select disabled value="automatic">
              <option value="automatic">
                {complete ? '賽事已結束' : selectedRound === 0 ? '尚未開始' : '圈間休息'}
              </option>
            </select>
            <input type="hidden" name="phase" value={selectedRound === 0 ? 'playing' : 'break'} />
          </>
        ) : (
          <select
            name="phase"
            key={selectedRound}
            defaultValue={
              selectedRound === progress.round ? (event.roundPhase ?? 'playing') : 'playing'
            }
          >
            <option value="playing">進行中</option>
            <option value="break">圈間休息</option>
          </select>
        )}
      </label>
    </div>
  );
}

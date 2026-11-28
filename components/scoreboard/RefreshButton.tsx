import { Activity } from 'lucide-react';
import { useRef } from 'react';
import { createRefreshGesture } from './refresh-gesture';
import { refreshButtonHint, refreshButtonLabel, refreshModeLabel } from './refresh-copy';

type Props = {
  autoRefresh: boolean;
  autoRefreshDisabled: boolean;
  disabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onToggleAuto: () => void;
};

export function RefreshButton({
  autoRefresh,
  autoRefreshDisabled,
  disabled,
  refreshing,
  onRefresh,
  onToggleAuto,
}: Props) {
  const canToggle = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const onToggleRef = useRef(onToggleAuto);
  canToggle.current = !autoRefreshDisabled && !disabled;
  onRefreshRef.current = onRefresh;
  onToggleRef.current = onToggleAuto;
  const gesture = useRef<ReturnType<typeof createRefreshGesture> | undefined>(undefined);
  if (!gesture.current)
    gesture.current = createRefreshGesture({
      canToggle: () => canToggle.current,
      onRefresh: () => onRefreshRef.current(),
      onToggle: () => onToggleRef.current(),
    });
  const g = gesture.current;
  return (
    <button
      type="button"
      className={`button subtle event-refresh-button${refreshing ? ' refreshing' : ''}`}
      disabled={disabled}
      title={refreshButtonHint(autoRefreshDisabled)}
      aria-label={refreshButtonLabel(refreshing, autoRefresh, autoRefreshDisabled)}
      onPointerDown={(event) => g.pointerDown(event.button)}
      onPointerUp={() => g.pointerEnd()}
      onPointerCancel={() => g.pointerEnd()}
      onPointerLeave={() => g.pointerEnd()}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => g.click()}
    >
      <Activity size={16} />
      {refreshing ? '更新中' : '更新成績'}
      <small className="event-refresh-mode">{refreshModeLabel(autoRefresh, autoRefreshDisabled)}</small>
    </button>
  );
}

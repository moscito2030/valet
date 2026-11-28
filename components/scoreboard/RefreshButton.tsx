import { RefreshCw, Repeat } from 'lucide-react';
import { useRef } from 'react';
import { createRefreshGesture } from './refresh-gesture';
import { refreshButtonHint, refreshButtonLabel } from './refresh-copy';

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
  const Icon = autoRefresh && !autoRefreshDisabled ? Repeat : RefreshCw;
  return (
    <button
      type="button"
      className={`button subtle event-refresh-button${refreshing ? ' refreshing' : ''}`}
      disabled={disabled}
      title={refreshButtonHint(autoRefreshDisabled)}
      onPointerDown={(event) => g.pointerDown(event.button)}
      onPointerUp={() => g.pointerEnd()}
      onPointerCancel={() => g.pointerEnd()}
      onPointerLeave={() => g.pointerEnd()}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => g.click()}
    >
      <Icon size={16} aria-hidden="true" />
      {refreshButtonLabel(refreshing, autoRefresh, autoRefreshDisabled)}
    </button>
  );
}

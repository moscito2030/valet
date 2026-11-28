export const LONG_PRESS_MS = 500;
const CLICK_SUPPRESS_MS = 750;

type Timer = ReturnType<typeof setTimeout>;

export function createRefreshGesture(options: {
  canToggle: () => boolean;
  onRefresh: () => void;
  onToggle: () => void;
  delay?: number;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => Timer;
  clearTimeoutFn?: (id: Timer) => void;
}) {
  const delay = options.delay ?? LONG_PRESS_MS;
  const start = options.setTimeoutFn ?? setTimeout;
  const clear = options.clearTimeoutFn ?? clearTimeout;
  const now = options.now ?? Date.now;
  let timer: Timer | undefined;
  let longPress = false;
  let suppressClickUntil = 0;

  function pointerDown(button = 0) {
    if ((button ?? 0) !== 0) return;
    longPress = false;
    if (timer !== undefined) clear(timer);
    timer = start(() => {
      longPress = true;
      suppressClickUntil = now() + CLICK_SUPPRESS_MS;
      if (options.canToggle()) options.onToggle();
    }, delay);
  }

  function pointerEnd() {
    if (timer !== undefined) clear(timer);
    timer = undefined;
  }

  function click() {
    if (longPress || now() < suppressClickUntil) {
      longPress = false;
      return 'ignored' as const;
    }
    options.onRefresh();
    return 'refresh' as const;
  }

  return { pointerDown, pointerEnd, click };
}

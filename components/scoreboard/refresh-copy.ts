export function refreshModeLabel(autoRefresh: boolean, autoRefreshDisabled: boolean) {
  if (autoRefreshDisabled) return '已禁用';
  return autoRefresh ? '自動' : '手動';
}

export function refreshButtonLabel(refreshing: boolean, autoRefresh: boolean, autoRefreshDisabled: boolean) {
  const action = refreshing ? '更新中' : '更新成績';
  return `${action}，${refreshModeLabel(autoRefresh, autoRefreshDisabled)}`;
}

export function refreshButtonHint(autoRefreshDisabled: boolean) {
  return autoRefreshDisabled
    ? '點一下更新成績。此賽事已禁用自動更新。'
    : '點一下更新成績，長按切換自動更新。';
}

export function standingsRefreshFooter(
  status: 'live' | 'review' | 'finished',
  autoRefresh: boolean,
  autoRefreshDisabled: boolean,
  seconds = 30,
) {
  if (status === 'finished') return '賽段已結束 · 成績已定案';
  const cadence = autoRefreshDisabled
    ? '此賽事已禁用自動更新'
    : autoRefresh
      ? `每 ${seconds} 秒自動更新`
      : '自動更新已關閉';
  if (status === 'review') return `成績覆核中 · 如有疑義請向裁判提出更正 · ${cadence}`;
  return autoRefresh && !autoRefreshDisabled ? `成績${cadence}` : cadence;
}

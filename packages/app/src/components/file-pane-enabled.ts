// 有后台执行支持时保留当前文件订阅，避免切后台触发释放请求，
// 其确认可能排在大文件传输后面并导致整条连接超时。隐藏的标签页仍释放订阅。
export function isFileQueryEnabled(input: {
  hasReadTarget: boolean;
  isTabActive: boolean;
  isAppVisible: boolean;
  keepsConnectionsActiveInBackground: boolean;
}): boolean {
  const canReceiveUpdates = input.isAppVisible || input.keepsConnectionsActiveInBackground;
  return input.hasReadTarget && input.isTabActive && canReceiveUpdates;
}

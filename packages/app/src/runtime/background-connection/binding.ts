import type { HostRuntimeStore } from "../host-runtime";

export interface BackgroundConnectionActions {
  setEnabled(enabled: boolean): Promise<void>;
  onError(error: unknown): void;
}

export function bindBackgroundConnection(
  store: Pick<HostRuntimeStore, "getHosts" | "subscribeHostList">,
  actions: BackgroundConnectionActions,
): () => void {
  let requested: boolean | null = null;
  let pending = Promise.resolve();

  function setEnabled(enabled: boolean): void {
    if (requested === enabled) return;
    requested = enabled;
    // 清理必须等待已经提交的启动完成，避免快速移除主机后留下后台服务。
    pending = pending.then(() => actions.setEnabled(enabled)).catch(actions.onError);
  }

  function sync(): void {
    setEnabled(store.getHosts().length > 0);
  }

  const unsubscribe = store.subscribeHostList(sync);
  sync();
  return () => {
    unsubscribe();
    setEnabled(false);
  };
}

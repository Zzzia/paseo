import type { HostRuntimeStore } from "../host-runtime";

export const keepsConnectionsActiveInBackground = false;

export function bindBackgroundConnectionRuntime(
  _store: HostRuntimeStore,
  _onError: (error: unknown) => void,
): () => void {
  return () => {};
}

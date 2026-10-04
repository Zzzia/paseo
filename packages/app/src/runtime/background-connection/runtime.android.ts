import { AppRegistry } from "react-native";
import { requireNativeModule, NativeModule } from "expo-modules-core";
import type { HostRuntimeStore } from "../host-runtime";
import { bindBackgroundConnection } from "./binding";

export const keepsConnectionsActiveInBackground = true;

interface BackgroundConnectionError {
  message: string;
}

declare class BackgroundConnectionModule extends NativeModule<
  Record<"onError", (event: BackgroundConnectionError) => void>
> {
  setEnabled(enabled: boolean): Promise<void>;
  waitForStop(sessionId: string): Promise<void>;
}

const backgroundConnection = requireNativeModule<BackgroundConnectionModule>(
  "PaseoBackgroundConnection",
);

// 复用应用运行时；任务只持有后台执行资格，连接仍由 HostRuntime 唯一管理。
AppRegistry.registerHeadlessTask("PaseoBackgroundConnection", () => {
  return ({ sessionId }: { sessionId: string }) => backgroundConnection.waitForStop(sessionId);
});

export function bindBackgroundConnectionRuntime(
  store: HostRuntimeStore,
  onError: (error: unknown) => void,
): () => void {
  const errors = backgroundConnection.addListener("onError", ({ message }) => {
    onError(new Error(message));
  });
  const unbind = bindBackgroundConnection(store, {
    setEnabled: (enabled) => backgroundConnection.setEnabled(enabled),
    onError,
  });
  return () => {
    errors.remove();
    unbind();
  };
}

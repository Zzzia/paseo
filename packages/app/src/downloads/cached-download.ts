import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  sameDownloadVersion,
  type CachedDownload,
  type DownloadCache,
  type DownloadSource,
} from "./download-cache";

interface CachedDownloadInput extends DownloadSource {
  cache: DownloadCache | null;
  client: Pick<DaemonClient, "observeFile"> | null;
  signal: AbortSignal;
}

export async function getCachedDownload(
  input: CachedDownloadInput,
): Promise<CachedDownload | null> {
  assertDownloadNotCancelled(input.signal);
  const cached = await input.cache?.get(input);
  assertDownloadNotCancelled(input.signal);
  if (!cached) return null;
  // 本地文件可独立使用；有连接对象时才查询远端版本，查询错误必须显式显示。
  if (!input.client) return cached;
  const subscription = input.client.observeFile({
    cwd: input.cwd,
    path: input.path,
    signal: input.signal,
  });
  try {
    const { initial } = await subscription.ready;
    assertDownloadNotCancelled(input.signal);
    if (initial.status === "missing") throw new Error(`File no longer exists: ${input.path}`);
    if (initial.status === "error") throw new Error(initial.error);
    return sameDownloadVersion(cached.version, initial) ? cached : null;
  } finally {
    await subscription.release();
  }
}

export function assertDownloadNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Download cancelled");
}

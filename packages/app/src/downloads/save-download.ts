import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  DownloadDestination,
  DownloadedFile,
  DownloadDestinationInput,
} from "./destination.types";
import type { DownloadCache, DownloadSource } from "./download-cache";
import { assertDownloadNotCancelled, getCachedDownload } from "./cached-download";

interface SaveDownloadInput extends DownloadSource {
  id: string;
  client: Pick<DaemonClient, "downloadFile" | "observeFile">;
  cache: DownloadCache | null;
  destination(input: DownloadDestinationInput): DownloadDestination;
  signal: AbortSignal;
  onFileName(fileName: string): void;
  onProgress(bytesWritten: number, totalBytes: number): void;
}

interface DownloadTarget {
  destination: DownloadDestination | null;
  aborting: Promise<{ error: unknown } | null> | null;
}

export async function saveDownload(input: SaveDownloadInput): Promise<DownloadedFile | null> {
  assertDownloadNotCancelled(input.signal);
  const cached = await getCachedDownload(input);
  assertDownloadNotCancelled(input.signal);
  if (cached) {
    input.onFileName(cached.file.fileName);
    input.onProgress(cached.version.size, cached.version.size);
    return cached.file;
  }
  const target: DownloadTarget = { destination: null, aborting: null };
  const cancel = () => {
    // 末帧之后仍可能在落盘，取消必须直达目的地，不能等 finish 返回。
    void abortDownloadTarget(target);
  };
  input.signal.addEventListener("abort", cancel, { once: true });
  try {
    const metadata = await receiveDownload(input, target);
    assertDownloadNotCancelled(input.signal);
    if (!target.destination) throw new Error("Download returned no file");
    const file = await target.destination.finish();
    assertDownloadNotCancelled(input.signal);
    if (file) await input.cache?.put(input, file, metadata);
    assertDownloadNotCancelled(input.signal);
    return file;
  } catch (error) {
    await discardPartialDownload(target, error);
    throw error;
  } finally {
    input.signal.removeEventListener("abort", cancel);
  }
}

function receiveDownload(input: SaveDownloadInput, target: DownloadTarget) {
  return input.client.downloadFile({
    cwd: input.cwd,
    path: input.path,
    signal: input.signal,
    onStart(metadata) {
      target.destination = input.destination({ id: input.id, ...metadata });
      input.onFileName(metadata.fileName);
    },
    onChunk(bytes) {
      if (!target.destination) throw new Error("Download destination has not been created");
      target.destination.write(bytes);
    },
    onProgress: input.onProgress,
  });
}

async function discardPartialDownload(target: DownloadTarget, downloadError: unknown) {
  const aborted = await abortDownloadTarget(target);
  if (aborted) {
    const failure = downloadError instanceof Error ? downloadError.message : String(downloadError);
    throw new Error(`Download failed (${failure}); its partial file could not be closed`, {
      cause: aborted.error,
    });
  }
}

function abortDownloadTarget(target: DownloadTarget) {
  if (!target.destination) return null;
  const destination = target.destination;
  // 取消事件与错误清理共享一次关闭；结果由保存主流程检查，避免异步清理错误丢失。
  target.aborting ??= Promise.resolve()
    .then(() => destination.abort())
    .then(
      () => null,
      (error: unknown) => ({ error }),
    );
  return target.aborting;
}

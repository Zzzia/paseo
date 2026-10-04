export interface DownloadProgress {
  percent: number;
  bytesWritten: number;
  totalBytes: number;
  speed: number;
  eta: number;
}

export function createDownloadProgressReporter(
  publish: (progress: DownloadProgress) => void,
  signal: AbortSignal,
) {
  let latest: DownloadProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let publishedAt: number | null = null;
  let disposed = false;

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (disposed || !latest) return;
    const progress = latest;
    latest = null;
    publishedAt = Date.now();
    publish(progress);
  }

  function dispose() {
    disposed = true;
    latest = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    signal.removeEventListener("abort", dispose);
  }

  signal.addEventListener("abort", dispose, { once: true });
  return {
    report(progress: DownloadProgress) {
      if (disposed || signal.aborted) return;
      latest = progress;
      // 文件块仍逐个保存；合并 React 更新，给手势提交和取消点击留出执行时间。
      if (publishedAt === null || progress.bytesWritten === progress.totalBytes) {
        flush();
        return;
      }
      if (timer !== null) return;
      const remaining = 200 - (Date.now() - publishedAt);
      if (remaining <= 0) flush();
      else timer = setTimeout(flush, remaining);
    },
    dispose,
  };
}

export function downloadProgress(
  bytesWritten: number,
  totalBytes: number,
  startedAt: number,
): DownloadProgress {
  const elapsed = (Date.now() - startedAt) / 1000;
  const speed = elapsed > 0 ? bytesWritten / elapsed : 0;
  return {
    percent: totalBytes > 0 ? bytesWritten / totalBytes : 1,
    bytesWritten,
    totalBytes,
    speed,
    eta: speed > 0 ? (totalBytes - bytesWritten) / speed : 0,
  };
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number): string {
  if (seconds < 1) return "< 1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

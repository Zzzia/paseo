import { expect, test, vi } from "vitest";
import { createDownloadStore, type DownloadInput } from "./model";
import { downloadSourceKey, type CachedDownload } from "./download-cache";
import type { DownloadedFile } from "./destination.types";

type Dependencies = Parameters<typeof createDownloadStore>[0];
type SaveInput = Parameters<Dependencies["save"]>[0];

function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

const file = { uri: "file:///downloads/video.mp4", fileName: "video.mp4", mimeType: "video/mp4" };
const cached: CachedDownload = { file, version: { size: 10, modifiedAt: "2026-10-02T00:00:00Z" } };
const input: DownloadInput = {
  serverId: "host-a",
  cwd: "/project",
  path: "video.mp4",
  fileName: "video.mp4",
  client: {
    downloadFile: async () => {
      throw new Error("Unexpected direct client download");
    },
    observeFile: () => {
      throw new Error("Unexpected direct client subscription");
    },
  },
};

function fixture() {
  const index = new Map<string, CachedDownload>();
  const transfers: Array<{
    input: SaveInput;
    result: ReturnType<typeof deferred<DownloadedFile | null>>;
  }> = [];
  const opened: DownloadedFile[] = [];
  const shared: DownloadedFile[] = [];
  const deps: Dependencies = {
    inspect: async (source) => index.get(downloadSourceKey(source)) ?? null,
    save: (request) => {
      const result = deferred<DownloadedFile | null>();
      transfers.push({ input: request, result });
      return result.promise;
    },
    open: async (result) => {
      opened.push(result);
    },
    share: async (result) => {
      shared.push(result);
    },
    message: (key) => key,
  };
  const store = createDownloadStore(deps);
  const current = (source = input) => store.getState().downloads.get(downloadSourceKey(source));
  const inspect = (source = input, controller = new AbortController()) =>
    store.getState().inspectDownload({ ...source, signal: controller.signal });
  return { store, deps, index, transfers, opened, shared, current, inspect };
}

test("restores a cached file as ready to open without starting any transfer", async () => {
  const state = fixture();
  state.index.set(downloadSourceKey(input), cached);
  await state.inspect();
  expect(state.current()).toMatchObject({ status: "complete", file });
  expect(state.transfers).toHaveLength(0);
  await state.store.getState().openDownload(input);
  expect(state.opened).toEqual([file]);
  expect(state.transfers).toHaveLength(0);
});

test("keeps progress and completed files independent for different file tabs", async () => {
  const state = fixture();
  const other = { ...input, path: "other.mp4", fileName: "other.mp4" };
  const first = state.store.getState().startDownload(input);
  const second = state.store.getState().startDownload(other);
  state.transfers[0].input.onProgress(4, 10);
  state.transfers[1].input.onProgress(8, 20);
  expect(state.current()?.progress).toMatchObject({
    bytesWritten: 4,
    totalBytes: 10,
    percent: 0.4,
  });
  expect(state.current(other)?.progress).toMatchObject({
    bytesWritten: 8,
    totalBytes: 20,
    percent: 0.4,
  });
  state.transfers[0].result.resolve(file);
  await first;
  expect(state.current()).toMatchObject({ status: "complete", file });
  expect(state.current(other)?.status).toBe("downloading");
  state.transfers[1].result.resolve(null);
  await second;
  expect(state.current(other)?.status).toBe("complete");
});

test("deduplicates the same source while a transfer is running", async () => {
  const state = fixture();
  const first = state.store.getState().startDownload(input);
  await state.store.getState().startDownload({ ...input });
  await state.inspect();
  expect(state.transfers).toHaveLength(1);
  expect(state.current()?.status).toBe("downloading");
  state.transfers[0].result.resolve(file);
  await first;
});

test.each([{ serverId: "host-b" }, { cwd: "/other" }, { path: "other.mp4" }])(
  "does not show another source's cached file: %j",
  async (difference) => {
    const state = fixture();
    state.index.set(downloadSourceKey(input), cached);
    await state.inspect(input);
    const other = { ...input, ...difference };
    await state.inspect(other);
    expect(state.current()?.status).toBe("complete");
    expect(state.current(other)).toMatchObject({ status: "idle" });
    expect(state.current(other)?.file).toBeUndefined();
  },
);

test("a cancelled inspection cannot overwrite a later download", async () => {
  const state = fixture();
  const delayed = deferred<CachedDownload | null>();
  state.deps.inspect = () => delayed.promise;
  const controller = new AbortController();
  const inspection = state.inspect(input, controller);
  const download = state.store.getState().startDownload(input);
  controller.abort();
  delayed.resolve(cached);
  await inspection;
  expect(state.current()?.status).toBe("downloading");
  expect(state.current()?.file).toBeUndefined();
  state.transfers[0].result.resolve(file);
  await download;
});

test("cancelling an inspection releases its loading state", async () => {
  const state = fixture();
  const delayed = deferred<CachedDownload | null>();
  state.deps.inspect = () => delayed.promise;
  const controller = new AbortController();
  const inspection = state.inspect(input, controller);
  expect(state.current()?.status).toBe("checking");
  controller.abort();
  delayed.reject(new Error("Cancelled metadata query"));
  await inspection;
  expect(state.current()?.status).toBe("idle");
});

test("a cancelled transfer cannot complete or overwrite a retried transfer", async () => {
  const state = fixture();
  const first = state.store.getState().startDownload(input);
  state.store.getState().cancelDownload(input);
  expect(state.transfers[0].input.signal.aborted).toBe(true);
  expect(state.current()?.status).toBe("cancelled");
  const retry = state.store.getState().startDownload(input);
  state.transfers[0].input.onProgress(10, 10);
  state.transfers[0].result.resolve(file);
  await first;
  expect(state.current()?.status).toBe("downloading");
  expect(state.current()?.progress).toBeUndefined();
  state.transfers[1].result.resolve(file);
  await retry;
  expect(state.current()?.status).toBe("complete");
});

test("coalesces progress bursts while publishing the latest bytes and final progress", async () => {
  vi.useFakeTimers();
  try {
    const state = fixture();
    const download = state.store.getState().startDownload(input);
    const published: number[] = [];
    const unsubscribe = state.store.subscribe((value) => {
      const progress = value.downloads.get(downloadSourceKey(input))?.progress;
      if (progress) published.push(progress.bytesWritten);
    });
    const report = state.transfers[0].input.onProgress;
    report(0, 1000);
    for (let written = 1; written <= 100; written++) report(written, 1000);
    expect(published).toEqual([0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(published).toEqual([0, 100]);
    for (let written = 101; written <= 999; written++) report(written, 1000);
    report(1000, 1000);
    expect(published).toEqual([0, 100, 1000]);
    unsubscribe();
    state.transfers[0].result.resolve(file);
    await download;
  } finally {
    vi.useRealTimers();
  }
});

test("cancels immediately and never publishes queued progress after cancellation", async () => {
  vi.useFakeTimers();
  try {
    const state = fixture();
    const download = state.store.getState().startDownload(input);
    const transfer = state.transfers[0];
    transfer.input.onProgress(1, 1000);
    transfer.input.onProgress(100, 1000);
    state.store.getState().cancelDownload(input);
    expect(state.current()).toMatchObject({ status: "cancelled", progress: { bytesWritten: 1 } });
    transfer.input.onProgress(1000, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.current()).toMatchObject({ status: "cancelled", progress: { bytesWritten: 1 } });
    transfer.result.reject(new Error("Download cancelled"));
    await download;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("retains a failed file action and allows sharing the completed file", async () => {
  const state = fixture();
  state.index.set(downloadSourceKey(input), cached);
  state.deps.open = async () => {
    throw new Error("No MP4 player");
  };
  await state.inspect();
  await state.store.getState().openDownload(input);
  expect(state.current()).toMatchObject({
    status: "complete",
    file,
    message: "downloads.openFailed No MP4 player",
  });
  expect(state.current()?.action).toBeUndefined();
  await state.store.getState().shareDownload(input);
  expect(state.shared).toEqual([file]);
  expect(state.current()?.message).toBeUndefined();
});

test("switches back to download when the local file disappeared before opening", async () => {
  const state = fixture();
  state.index.set(downloadSourceKey(input), cached);
  await state.inspect();
  state.index.delete(downloadSourceKey(input));
  await state.store.getState().openDownload(input);
  expect(state.current()).toMatchObject({ status: "idle" });
  expect(state.current()?.file).toBeUndefined();
  expect(state.opened).toHaveLength(0);
  expect(state.transfers).toHaveLength(0);
});

test("keeps a download failure visible until an explicit retry", async () => {
  const state = fixture();
  const download = state.store.getState().startDownload(input);
  state.transfers[0].result.reject(new Error("Connection closed"));
  await download;
  await state.inspect();
  expect(state.current()).toMatchObject({ status: "error", message: "Connection closed" });
  const retry = state.store.getState().startDownload(input);
  state.transfers[1].result.resolve(file);
  await retry;
  expect(state.current()).toMatchObject({ status: "complete", file });
});

test("shows metadata and disconnected-host failures in the file's own state", async () => {
  const state = fixture();
  state.deps.inspect = async () => {
    throw new Error("Metadata query failed");
  };
  await state.inspect();
  expect(state.current()).toMatchObject({ status: "error", message: "Metadata query failed" });
  await state.store.getState().startDownload({ ...input, client: null });
  expect(state.current()).toMatchObject({ status: "error", message: "downloads.hostUnavailable" });
  expect(state.transfers).toHaveLength(0);
});

test("closing all views releases transient state while preserving the persisted file", async () => {
  const state = fixture();
  state.index.set(downloadSourceKey(input), cached);
  const closeFirst = state.store.getState().retainDownload(input);
  const closeSecond = state.store.getState().retainDownload(input);
  await state.inspect();
  closeFirst();
  expect(state.current()?.status).toBe("complete");
  closeSecond();
  expect(state.current()).toBeUndefined();
  expect(state.index.get(downloadSourceKey(input))).toEqual(cached);
  const closeReopened = state.store.getState().retainDownload(input);
  await state.inspect();
  expect(state.current()).toMatchObject({ status: "complete", file });
  closeReopened();
});

test("closing a file view keeps its transfer running and releases state only after it finishes", async () => {
  const state = fixture();
  const close = state.store.getState().retainDownload(input);
  const download = state.store.getState().startDownload(input);
  close();
  expect(state.current()?.status).toBe("downloading");
  expect(state.transfers[0].input.signal.aborted).toBe(false);
  state.index.set(downloadSourceKey(input), cached);
  state.transfers[0].result.resolve(file);
  await download;
  expect(state.current()).toBeUndefined();
  expect(state.index.get(downloadSourceKey(input))).toEqual(cached);
});

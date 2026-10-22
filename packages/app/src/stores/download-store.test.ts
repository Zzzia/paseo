import { beforeEach, expect, it, vi } from "vitest";
import { useDownloadStore } from "./download-store";
import { downloadSourceKey } from "@/downloads/download-cache";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const destination = vi.hoisted(() => ({
  write: vi.fn(),
  finish: vi.fn(),
  abort: vi.fn(),
}));
const opened = vi.hoisted(() => vi.fn());
const cachedFiles = vi.hoisted(() => new Map());
vi.mock("@/downloads/cache", () => ({
  downloadCache: {
    get: async (source: { path: string }) => cachedFiles.get(source.path) ?? null,
    put: async (source: { path: string }, file: unknown, version: unknown) => {
      cachedFiles.set(source.path, { file, version });
    },
  },
}));
vi.mock("@/downloads/destination", () => ({
  createDownloadDestination: () => destination,
  openDownloadedFile: opened,
  shareDownloadedFile: vi.fn(),
}));

const source = { serverId: "remote", cwd: "/project", path: "报告.mp4", fileName: "报告.mp4" };
const file = { uri: "file:///download/报告.mp4", fileName: source.fileName, mimeType: "video/mp4" };

beforeEach(() => {
  vi.resetAllMocks();
  cachedFiles.clear();
  useDownloadStore.setState({ downloads: new Map() });
  destination.finish.mockResolvedValue(file);
  destination.abort.mockResolvedValue(undefined);
  opened.mockResolvedValue(undefined);
});

function client(downloadFile: DaemonClient["downloadFile"]) {
  return { downloadFile, observeFile: vi.fn() };
}

it.each([0, 5 * 1024 * 1024 + 37])(
  "downloads %i bytes through the active session and opens the complete file",
  async (size) => {
    const bytes = new Uint8Array(size).fill(213);
    const downloadFile = vi.fn<DaemonClient["downloadFile"]>(async (input) => {
      const metadata = {
        fileName: source.fileName,
        mimeType: "video/mp4",
        size,
        modifiedAt: "2026-10-22T00:00:00Z",
      };
      input.onStart(metadata);
      if (size) input.onChunk(bytes);
      input.onProgress?.(size, size);
      return metadata;
    });
    await useDownloadStore.getState().startDownload({ ...source, client: client(downloadFile) });
    const entry = useDownloadStore.getState().downloads.get(downloadSourceKey(source));
    expect(entry).toMatchObject({ status: "complete", file });
    expect(downloadFile).toHaveBeenCalledOnce();
    if (size) {
      expect(destination.write).toHaveBeenCalledOnce();
      expect(destination.write.mock.calls[0]?.[0]).toBe(bytes);
    }
    expect(destination.finish).toHaveBeenCalledOnce();
    expect(destination.abort).not.toHaveBeenCalled();
    await useDownloadStore.getState().openDownload(source);
    expect(opened).toHaveBeenCalledWith(file);
  },
);

it("reports a failed transfer and closes the partial file without offering it for opening", async () => {
  const downloadFile = vi.fn<DaemonClient["downloadFile"]>(async (input) => {
    input.onStart({
      fileName: source.fileName,
      mimeType: "video/mp4",
      size: 10,
      modifiedAt: "2026-10-22T00:00:00Z",
    });
    input.onChunk(new Uint8Array([1]));
    throw new Error("Relay connection lost");
  });
  await useDownloadStore.getState().startDownload({ ...source, client: client(downloadFile) });
  expect(useDownloadStore.getState().downloads.get(downloadSourceKey(source))).toMatchObject({
    status: "error",
    message: "Relay connection lost",
  });
  expect(destination.abort).toHaveBeenCalledOnce();
  expect(destination.finish).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
});

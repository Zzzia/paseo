import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FileVersion } from "@getpaseo/protocol/messages";
import type { DownloadDestinationInput } from "./destination.types";
import { createDownloadCache, type DownloadVersion } from "./download-cache";
import { saveDownload } from "./save-download";
import { getCachedDownload } from "./cached-download";

let directory: string;
const source = { serverId: "host-a", cwd: "/project", path: "video.mp4" };
const version: DownloadVersion = {
  size: 5,
  modifiedAt: "2026-10-02T12:00:00.000Z",
  revision: "file-v1",
};

function createTestDestination(input: DownloadDestinationInput) {
  const destination = path.join(directory, input.id);
  mkdirSync(destination);
  const filePath = path.join(destination, input.fileName);
  writeFileSync(filePath, Buffer.alloc(0));
  return {
    write: (bytes: Uint8Array) => appendFileSync(filePath, bytes),
    finish: () => ({
      uri: pathToFileURL(filePath).href,
      fileName: input.fileName,
      mimeType: input.mimeType,
    }),
    abort: () => rmSync(destination, { recursive: true }),
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "paseo-download-cache-test-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

class DiskIndex {
  constructor(private root = path.join(directory, "index")) {
    mkdirSync(root, { recursive: true });
  }
  private location(key: string) {
    return path.join(this.root, Buffer.from(key).toString("base64url"));
  }
  async getItem(key: string) {
    const filePath = this.location(key);
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
  }
  async setItem(key: string, value: string) {
    writeFileSync(this.location(key), value);
  }
  async removeItem(key: string) {
    rmSync(this.location(key));
  }
}

function createCache(storage = new DiskIndex()) {
  return createDownloadCache({
    storage,
    fileSize(uri) {
      const filePath = fileURLToPath(uri);
      return existsSync(filePath) ? statSync(filePath).size : null;
    },
  });
}

function createClient() {
  const remote: { version: FileVersion } = {
    version: { status: "ready", cwd: source.cwd, path: source.path, ...version },
  };
  const release = vi.fn(async () => {});
  const observeFile = vi.fn(() => ({
    subscriptionId: "version-check",
    ready: Promise.resolve({
      requestId: "version-request",
      subscriptionId: "version-check",
      initial: remote.version,
    }),
    subscribe: () => () => {},
    release,
  }));
  const downloadFile = vi.fn<Parameters<typeof saveDownload>[0]["client"]["downloadFile"]>(
    async (input) => {
      if (remote.version.status !== "ready") throw new Error("Source file is unavailable");
      const { size, modifiedAt, revision } = remote.version;
      const metadata = { fileName: "video.mp4", mimeType: "video/mp4", size, modifiedAt, revision };
      input.onStart(metadata);
      input.onChunk(Uint8Array.from({ length: size }, (_value, index) => index + 1));
      input.onProgress?.(size, size);
      return metadata;
    },
  );
  return { client: { downloadFile, observeFile }, remote, release };
}

function downloadInput(id: string, fixture = createClient()) {
  return {
    id,
    ...source,
    client: fixture.client,
    cache: createCache(),
    destination: createTestDestination,
    signal: new AbortController().signal,
    onFileName: vi.fn(),
    onProgress: vi.fn(),
  };
}

test("reuses a completed native download without transferring its content again", async () => {
  const file = { uri: "file:///downloads/video.mp4", fileName: "video.mp4", mimeType: "video/mp4" };
  const release = vi.fn(async () => {});
  const client = {
    downloadFile: vi.fn(async () => {
      throw new Error("The cached file must not be transferred");
    }),
    observeFile: vi.fn(() => ({
      subscriptionId: "version-check",
      ready: Promise.resolve({
        requestId: "version-request",
        subscriptionId: "version-check",
        initial: { status: "ready" as const, cwd: "/project", path: "video.mp4", ...version },
      }),
      subscribe: () => () => {},
      release,
    })),
  };
  const onFileName = vi.fn();
  const onProgress = vi.fn();
  const result = await saveDownload({
    id: "repeat",
    serverId: "host-a",
    cwd: "/project",
    path: "video.mp4",
    client,
    cache: { get: async () => ({ file, version }), put: async () => {} },
    destination: createTestDestination,
    signal: new AbortController().signal,
    onFileName,
    onProgress,
  });
  expect(result).toEqual(file);
  expect(client.downloadFile).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(1);
  expect(onFileName).toHaveBeenCalledWith("video.mp4");
  expect(onProgress).toHaveBeenCalledWith(5, 5);
});

test("persists complete files and reuses them through fresh storage and download instances", async () => {
  const fixture = createClient();
  const file = await saveDownload(downloadInput("first", fixture));
  expect(fixture.client.observeFile).not.toHaveBeenCalled();
  const restored = await saveDownload(downloadInput("after-restart", fixture));
  expect(restored).toEqual(file);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(1);
  expect(fixture.release).toHaveBeenCalledTimes(1);
  expect(readFileSync(fileURLToPath(restored!.uri))).toEqual(Buffer.from([1, 2, 3, 4, 5]));
  expect(existsSync(path.join(directory, "after-restart"))).toBe(false);
});

test("makes a persisted local file available without a host connection", async () => {
  const fixture = createClient();
  const file = await saveDownload(downloadInput("first", fixture));
  const restored = await getCachedDownload({ ...downloadInput("offline", fixture), client: null });
  expect(restored?.file).toEqual(file);
  expect(fixture.client.observeFile).not.toHaveBeenCalled();
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(1);
});

test.each([
  ["server", { serverId: "host-b" }],
  ["workspace", { cwd: "/other-project" }],
  ["path", { path: "another/video.mp4" }],
])("does not reuse another %s's completed file", async (_label, differentSource) => {
  const fixture = createClient();
  const first = await saveDownload(downloadInput("first", fixture));
  const second = await saveDownload({ ...downloadInput("second", fixture), ...differentSource });
  expect(second!.uri).not.toBe(first!.uri);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(2);
  expect(fixture.client.observeFile).not.toHaveBeenCalled();
});

test("downloads a replaced remote file even when its size and timestamp are unchanged", async () => {
  const fixture = createClient();
  const first = await saveDownload(downloadInput("first", fixture));
  fixture.remote.version = {
    status: "ready",
    cwd: source.cwd,
    path: source.path,
    ...version,
    revision: "file-v2",
  };
  const replacement = await saveDownload(downloadInput("replacement", fixture));
  expect(replacement!.uri).not.toBe(first!.uri);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(2);
  expect(fixture.release).toHaveBeenCalledTimes(1);
  expect(existsSync(fileURLToPath(first!.uri))).toBe(true);
  expect(await saveDownload(downloadInput("third", fixture))).toEqual(replacement);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(2);
});

test("downloads again when the remote file's size changes", async () => {
  const fixture = createClient();
  const first = await saveDownload(downloadInput("first", fixture));
  fixture.remote.version = {
    status: "ready",
    cwd: source.cwd,
    path: source.path,
    ...version,
    size: 6,
  };
  const replacement = await saveDownload(downloadInput("replacement", fixture));
  expect(replacement!.uri).not.toBe(first!.uri);
  expect(readFileSync(fileURLToPath(replacement!.uri))).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(2);
});

test("cancelling while the index is saved does not report a completed download", async () => {
  const fixture = createClient();
  const storage = new DiskIndex();
  const controller = new AbortController();
  const writeIndex = storage.setItem.bind(storage);
  storage.setItem = async (key, value) => {
    await writeIndex(key, value);
    controller.abort();
  };
  const input = {
    ...downloadInput("cancelled-index", fixture),
    signal: controller.signal,
    cache: createCache(storage),
  };
  await expect(saveDownload(input)).rejects.toThrow("Download cancelled");
  expect(await input.cache.get(source)).toBeNull();
  expect(existsSync(path.join(directory, "cancelled-index"))).toBe(false);
});

test.each(["removed", "truncated"])(
  "downloads again when the local file was %s",
  async (change) => {
    const fixture = createClient();
    const first = await saveDownload(downloadInput("first", fixture));
    const localPath = fileURLToPath(first!.uri);
    if (change === "removed") rmSync(localPath);
    else writeFileSync(localPath, Buffer.from([1]));
    const replacement = await saveDownload(downloadInput("replacement", fixture));
    expect(replacement!.uri).not.toBe(first!.uri);
    expect(fixture.client.downloadFile).toHaveBeenCalledTimes(2);
    expect(fixture.client.observeFile).not.toHaveBeenCalled();
  },
);

test("supports legacy versions without revision using size and modification time", async () => {
  const fixture = createClient();
  fixture.client.downloadFile.mockImplementation(async (input) => {
    const metadata = {
      fileName: "video.mp4",
      mimeType: "video/mp4",
      ...version,
      revision: undefined,
    };
    input.onStart(metadata);
    input.onChunk(new Uint8Array([1, 2, 3, 4, 5]));
    return metadata;
  });
  fixture.remote.version = {
    status: "ready",
    cwd: source.cwd,
    path: source.path,
    ...version,
    revision: undefined,
  };
  const first = await saveDownload(downloadInput("first", fixture));
  expect(await saveDownload(downloadInput("repeat", fixture))).toEqual(first);
  fixture.remote.version = { ...fixture.remote.version, modifiedAt: "2026-10-02T12:01:00.000Z" };
  expect((await saveDownload(downloadInput("changed", fixture)))!.uri).not.toBe(first!.uri);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(2);
});

test.each([
  [
    "missing",
    { status: "missing" as const, cwd: source.cwd, path: source.path },
    "File no longer exists",
  ],
  [
    "error",
    { status: "error" as const, cwd: source.cwd, path: source.path, error: "permission denied" },
    "permission denied",
  ],
])("reports a remote %s while retaining the cached file", async (_label, nextVersion, message) => {
  const fixture = createClient();
  const first = await saveDownload(downloadInput("first", fixture));
  fixture.remote.version = nextVersion;
  await expect(saveDownload(downloadInput("repeat", fixture))).rejects.toThrow(message);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(1);
  expect(fixture.release).toHaveBeenCalledTimes(1);
  expect(existsSync(fileURLToPath(first!.uri))).toBe(true);
});

test("cancellation during version validation keeps the existing file and stops reuse", async () => {
  const fixture = createClient();
  const first = await saveDownload(downloadInput("first", fixture));
  const controller = new AbortController();
  const observeFile = fixture.client.observeFile.getMockImplementation()!;
  fixture.client.observeFile.mockImplementation(() => {
    controller.abort();
    return observeFile();
  });
  await expect(
    saveDownload({ ...downloadInput("repeat", fixture), signal: controller.signal }),
  ).rejects.toThrow("Download cancelled");
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(1);
  expect(fixture.release).toHaveBeenCalledTimes(1);
  expect(existsSync(fileURLToPath(first!.uri))).toBe(true);
});

test("failed transfers never publish a cache entry and remove their own partial destination", async () => {
  const fixture = createClient();
  fixture.client.downloadFile.mockImplementation(async (input) => {
    input.onStart({ fileName: "video.mp4", mimeType: "video/mp4", ...version });
    input.onChunk(new Uint8Array([1, 2]));
    throw new Error("Connection closed during download");
  });
  const input = downloadInput("partial", fixture);
  await expect(saveDownload(input)).rejects.toThrow("Connection closed during download");
  expect(await input.cache.get(source)).toBeNull();
  expect(existsSync(path.join(directory, "partial"))).toBe(false);
});

test("cancels native finalization immediately and closes the destination once", async () => {
  const fixture = createClient();
  const controller = new AbortController();
  let beginFinish!: () => void;
  let rejectFinish!: (error: Error) => void;
  const finishing = new Promise<void>((resolve) => {
    beginFinish = resolve;
  });
  const abort = vi.fn(async () => {
    rejectFinish(new Error("Download cancelled"));
  });
  const input = {
    ...downloadInput("cancel-finalization", fixture),
    signal: controller.signal,
    destination(metadata: DownloadDestinationInput) {
      return {
        ...createTestDestination(metadata),
        finish() {
          beginFinish();
          return new Promise<never>((_resolve, reject) => {
            rejectFinish = reject;
          });
        },
        abort,
      };
    },
  };
  const saving = saveDownload(input);
  const result = expect(saving).rejects.toThrow("Download cancelled");
  await finishing;
  expect(await input.cache.get(source)).toBeNull();
  controller.abort();
  await result;
  expect(abort).toHaveBeenCalledTimes(1);
  expect(await input.cache.get(source)).toBeNull();
});

test("never caches a file when background finalization fails", async () => {
  const fixture = createClient();
  const abort = vi.fn(async () => {});
  const input = {
    ...downloadInput("failed-finalization", fixture),
    destination(metadata: DownloadDestinationInput) {
      return {
        ...createTestDestination(metadata),
        finish: async () => {
          throw new Error("native disk full");
        },
        abort,
      };
    },
  };
  await expect(saveDownload(input)).rejects.toThrow("native disk full");
  expect(abort).toHaveBeenCalledTimes(1);
  expect(await input.cache.get(source)).toBeNull();
});

test("empty files are cached and reused", async () => {
  const fixture = createClient();
  fixture.client.downloadFile.mockImplementation(async (input) => {
    const metadata = { fileName: "video.mp4", mimeType: "video/mp4", ...version, size: 0 };
    input.onStart(metadata);
    return metadata;
  });
  fixture.remote.version = {
    status: "ready",
    cwd: source.cwd,
    path: source.path,
    ...version,
    size: 0,
  };
  const first = await saveDownload(downloadInput("empty", fixture));
  expect(await saveDownload(downloadInput("repeat", fixture))).toEqual(first);
  expect(fixture.client.downloadFile).toHaveBeenCalledTimes(1);
});

test("propagates cache persistence failures instead of reporting completion", async () => {
  const fixture = createClient();
  const storage = new DiskIndex();
  storage.setItem = async () => {
    throw new Error("index disk full");
  };
  const input = { ...downloadInput("failed-index", fixture), cache: createCache(storage) };
  await expect(saveDownload(input)).rejects.toThrow("index disk full");
  expect(await input.cache.get(source)).toBeNull();
  expect(existsSync(path.join(directory, "failed-index"))).toBe(false);
});

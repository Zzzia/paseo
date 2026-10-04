import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { appendFileSync, readFileSync } from "node:fs";
import { FILE_EXPLORER_STREAM_CHUNK_BYTES } from "../file-explorer/service.js";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-"));
}

// Use gpt-5.4-mini with low thinking preset for faster test execution
const CODEX_TEST_MODEL = "gpt-5.4-mini";
const CODEX_TEST_THINKING_OPTION_ID = "low";

describe("daemon E2E", () => {
  let ctx: DaemonTestContext;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  }, 60000);

  describe("binary stream downloads", () => {
    test("downloads a large MP4 over the active connection without HTTP", async () => {
      const cwd = tmpCwd();
      const source = Buffer.alloc(5 * 1024 * 1024 + 17, 137);
      const filePath = path.join(cwd, "远端视频.mp4");
      writeFileSync(filePath, source);
      const outputPath = path.join(cwd, "downloaded.mp4");
      writeFileSync(outputPath, Buffer.alloc(0));
      const progress: number[] = [];
      try {
        const metadata = await ctx.client.downloadFile({
          cwd,
          path: "远端视频.mp4",
          onStart: (file) => expect(file.mimeType).toBe("video/mp4"),
          onChunk: (bytes) => {
            expect(bytes.length).toBeLessThanOrEqual(FILE_EXPLORER_STREAM_CHUNK_BYTES);
            appendFileSync(outputPath, bytes);
          },
          onProgress: (bytes) => progress.push(bytes),
        });
        expect(metadata).toMatchObject({ fileName: "远端视频.mp4", size: source.length });
        expect(readFileSync(outputPath)).toEqual(source);
        expect(progress[0]).toBe(0);
        expect(progress.at(-1)).toBe(source.length);
        expect(progress).toHaveLength(22);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    test("downloads an empty unknown file", async () => {
      const cwd = tmpCwd();
      writeFileSync(path.join(cwd, "empty.unknown"), "");
      const received: Uint8Array[] = [];
      try {
        const metadata = await ctx.client.downloadFile({
          cwd,
          path: "empty.unknown",
          onStart: () => {},
          onChunk: (bytes) => {
            received.push(bytes);
          },
        });
        expect(metadata.size).toBe(0);
        expect(received).toEqual([]);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    test("rejects a source file changed during streaming", async () => {
      const cwd = tmpCwd();
      const filePath = path.join(cwd, "changing.bin");
      writeFileSync(filePath, Buffer.alloc(FILE_EXPLORER_STREAM_CHUNK_BYTES * 80 + 7, 1));
      let received = 0;
      try {
        await expect(
          ctx.client.downloadFile({
            cwd,
            path: "changing.bin",
            onStart: () => {},
            onChunk: (bytes) => {
              received += bytes.length;
              if (received === bytes.length) appendFileSync(filePath, "changed");
            },
          }),
        ).rejects.toThrow("File changed during transfer");
        expect(received).toBeGreaterThan(0);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    test("cancels local writes without closing the shared connection", async () => {
      const cwd = tmpCwd();
      writeFileSync(
        path.join(cwd, "cancel.mp4"),
        Buffer.alloc(FILE_EXPLORER_STREAM_CHUNK_BYTES + 7),
      );
      const controller = new AbortController();
      let received = 0;
      try {
        await expect(
          ctx.client.downloadFile({
            cwd,
            path: "cancel.mp4",
            signal: controller.signal,
            onStart: () => {},
            onChunk: (bytes) => {
              received += bytes.length;
              controller.abort();
            },
          }),
        ).rejects.toThrow();
        expect(received).toBe(FILE_EXPLORER_STREAM_CHUNK_BYTES);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    test("rejects missing files and directories", async () => {
      const cwd = tmpCwd();
      try {
        await expect(
          ctx.client.downloadFile({
            cwd,
            path: "missing.mp4",
            onStart: () => {},
            onChunk: () => {},
          }),
        ).rejects.toThrow("ENOENT");
        await expect(
          ctx.client.downloadFile({ cwd, path: ".", onStart: () => {}, onChunk: () => {} }),
        ).rejects.toThrow("not a file");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("file download tokens", () => {
    test("issues token over WS and downloads via HTTP", async () => {
      const cwd = tmpCwd();
      const filePath = path.join(cwd, "download.txt");
      const fileContents = "download test payload";
      writeFileSync(filePath, fileContents, "utf-8");

      const agent = await ctx.client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd,
        title: "Download Token Test Agent",
      });

      expect(agent.id).toBeTruthy();

      const tokenResponse = await ctx.client.requestDownloadToken(cwd, "download.txt");

      expect(tokenResponse.error).toBeNull();
      expect(tokenResponse.token).toBeTruthy();
      expect(tokenResponse.fileName).toBe("download.txt");

      const response = await fetch(
        `http://127.0.0.1:${ctx.daemon.port}/api/files/download?token=${tokenResponse.token}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(tokenResponse.mimeType);
      const disposition = response.headers.get("content-disposition") ?? "";
      expect(disposition).toContain("download.txt");

      const body = await response.text();
      expect(body).toBe(fileContents);

      rmSync(cwd, { recursive: true, force: true });
    }, 60000);

    test("rejects invalid token", async () => {
      const response = await fetch(
        `http://127.0.0.1:${ctx.daemon.port}/api/files/download?token=invalid-token`,
      );

      expect(response.status).toBe(403);
    }, 30000);

    test("rejects expired token", async () => {
      await ctx.cleanup();
      ctx = await createDaemonTestContext({ downloadTokenTtlMs: 50 });

      const cwd = tmpCwd();
      const filePath = path.join(cwd, "expired.txt");
      writeFileSync(filePath, "expired", "utf-8");

      await ctx.client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd,
        title: "Expired Token Test Agent",
      });

      const tokenResponse = await ctx.client.requestDownloadToken(cwd, "expired.txt");

      expect(tokenResponse.error).toBeNull();
      expect(tokenResponse.token).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 150));

      const response = await fetch(
        `http://127.0.0.1:${ctx.daemon.port}/api/files/download?token=${tokenResponse.token}`,
      );

      expect(response.status).toBe(403);

      rmSync(cwd, { recursive: true, force: true });
    }, 60000);

    test("rejects paths outside the workspace cwd", async () => {
      const cwd = tmpCwd();
      await ctx.client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd,
        title: "Outside Path Token Test Agent",
      });

      const tokenResponse = await ctx.client.requestDownloadToken(cwd, "../outside.txt");

      expect(tokenResponse.token).toBeNull();
      expect(tokenResponse.error).toBeTruthy();

      rmSync(cwd, { recursive: true, force: true });
    }, 60000);
  });
});

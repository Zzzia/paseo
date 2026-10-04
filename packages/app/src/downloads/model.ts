import { create } from "zustand";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DownloadedFile } from "./destination.types";
import { downloadSourceKey, type CachedDownload, type DownloadSource } from "./download-cache";
import {
  createDownloadProgressReporter,
  downloadProgress,
  type DownloadProgress,
} from "./progress";
import type { saveDownload } from "./save-download";

type DownloadClient = Pick<DaemonClient, "downloadFile" | "observeFile">;

export interface Download extends DownloadSource {
  id: string;
  fileName: string;
  status: "checking" | "idle" | "downloading" | "complete" | "error" | "cancelled";
  message?: string;
  progress?: DownloadProgress;
  file?: DownloadedFile;
  action?: "open" | "share";
}

export interface DownloadInput extends DownloadSource {
  fileName: string;
  client: DownloadClient | null;
}

interface InspectDownloadInput extends DownloadInput {
  signal: AbortSignal;
}

interface DownloadState {
  downloads: Map<string, Download>;
  retainDownload(source: DownloadSource): () => void;
  inspectDownload(input: InspectDownloadInput): Promise<void>;
  startDownload(input: DownloadInput): Promise<void>;
  cancelDownload(source: DownloadSource): void;
  openDownload(source: DownloadSource): Promise<void>;
  shareDownload(source: DownloadSource): Promise<void>;
}

type DownloadMessageKey =
  | "downloads.hostUnavailable"
  | "downloads.cancelled"
  | "downloads.failed"
  | "downloads.openFailed"
  | "downloads.shareFailed";

interface DownloadDependencies {
  inspect(input: InspectDownloadInput): Promise<CachedDownload | null>;
  save(
    input: Omit<Parameters<typeof saveDownload>[0], "cache" | "destination">,
  ): Promise<DownloadedFile | null>;
  open(file: DownloadedFile): Promise<void>;
  share(file: DownloadedFile): Promise<void>;
  message(key: DownloadMessageKey): string;
}

export function createDownloadStore(deps: DownloadDependencies) {
  const controllers = new Map<string, AbortController>();
  const views = new Map<string, number>();
  return create<DownloadState>()((set, get) => {
    function update(source: DownloadSource, id: string, patch: Partial<Download>) {
      const key = downloadSourceKey(source);
      set((state) => {
        const current = state.downloads.get(key);
        if (!current || current.id !== id) return state;
        const next = { ...current, ...patch };
        const downloads = new Map(state.downloads);
        if (views.get(key) === 0 && next.status !== "downloading") {
          downloads.delete(key);
          views.delete(key);
        } else {
          downloads.set(key, next);
        }
        return { downloads };
      });
    }

    function retainDownload(source: DownloadSource) {
      const key = downloadSourceKey(source);
      views.set(key, (views.get(key) ?? 0) + 1);
      return () => {
        const remaining = (views.get(key) ?? 1) - 1;
        views.set(key, remaining);
        if (remaining > 0 || get().downloads.get(key)?.status === "downloading") return;
        views.delete(key);
        set((state) => {
          const downloads = new Map(state.downloads);
          downloads.delete(key);
          return { downloads };
        });
      };
    }

    function begin(input: DownloadInput, status: Download["status"]): Download {
      const entry: Download = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        serverId: input.serverId,
        cwd: input.cwd,
        path: input.path,
        fileName: input.fileName,
        status,
      };
      set((state) => ({
        downloads: new Map(state.downloads).set(downloadSourceKey(input), entry),
      }));
      return entry;
    }

    async function inspectDownload(input: InspectDownloadInput) {
      const previous = get().downloads.get(downloadSourceKey(input));
      if (previous?.status === "downloading" || previous?.action) return;
      if (previous?.status === "error" || previous?.status === "cancelled") return;
      if (previous?.status === "complete" && !previous.file) return;
      const entry = begin(input, "checking");
      try {
        const cached = await deps.inspect(input);
        if (input.signal.aborted) return;
        if (!cached) {
          update(input, entry.id, { status: "idle" });
          return;
        }
        update(input, entry.id, { status: "complete", file: cached.file });
      } catch (error) {
        if (input.signal.aborted) return;
        update(input, entry.id, { status: "error", message: failureMessage(error) });
      } finally {
        // 隐藏页取消检查不能留下永久 loading，也不能覆盖后来发起的下载。
        if (input.signal.aborted) update(input, entry.id, { status: "idle" });
      }
    }

    async function startDownload(input: DownloadInput) {
      const previous = get().downloads.get(downloadSourceKey(input));
      if (previous?.status === "downloading" || previous?.action) return;
      const entry = begin(input, "downloading");
      const controller = new AbortController();
      controllers.set(entry.id, controller);
      const startedAt = Date.now();
      const progress = createDownloadProgressReporter(
        (next) => update(input, entry.id, { progress: next }),
        controller.signal,
      );
      try {
        if (!input.client) throw new Error(deps.message("downloads.hostUnavailable"));
        const file = await deps.save({
          ...input,
          client: input.client,
          id: entry.id,
          signal: controller.signal,
          onFileName: (fileName) => update(input, entry.id, { fileName }),
          onProgress: (written, total) => {
            progress.report(downloadProgress(written, total, startedAt));
          },
        });
        if (controller.signal.aborted) return;
        update(input, entry.id, { status: "complete", ...(file ? { file } : {}) });
      } catch (error) {
        if (controller.signal.aborted) return;
        update(input, entry.id, { status: "error", message: failureMessage(error) });
      } finally {
        progress.dispose();
        controllers.delete(entry.id);
      }
    }

    async function performFileAction(source: DownloadSource, action: "open" | "share") {
      const entry = get().downloads.get(downloadSourceKey(source));
      if (!entry?.file || entry.action) return;
      update(source, entry.id, { action, message: undefined });
      try {
        const cached = await deps.inspect({
          ...entry,
          client: null,
          signal: new AbortController().signal,
        });
        if (!cached) {
          update(source, entry.id, { status: "idle", file: undefined });
          return;
        }
        const operation = action === "open" ? deps.open : deps.share;
        await operation(cached.file);
      } catch (error) {
        const key = action === "open" ? "downloads.openFailed" : "downloads.shareFailed";
        update(source, entry.id, { message: `${deps.message(key)} ${failureMessage(error)}` });
      } finally {
        update(source, entry.id, { action: undefined });
      }
    }

    function cancelDownload(source: DownloadSource) {
      const entry = get().downloads.get(downloadSourceKey(source));
      if (!entry || entry.status !== "downloading") return;
      controllers.get(entry.id)?.abort();
      update(source, entry.id, {
        status: "cancelled",
        message: deps.message("downloads.cancelled"),
      });
    }

    function failureMessage(error: unknown): string {
      return error instanceof Error ? error.message : deps.message("downloads.failed");
    }

    return {
      downloads: new Map(),
      retainDownload,
      inspectDownload,
      startDownload,
      cancelDownload,
      openDownload: (source) => performFileAction(source, "open"),
      shareDownload: (source) => performFileAction(source, "share"),
    };
  });
}

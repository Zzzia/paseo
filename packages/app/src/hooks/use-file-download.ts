import { useCallback, useEffect, useMemo } from "react";
import { useDownloadStore } from "@/stores/download-store";
import { useSessionStore } from "@/stores/session-store";
import { downloadSourceKey, type DownloadSource } from "@/downloads/download-cache";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { getFileNameFromPath } from "@/attachments/utils";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";

interface UseFileDownloadParams {
  serverId: string;
  workspaceRoot: string;
  onOpenFile?: (path: string) => void;
}

/**
 * 文件树、预览页和 Git 差异页共用当前连接的分块下载，
 * 不依赖服务端 HTTP 直连地址。
 */
export function useFileDownload({
  serverId,
  workspaceRoot,
  onOpenFile,
}: UseFileDownloadParams): (input: { fileName: string; path: string }) => void {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const startDownload = useDownloadStore((state) => state.startDownload);

  return useCallback(
    ({ fileName, path }) => {
      const target = resolveFilePreviewReadTarget({ path, workspaceRoot: normalizedWorkspaceRoot });
      if (!target) throw new Error(`Cannot download file without a workspace: ${path}`);
      onOpenFile?.(path);
      void startDownload({
        serverId,
        fileName,
        ...target,
        client,
      });
    },
    [client, normalizedWorkspaceRoot, onOpenFile, serverId, startDownload],
  );
}

export function useFileDownloadState(source: DownloadSource) {
  const client = useSessionStore((state) => state.sessions[source.serverId]?.client ?? null);
  const key = downloadSourceKey(source);
  const download = useDownloadStore((state) => state.downloads.get(key));
  const inspect = useDownloadStore((state) => state.inspectDownload);
  const retain = useDownloadStore((state) => state.retainDownload);
  const isTabActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const { serverId, cwd, path } = source;
  useEffect(() => retain({ serverId, cwd, path }), [cwd, path, retain, serverId]);
  useEffect(() => {
    if (!isTabActive || !isAppVisible) return;
    const controller = new AbortController();
    void inspect({
      serverId,
      cwd,
      path,
      client,
      fileName: getFileNameFromPath(path) ?? path,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [client, cwd, inspect, isAppVisible, isTabActive, path, serverId]);
  return download;
}

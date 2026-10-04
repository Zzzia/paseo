import { Text, View } from "react-native";
import { useCallback, useMemo } from "react";
import { StyleSheet } from "react-native-unistyles";
import { Download as DownloadIcon, ExternalLink } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { useFileDownload, useFileDownloadState } from "@/hooks/use-file-download";
import { useDownloadStore } from "@/stores/download-store";
import { getFileNameFromPath } from "@/attachments/utils";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { formatEta, formatSpeed } from "@/downloads/progress";
import type { Download } from "@/downloads/model";
import type { FilePreviewReadTarget } from "@/file-explorer/preview-target";

export function FileDownloadBar({
  serverId,
  target,
}: {
  serverId: string;
  target: FilePreviewReadTarget;
}) {
  const { t } = useTranslation();
  const source = useMemo(
    () => ({ serverId, cwd: target.cwd, path: target.path }),
    [serverId, target.cwd, target.path],
  );
  const entry = useFileDownloadState(source);
  const start = useFileDownload({ serverId, workspaceRoot: target.cwd });
  const open = useDownloadStore((state) => state.openDownload);
  const share = useDownloadStore((state) => state.shareDownload);
  const cancel = useDownloadStore((state) => state.cancelDownload);
  const fileName = getFileNameFromPath(target.path) ?? target.path;
  const hasFile = entry?.status === "complete" && Boolean(entry.file);
  const checking = !entry || entry.status === "checking";
  const downloading = entry?.status === "downloading";
  const pending = checking || downloading || Boolean(entry?.action);
  const opening = entry?.action === "open";
  const primaryIcon = hasFile ? ExternalLink : DownloadIcon;
  const primaryLabel = hasFile ? t("downloads.open") : t("workspace.fileActions.download");
  const primaryTestId = hasFile ? "file-pane-open" : "file-pane-download";
  const primaryLoading = checking || downloading || opening;
  const handlePrimary = useCallback(() => {
    if (hasFile) {
      void open(source);
      return;
    }
    start({ fileName, path: source.path });
  }, [fileName, hasFile, open, source, start]);
  const handleCancel = useCallback(() => cancel(source), [cancel, source]);
  const handleShare = useCallback(() => void share(source), [share, source]);

  return (
    <View testID="file-download-panel" style={styles.container}>
      <PaneContentToolbar testID="file-download-bar">
        <View style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            {fileName}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={primaryIcon}
            testID={primaryTestId}
            loading={primaryLoading}
            disabled={pending}
            onPress={handlePrimary}
          >
            {primaryLabel}
          </Button>
          {downloading ? (
            <Button variant="ghost" size="sm" testID="file-download-cancel" onPress={handleCancel}>
              {t("common.actions.cancel")}
            </Button>
          ) : null}
          {hasFile ? (
            <Button
              variant="ghost"
              size="sm"
              testID="file-download-share"
              disabled={pending}
              loading={entry?.action === "share"}
              onPress={handleShare}
            >
              {t("downloads.share")}
            </Button>
          ) : null}
        </View>
      </PaneContentToolbar>
      {entry ? <FileDownloadStatus download={entry} /> : null}
    </View>
  );
}

function FileDownloadStatus({ download }: { download: Download }) {
  const { t } = useTranslation();
  if (download.status === "idle" || download.status === "checking") return null;
  const progress = download.status === "downloading" ? download.progress : null;
  let status = download.message;
  if (download.status === "downloading") {
    status = t("common.states.starting");
    if (progress)
      status = `${Math.round(progress.percent * 100)}% · ${formatSpeed(progress.speed)} · ${formatEta(progress.eta)}`;
  }
  if (download.status === "complete" && !status) status = t("common.states.downloadComplete");
  const failed =
    download.status === "error" || Boolean(download.message && download.status === "complete");
  const textStyle = failed ? styles.error : styles.status;
  return (
    <View style={styles.details} testID="file-download-status">
      <Text style={textStyle} testID="file-download-message">
        {status}
      </Text>
      {progress ? <FileDownloadProgress percent={progress.percent} /> : null}
    </View>
  );
}

function FileDownloadProgress({ percent }: { percent: number }) {
  const value = Math.round(Math.max(0, Math.min(1, percent)) * 100);
  const width: `${number}%` = `${value}%`;
  const accessibilityValue = useMemo(() => ({ min: 0, max: 100, now: value }), [value]);
  return (
    <View
      style={styles.progressTrack}
      testID="file-download-progress"
      accessibilityRole="progressbar"
      accessibilityValue={accessibilityValue}
    >
      <View style={[styles.progressFill, inlineUnistylesStyle({ width })]} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flexShrink: 0 },
  row: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  name: { flex: 1, minWidth: 0, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  details: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  progressTrack: {
    height: 3,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: theme.colors.primary },
}));

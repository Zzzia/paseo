import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { WorkspaceRenameModal } from "@/components/workspace-rename-modal";
import { useWorkspaceClipboardActions } from "@/hooks/use-workspace-clipboard-actions";
import { useToast } from "@/contexts/toast-context";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useWorkspaceReadState } from "@/hooks/use-workspace-read-state";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { WorkspaceRowBody } from "./sidebar-workspace-row-body";

interface SidebarWorkspaceRowProps {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canCopyBranchName: boolean;
  onPress: () => void;
  /** The host pill after the title. Absent → the sidebar spans one host, or this one is hidden. */
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  onTogglePin?: () => void;
  testID?: string;
  /** Project grouping only: shows a transient "creating" affordance. */
  isCreating?: boolean;
  /** Project grouping only: drag-to-reorder wiring. Absent → not draggable. */
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

export function SidebarWorkspaceRow({
  workspace,
  selected,
  shortcutNumber,
  showShortcutBadge,
  canCopyBranchName,
  onPress,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  onTogglePin,
  testID,
  isCreating = false,
  drag,
  isDragging = false,
  dragHandleProps,
}: SidebarWorkspaceRowProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHidingWorkspace, setIsHidingWorkspace] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const isArchiving = workspace.archivingAt !== null || isHidingWorkspace;

  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection: selected
        ? { serverId: workspace.serverId, workspaceId: workspace.workspaceId }
        : null,
    });
  }, [selected, workspace]);

  const archiveController = useWorkspaceArchive({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    ...toWorktreeArchiveRisk(workspace),
    onArchiveStarted: redirectAfterArchive,
    onSetHiding: setIsHidingWorkspace,
  });

  const handleArchive = useCallback(() => {
    if (isArchiving) {
      return;
    }
    archiveController.archive();
  }, [archiveController, isArchiving]);

  const clipboard = useWorkspaceClipboardActions();
  const handleCopyPath = useCallback(() => {
    clipboard.copyPath(workspace);
  }, [clipboard, workspace]);

  const handleCopyBranchName = useCallback(() => {
    clipboard.copyBranchName(workspace);
  }, [clipboard, workspace]);

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const { hasClearableAttention, canMarkUnread, clearAttention, markUnread } =
    useWorkspaceReadState({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
    });
  const handleMarkAsRead = useCallback(() => {
    void clearAttention().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark workspace as read");
    });
  }, [clearAttention, toast]);
  const handleMarkAsUnread = useCallback(() => {
    void markUnread().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark workspace as unread");
    });
  }, [markUnread, toast]);

  // 同一工作区也在主列表中，快捷访问行沿用其快捷键，避免重复注册覆盖主列表的处理器。
  return (
    <>
      <WorkspaceRowBody
        workspace={workspace}
        selected={selected}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        hostBadge={hostBadge}
        leadingProjectName={leadingProjectName}
        leadingProjectIconDataUri={leadingProjectIconDataUri}
        onTogglePin={onTogglePin}
        testID={testID}
        isCreating={isCreating}
        isArchiving={isArchiving}
        onPress={onPress}
        drag={drag}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
        archiveLabel={t("sidebar.workspace.actions.archive")}
        archiveStatus={isArchiving ? "pending" : "idle"}
        archivePendingLabel={t("sidebar.workspace.actions.archiving")}
        onArchive={handleArchive}
        onCopyBranchName={canCopyBranchName ? handleCopyBranchName : undefined}
        onCopyPath={handleCopyPath}
        onRename={handleOpenRename}
        onMarkAsRead={hasClearableAttention ? handleMarkAsRead : undefined}
        onMarkAsUnread={canMarkUnread ? handleMarkAsUnread : undefined}
        archiveShortcutKeys={selected ? archiveShortcutKeys : null}
      />
      <WorkspaceRenameModal
        visible={isRenameOpen}
        workspace={workspace}
        onClose={handleCloseRename}
        testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
      />
    </>
  );
}

export const MemoSidebarWorkspaceRow = memo(SidebarWorkspaceRow);

import { useCallback, useMemo, useState, type Ref } from "react";
import { View, type GestureResponderEvent } from "react-native";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { isNative as platformIsNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useLongPressDragInteraction } from "@/components/sidebar/use-long-press-drag-interaction";
import { SidebarWorkspaceContextMenu } from "@/components/sidebar/sidebar-workspace-menu";
import {
  SidebarWorkspaceRowFrame,
  SidebarWorkspaceRowContent,
} from "@/components/sidebar/sidebar-workspace-row-content";
import { getSidebarRowBackdrop } from "@/components/sidebar/sidebar-row-backdrop";
import { selectWorkspaceServiceSummary } from "@/components/sidebar/workspace-meta-row";
import { useSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import { styles } from "./sidebar-workspace-row-styles";
import { WorkspaceRowTrailingActions } from "./sidebar-workspace-row-trailing";

function noop() {}

interface WorkspaceRowBodyProps {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  onTogglePin?: () => void;
  testID?: string;
  isCreating: boolean;
  isArchiving: boolean;
  onPress: () => void;
  drag?: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}

export function WorkspaceRowBody({
  workspace,
  selected,
  shortcutNumber,
  showShortcutBadge,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  onTogglePin,
  testID,
  isCreating,
  isArchiving,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  archiveLabel,
  archiveStatus = "idle",
  archivePendingLabel,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  archiveShortcutKeys,
}: WorkspaceRowBodyProps) {
  const isCompact = useIsCompactFormFactor();
  const isTouchPlatform = platformIsNative || isCompact;
  const [isPressed, setIsPressed] = useState(false);
  const trailing = useSidebarWorkspaceTrailing();
  const draggable = Boolean(drag);
  const interaction = useLongPressDragInteraction({
    drag: drag ?? noop,
    menuController: null,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);
  const handleWorkspacePressIn = useCallback(
    (event: GestureResponderEvent) => {
      setIsPressed(true);
      if (draggable) interaction.handlePressIn(event);
    },
    [draggable, interaction],
  );
  const handleWorkspacePressOut = useCallback(() => {
    setIsPressed(false);
    if (draggable) interaction.handlePressOut();
  }, [draggable, interaction]);

  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <SidebarWorkspaceRowFrame workspace={workspace} isDragging={isDragging}>
      {({ isHovered, contextMenuOpen, onContextMenuOpenChange, hoverHandlers }) => {
        const isDesktop = !isTouchPlatform;
        const serviceSummary = isDesktop ? selectWorkspaceServiceSummary(workspace.scripts) : null;
        const workspaceRowStyle = getWorkspaceRowStyle({
          isDragging,
          isPressed,
          selected,
          isHovered,
        });
        const backdrop = getSidebarRowBackdrop({ isDragging, isPressed, selected, isHovered });
        return (
          <View
            {...(draggable ? dragAttributes : {})}
            {...(draggable ? dragHandleProps?.listeners : {})}
            ref={
              draggable ? (dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>) : undefined
            }
            style={styles.workspaceRowContainer}
            {...hoverHandlers}
          >
            <SidebarWorkspaceContextMenu
              contextMenuOpen={contextMenuOpen}
              onContextMenuOpenChange={onContextMenuOpenChange}
              workspace={workspace}
              leadingProjectName={leadingProjectName}
              hostBadgeLabel={hostBadge?.label}
              serviceSummary={serviceSummary}
              workspaceKey={workspace.workspaceKey}
              onCopyPath={onCopyPath}
              onCopyBranchName={onCopyBranchName}
              onRename={onRename}
              onMarkAsRead={onMarkAsRead}
              onMarkAsUnread={onMarkAsUnread}
              onArchive={onArchive}
              archiveLabel={archiveLabel}
              archiveStatus={archiveStatus}
              archivePendingLabel={archivePendingLabel}
              archiveShortcutKeys={archiveShortcutKeys}
              isPinned={workspace.pinnedAt != null}
              onTogglePin={onTogglePin}
              openInFileManagerPath={workspace.workspaceDirectory}
              disabled={isArchiving}
              aria-selected={selected}
              accessibilityRole="button"
              accessibilityState={accessibilityState}
              style={workspaceRowStyle}
              highlightStyle={styles.workspaceRowPressed}
              onPressIn={handleWorkspacePressIn}
              onTouchMove={draggable ? interaction.handleTouchMove : undefined}
              onPressOut={handleWorkspacePressOut}
              onPress={handlePress}
              testID={testID ?? `sidebar-workspace-row-${workspace.workspaceKey}`}
            >
              <SidebarWorkspaceRowContent
                workspace={workspace}
                hostBadge={hostBadge}
                leadingProjectName={leadingProjectName}
                leadingProjectIconDataUri={leadingProjectIconDataUri}
                serviceSummary={serviceSummary}
                backdrop={backdrop}
                isHovered={isHovered}
                isLoading={isArchiving || isCreating}
                isCreating={isCreating}
                shortcutNumber={shortcutNumber}
                showShortcutBadge={showShortcutBadge}
              >
                <WorkspaceRowTrailingActions
                  workspace={workspace}
                  backdrop={backdrop}
                  trailing={trailing}
                  isHovered={isHovered}
                  isTouchPlatform={isTouchPlatform}
                  isCreating={isCreating}
                  showShortcutBadge={showShortcutBadge}
                  shortcutNumber={shortcutNumber}
                  archiveLabel={archiveLabel}
                  archiveStatus={archiveStatus}
                  archivePendingLabel={archivePendingLabel}
                  archiveShortcutKeys={archiveShortcutKeys}
                  onArchive={onArchive}
                  onCopyBranchName={onCopyBranchName}
                  onCopyPath={onCopyPath}
                  onRename={onRename}
                  onMarkAsRead={onMarkAsRead}
                  onMarkAsUnread={onMarkAsUnread}
                  onTogglePin={onTogglePin}
                />
              </SidebarWorkspaceRowContent>
            </SidebarWorkspaceContextMenu>
          </View>
        );
      }}
    </SidebarWorkspaceRowFrame>
  );
}

function getWorkspaceRowStyle({
  isDragging,
  isPressed,
  selected,
  isHovered,
}: {
  isDragging: boolean;
  isPressed: boolean;
  selected: boolean;
  isHovered: boolean;
}) {
  return [
    styles.workspaceRow,
    isHovered && styles.workspaceRowHovered,
    selected && styles.sidebarRowSelected,
    isDragging && styles.workspaceRowDragging,
    isPressed && styles.workspaceRowPressed,
  ];
}

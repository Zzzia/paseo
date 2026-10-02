import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";
import {
  shouldShowSidebarHostLabels,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  useSidebarWorkspacePinController,
  type ToggleSidebarWorkspacePin,
} from "@/hooks/use-sidebar-workspace-pin";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useSidebarRowItems } from "./display-preferences/model";
import { styles } from "./left-sidebar-styles";
import { useSidebarModel } from "./sidebar-model";
import type { SidebarRecentSession } from "./sidebar-recent-sessions";
import { MemoSidebarWorkspaceRow } from "./sidebar-workspace-row";

const RecentWorkspaceRow = memo(function RecentWorkspaceRow({
  session,
  workspace,
  selected,
  hostBadge,
  projectIconDataUri,
  canPin,
  onToggleWorkspacePin,
  onSessionPress,
}: {
  session: SidebarRecentSession;
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  hostBadge: HostBadgeModel | null;
  projectIconDataUri: string | null;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onSessionPress?: () => void;
}) {
  const handlePress = useCallback(() => {
    navigateToAgent({
      serverId: session.serverId,
      workspaceId: workspace.workspaceId,
      agentId: session.agentId,
    });
    onSessionPress?.();
  }, [onSessionPress, session, workspace.workspaceId]);
  const handleTogglePin = useCallback(() => {
    onToggleWorkspacePin(workspace);
  }, [onToggleWorkspacePin, workspace]);
  return (
    <MemoSidebarWorkspaceRow
      workspace={workspace}
      selected={selected}
      hostBadge={hostBadge}
      leadingProjectName={session.workspace.projectName}
      leadingProjectIconDataUri={projectIconDataUri}
      shortcutNumber={null}
      showShortcutBadge={false}
      canCopyBranchName={workspace.projectKind === "git"}
      onTogglePin={canPin ? handleTogglePin : undefined}
      onPress={handlePress}
      testID={`sidebar-recent-workspace-row-${workspace.workspaceKey}`}
    />
  );
});

export function SidebarRecentSessionsSection({ onSessionPress }: { onSessionPress?: () => void }) {
  const { t } = useTranslation();
  const { recentSessions, workspaceEntriesByKey, projects, projectIconTargets } = useSidebarModel();
  const activeWorkspace = useActiveWorkspaceSelection();
  const rowItems = useSidebarRowItems();
  const hostBadges = useHostBadges({
    enabled: rowItems.host && shouldShowSidebarHostLabels(projects),
  });
  const projectIcons = useProjectIcons({ projects: projectIconTargets });
  const serverIds = useMemo(
    () => [...new Set(recentSessions.map((session) => session.serverId))],
    [recentSessions],
  );
  const supportsPinning = useHostFeatureMap(serverIds, "workspacePinning");
  const onToggleWorkspacePin = useSidebarWorkspacePinController();
  const rows = recentSessions.flatMap((session) => {
    const workspace = workspaceEntriesByKey.get(session.workspace.workspaceKey);
    return workspace ? [{ session, workspace }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <View testID="sidebar-recent-section">
      <View style={styles.workspacesSectionHeader}>
        <Text style={styles.workspacesSectionTitle}>{t("agentList.dateSections.recent")}</Text>
      </View>
      {rows.map(({ session, workspace }) => (
        <RecentWorkspaceRow
          key={workspace.workspaceKey}
          session={session}
          workspace={workspace}
          selected={
            activeWorkspace?.serverId === session.serverId &&
            activeWorkspace.workspaceId === workspace.workspaceId
          }
          hostBadge={hostBadges.get(session.serverId) ?? null}
          projectIconDataUri={projectIcons.get(workspace.projectViewKey) ?? null}
          canPin={supportsPinning.get(session.serverId) === true}
          onToggleWorkspacePin={onToggleWorkspacePin}
          onSessionPress={onSessionPress}
        />
      ))}
    </View>
  );
}

import { Text, View } from "react-native";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { styles } from "./left-sidebar-styles";
import { IconTooltipContent } from "./left-sidebar-footer";
import { SidebarRecentSessionsSection } from "./sidebar-recent-sessions-section";

function WorkspacesSectionHeader() {
  return (
    <View style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>Workspaces</Text>
      <View style={styles.workspacesSectionActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <IconTooltipContent label="Display preferences" />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

export function SidebarListHeader({ onSessionPress }: { onSessionPress?: () => void }) {
  return (
    <>
      <SidebarRecentSessionsSection onSessionPress={onSessionPress} />
      <WorkspacesSectionHeader />
    </>
  );
}

export const sidebarListHeaderElement = <SidebarListHeader />;

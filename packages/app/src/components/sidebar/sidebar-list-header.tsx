import { View } from "react-native";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarSectionHeader } from "./sidebar-section-header";
import { IconTooltipContent } from "./left-sidebar-footer";
import { SidebarRecentSessionsSection } from "./sidebar-recent-sessions-section";

function WorkspacesSectionHeader() {
  return (
    <SidebarSectionHeader title="Workspaces">
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
    </SidebarSectionHeader>
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

import { useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import {
  areRecentSidebarSessionsEqual,
  selectRecentSidebarSessions,
  type SidebarRecentSession,
} from "@/components/sidebar/sidebar-recent-sessions";

export function useRecentSidebarSessions(
  projects: readonly SidebarProjectEntry[],
  pinnedWorkspaceKeys: readonly string[],
  enabled: boolean,
): readonly SidebarRecentSession[] {
  const previous = useRef<readonly SidebarRecentSession[]>([]);
  const selector = useMemo(() => {
    const serverIds = [
      ...new Set(
        projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
      ),
    ];
    let previousMaps: unknown[] | null = null;
    let recent = previous.current;
    return (state: ReturnType<typeof useSessionStore.getState>) => {
      if (!enabled) return previous.current;
      const maps = serverIds.map((serverId) => state.sessions[serverId]?.agents);
      // 时间线流式更新不会改变 Agent 目录，无需在每个输出片段上重新扫描会话。
      if (previousMaps && maps.every((agents, index) => agents === previousMaps?.[index])) {
        return recent;
      }
      previousMaps = maps;
      recent = selectRecentSidebarSessions({
        projects,
        pinnedWorkspaceKeys,
        sessions: state.sessions,
      });
      return recent;
    };
  }, [enabled, projects, pinnedWorkspaceKeys]);
  const recent = useStoreWithEqualityFn(useSessionStore, selector, areRecentSidebarSessionsEqual);
  previous.current = recent;
  return recent;
}

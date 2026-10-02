import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/workspace-root-policy";

export type RecentSidebarAgent = Pick<
  Agent,
  "id" | "workspaceId" | "parentAgentId" | "archivedAt" | "provider" | "lastUserMessageAt"
>;

export interface SidebarRecentSession {
  key: string;
  serverId: string;
  agentId: string;
  workspace: SidebarWorkspacePlacement;
  provider: Agent["provider"];
  lastSentAt: number;
}

export interface RecentSidebarInput {
  projects: readonly SidebarProjectEntry[];
  pinnedWorkspaceKeys: readonly string[];
  sessions: Readonly<
    Record<string, { agents: ReadonlyMap<string, RecentSidebarAgent> } | undefined>
  >;
}

function visibleWorkspacesByHost(input: RecentSidebarInput) {
  const pinnedKeys = new Set(input.pinnedWorkspaceKeys);
  const byHost = new Map<string, Map<string, SidebarWorkspacePlacement>>();
  for (const project of input.projects) {
    for (const workspace of project.workspaces) {
      if (pinnedKeys.has(workspace.workspaceKey)) continue;
      let workspaces = byHost.get(workspace.serverId);
      if (!workspaces) {
        workspaces = new Map();
        byHost.set(workspace.serverId, workspaces);
      }
      workspaces.set(workspace.workspaceId, workspace);
    }
  }
  return byHost;
}

function recentSessionsForHost(
  serverId: string,
  workspaces: ReadonlyMap<string, SidebarWorkspacePlacement>,
  agents: ReadonlyMap<string, RecentSidebarAgent>,
): SidebarRecentSession[] {
  const recent: SidebarRecentSession[] = [];
  for (const agent of agents.values()) {
    if (agent.archivedAt || !agent.workspaceId || !agent.lastUserMessageAt) continue;
    const workspace = workspaces.get(agent.workspaceId);
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (!workspace || !isWorkspaceRootAgent(agent, parent)) continue;
    recent.push({
      key: `${serverId}:${agent.id}`,
      serverId,
      agentId: agent.id,
      workspace,
      provider: agent.provider,
      lastSentAt: agent.lastUserMessageAt.getTime(),
    });
  }
  return recent;
}

export function selectRecentSidebarSessions(input: RecentSidebarInput): SidebarRecentSession[] {
  const byWorkspace = new Map<string, SidebarRecentSession>();
  for (const [serverId, workspaces] of visibleWorkspacesByHost(input)) {
    const agents = input.sessions[serverId]?.agents;
    if (!agents) continue;
    for (const session of recentSessionsForHost(serverId, workspaces, agents)) {
      const previous = byWorkspace.get(session.workspace.workspaceKey);
      if (!previous || compareRecentSessions(session, previous) < 0) {
        byWorkspace.set(session.workspace.workspaceKey, session);
      }
    }
  }
  // 活动时间包含回复、关注状态和连接恢复，只有用户发送时间能保持这里的顺序。
  return [...byWorkspace.values()].sort(compareRecentSessions).slice(0, 5);
}

function compareRecentSessions(left: SidebarRecentSession, right: SidebarRecentSession): number {
  return right.lastSentAt - left.lastSentAt || left.key.localeCompare(right.key);
}

export function areRecentSidebarSessionsEqual(
  left: readonly SidebarRecentSession[],
  right: readonly SidebarRecentSession[],
): boolean {
  return (
    left.length === right.length &&
    left.every((session, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        session.key === other.key &&
        session.workspace === other.workspace &&
        session.lastSentAt === other.lastSentAt &&
        session.provider === other.provider
      );
    })
  );
}

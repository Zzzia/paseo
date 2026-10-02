import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";
import {
  selectRecentSidebarSessions,
  areRecentSidebarSessionsEqual,
  type RecentSidebarAgent,
} from "./sidebar-recent-sessions";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: "project" | "status";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});

function recentAgent(
  id: string,
  workspaceId: string,
  lastSentAt: number | null,
  overrides: Partial<RecentSidebarAgent> = {},
): RecentSidebarAgent {
  return {
    id,
    workspaceId,
    parentAgentId: null,
    archivedAt: null,
    provider: "codex",
    lastUserMessageAt: lastSentAt === null ? null : new Date(lastSentAt),
    ...overrides,
  };
}

describe("最近会话", () => {
  it("按最后发送时间排序，同一工作区只占一条，最多显示五条", () => {
    const workspaces = Array.from({ length: 7 }, (_, index) => makeWorkspace(`workspace-${index}`));
    const agents = Array.from({ length: 7 }, (_, index) =>
      recentAgent(`chat-${index}`, `workspace-${index}`, index),
    );
    agents.push(recentAgent("latest-tab", "workspace-6", 8));
    const recent = selectRecentSidebarSessions({
      projects: [makeProject(workspaces.map((workspace) => workspace.placement))],
      pinnedWorkspaceKeys: [],
      sessions: { srv: { agents: new Map(agents.map((agent) => [agent.id, agent])) } },
    });

    expect(recent.map((session) => session.agentId)).toEqual([
      "latest-tab",
      "chat-5",
      "chat-4",
      "chat-3",
      "chat-2",
    ]);
    expect(recent.map((session) => session.workspace.workspaceId)).toEqual([
      "workspace-6",
      "workspace-5",
      "workspace-4",
      "workspace-3",
      "workspace-2",
    ]);
  });

  it("排除未发送、归档、置顶和不在当前筛选中的工作区", () => {
    const workspaces = ["visible", "pinned", "archived", "draft"].map((id) => makeWorkspace(id));
    const agents = [
      recentAgent("visible-chat", "visible", 0),
      recentAgent("pinned-chat", "pinned", 9),
      recentAgent("archived-chat", "archived", 8, { archivedAt: new Date(10) }),
      recentAgent("draft-chat", "draft", null),
      recentAgent("filtered-chat", "filtered-out", 7),
      recentAgent("detached", "missing-workspace", 6),
    ];
    const recent = selectRecentSidebarSessions({
      projects: [makeProject(workspaces.map((workspace) => workspace.placement))],
      pinnedWorkspaceKeys: ["srv:pinned"],
      sessions: { srv: { agents: new Map(agents.map((agent) => [agent.id, agent])) } },
    });
    expect(recent.map((session) => session.agentId)).toEqual(["visible-chat"]);
    expect(recent[0]?.lastSentAt).toBe(0);
  });

  it("同一工作区的后台子代理不改变顺序，跨工作区的子代理只影响自身工作区", () => {
    const first = makeWorkspace("first");
    const second = makeWorkspace("second");
    const agents = [
      recentAgent("parent", "first", 1),
      recentAgent("same-workspace-child", "first", 9, { parentAgentId: "parent" }),
      recentAgent("cross-workspace-child", "second", 2, { parentAgentId: "parent" }),
    ];
    const recent = selectRecentSidebarSessions({
      projects: [makeProject([first.placement, second.placement])],
      pinnedWorkspaceKeys: [],
      sessions: { srv: { agents: new Map(agents.map((agent) => [agent.id, agent])) } },
    });
    expect(recent.map((session) => session.agentId)).toEqual(["cross-workspace-child", "parent"]);
  });

  it("不同主机上的同名工作区和聊天保持独立，重新发送会移动到第一条", () => {
    const first = makeWorkspace("shared").placement;
    const second = { ...first, serverId: "other-host", workspaceKey: "other-host:shared" };
    const agent = recentAgent("same-chat-id", "shared", 1);
    const input = {
      projects: [makeProject([first, second])],
      pinnedWorkspaceKeys: [],
      sessions: {
        srv: { agents: new Map([[agent.id, agent]]) },
        "other-host": {
          agents: new Map([[agent.id, { ...agent, lastUserMessageAt: new Date(2) }]]),
        },
      },
    };
    expect(selectRecentSidebarSessions(input).map((session) => session.serverId)).toEqual([
      "other-host",
      "srv",
    ]);
    input.sessions.srv.agents.set(agent.id, { ...agent, lastUserMessageAt: new Date(3) });
    expect(selectRecentSidebarSessions(input).map((session) => session.serverId)).toEqual([
      "srv",
      "other-host",
    ]);
  });

  it("回复和活动时间变化不改变最近入口，新的发送与最新标签页会更新入口", () => {
    const workspace = makeWorkspace("shared").placement;
    const agent = {
      ...recentAgent("chat", "shared", 1),
      updatedAt: new Date(2),
      lastActivityAt: new Date(2),
    };
    const input = {
      projects: [makeProject([workspace])],
      pinnedWorkspaceKeys: [],
      sessions: { srv: { agents: new Map([[agent.id, agent]]) } },
    };
    const before = selectRecentSidebarSessions(input);
    input.sessions.srv.agents.set(agent.id, {
      ...agent,
      updatedAt: new Date(20),
      lastActivityAt: new Date(20),
    });
    const afterReply = selectRecentSidebarSessions(input);
    expect(areRecentSidebarSessionsEqual(before, afterReply)).toBe(true);
    input.sessions.srv.agents.set(agent.id, { ...agent, lastUserMessageAt: new Date(21) });
    expect(areRecentSidebarSessionsEqual(before, selectRecentSidebarSessions(input))).toBe(false);
  });

  it("没有目录或记录时为空，同一发送时间的顺序不受目录插入顺序影响", () => {
    const workspace = makeWorkspace("shared").placement;
    const first = recentAgent("a", "shared", 1);
    const second = recentAgent("b", "shared", 1);
    const input = { projects: [makeProject([workspace])], pinnedWorkspaceKeys: [] };
    expect(selectRecentSidebarSessions({ ...input, sessions: {} })).toEqual([]);
    for (const agents of [
      [first, second],
      [second, first],
    ]) {
      expect(
        selectRecentSidebarSessions({
          ...input,
          sessions: { srv: { agents: new Map(agents.map((agent) => [agent.id, agent])) } },
        }).map((session) => session.agentId),
      ).toEqual(["a"]);
    }
  });
});

import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { gotoWorkspace, clickNewTerminal } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import {
  selectSidebarStatusGrouping,
  openMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
} from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { expectComposerVisible, fillComposerDraft } from "../support/helpers/composer";

interface RecentChatFixture {
  workspaceId: string;
  agentId: string;
  workspaceName: string;
}

async function seedRecentChats(seeded: SeededWorkspace): Promise<RecentChatFixture[]> {
  const chats: RecentChatFixture[] = [];
  for (let index = 0; index < 8; index += 1) {
    const created = await seeded.client.createWorkspace({
      source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
      title: `Recent workspace ${index}`,
    });
    if (!created.workspace) throw new Error(created.error ?? "创建最近会话工作区失败");
    const agent = await seeded.client.createAgent({
      provider: "mock",
      cwd: seeded.repoPath,
      workspaceId: created.workspace.id,
      title: `Recent chat ${index}`,
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    chats.push({
      workspaceId: created.workspace.id,
      agentId: agent.id,
      workspaceName: created.workspace.name,
    });
  }
  return chats;
}

function recentWorkspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-recent-workspace-row-${getServerId()}:${workspaceId}`);
}

async function expectRecentOrder(page: Page, chats: RecentChatFixture[]) {
  const rows = page
    .getByTestId("sidebar-recent-section")
    .locator('[data-testid^="sidebar-recent-workspace-row-"]');
  await expect(rows).toHaveCount(chats.length);
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-testid")),
      ),
    )
    .toEqual(
      chats.map((chat) => `sidebar-recent-workspace-row-${getServerId()}:${chat.workspaceId}`),
    );
}

async function sendRecentMessage(seeded: SeededWorkspace, chat: RecentChatFixture) {
  await seeded.client.sendAgentMessage(chat.agentId, `排序验证 ${chat.agentId}`);
  await seeded.client.waitForFinish(chat.agentId, 15_000);
}

async function expectRecentBelowPinned(page: Page) {
  const pinned = await page.getByTestId("sidebar-pinned-section").boundingBox();
  const recent = await page.getByTestId("sidebar-recent-section").boundingBox();
  if (!pinned || !recent) throw new Error("无法测量置顶与最近区域");
  expect(recent.y).toBeGreaterThanOrEqual(pinned.y + pinned.height);
}

async function expectRecentMatchesPinned(page: Page, recentId: string, pinnedId: string) {
  const recent = recentWorkspaceRow(page, recentId);
  const pinned = workspaceRow(page, pinnedId);
  const recentBounds = await recent.boundingBox();
  const pinnedBounds = await pinned.boundingBox();
  if (!recentBounds || !pinnedBounds) throw new Error("无法测量最近与置顶的工作区行");
  expect(recentBounds.x).toBe(pinnedBounds.x);
  expect(recentBounds.width).toBe(pinnedBounds.width);
  expect(recentBounds.height).toBe(pinnedBounds.height);
  await expect(
    recent.getByTestId(`sidebar-row-project-icon-${getServerId()}:${recentId}`),
  ).toBeVisible();
}

async function verifyRecentTabTarget(
  page: Page,
  seeded: SeededWorkspace,
  chats: RecentChatFixture[],
) {
  const first = chats[0]!;
  const agent = await seeded.client.createAgent({
    provider: "mock",
    cwd: seeded.repoPath,
    workspaceId: first.workspaceId,
    title: "Latest tab in shared workspace",
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
  const latest = { ...first, agentId: agent.id };
  await sendRecentMessage(seeded, latest);
  const order = [latest, chats[5]!, chats[4]!, chats[3]!, chats[2]!];
  await expectRecentOrder(page, order);
  await openAgentRoute(page, first);
  await fillComposerDraft(page, "仅输入，不发送");
  await expectRecentOrder(page, order);
  await recentWorkspaceRow(page, first.workspaceId).click();
  await expect(
    page.getByTestId(`workspace-tab-agent_${agent.id}`).filter({ visible: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expectRecentOrder(page, order);
  await page.reload();
  await expectRecentOrder(page, order);
  await seeded.client.archiveAgent(agent.id);
  await expectRecentOrder(page, [chats[5]!, chats[4]!, chats[3]!, chats[2]!, chats[1]!]);
}

// Model B sidebar shape: every project — git or non-git, single- or
// multi-workspace — renders as the same expandable parent, the deepest sidebar
// level is the workspace row, and tabs/agents/terminals NEVER appear in the
// sidebar. These specs prove all three invariants end to end.

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function projectRow(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectEquivalenceViewKey(projectKey)}`);
}

function projectNewWorktreeIcon(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-new-worktree-${projectEquivalenceViewKey(projectKey)}`);
}

async function seedSecondWorkspace(seeded: SeededWorkspace, title: string): Promise<string> {
  const created = await seeded.client.createWorkspace({
    source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
    title,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? `Failed to create second workspace for ${seeded.projectId}`);
  }
  return created.workspace.id;
}

test.describe("Model B sidebar shape", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const mode of ["project", "status"] as const) {
    test(`${mode} 分组在置顶下方展示最近五个工作区，按发送排序并打开最新聊天标签页`, async ({
      page,
    }) => {
      const seeded = await seedWorkspace({ repoPrefix: `recent-${mode}-` });
      try {
        const chats = await seedRecentChats(seeded);
        await gotoAppShell(page);
        await waitForSidebarHydration(page);
        await expect(page.getByTestId("sidebar-recent-section")).toHaveCount(0);
        for (const chat of chats.slice(0, 7)) await sendRecentMessage(seeded, chat);
        await seeded.client.setWorkspacePinned(chats[6]!.workspaceId, true);
        if (mode === "status") await selectSidebarStatusGrouping(page);
        await expectRecentOrder(page, [chats[5]!, chats[4]!, chats[3]!, chats[2]!, chats[1]!]);
        await expect(recentWorkspaceRow(page, chats[5]!.workspaceId)).toContainText(
          chats[5]!.workspaceName,
        );
        await expect
          .poll(() => recentWorkspaceRow(page, chats[5]!.workspaceId).getAttribute("aria-label"))
          .toContain(`${seeded.projectDisplayName}, ${chats[5]!.workspaceName}`);
        await expectRecentBelowPinned(page);
        await expectRecentMatchesPinned(page, chats[5]!.workspaceId, chats[6]!.workspaceId);
        await page.screenshot({
          path: `../../.note/goal-recent-sessions/recent-${mode}-desktop.png`,
        });
        await verifyRecentTabTarget(page, seeded, chats);
        const toPin = chats[5]!;
        await recentWorkspaceRow(page, toPin.workspaceId).hover();
        await recentWorkspaceRow(page, toPin.workspaceId)
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${toPin.workspaceId}`)
          .click();
        await page
          .getByTestId(`sidebar-workspace-menu-pin-${getServerId()}:${toPin.workspaceId}`)
          .click();
        await expectRecentOrder(page, [chats[4]!, chats[3]!, chats[2]!, chats[1]!, chats[0]!]);
      } finally {
        await seeded.cleanup();
      }
    });
  }

  test("手机布局点击最近工作区后打开对应聊天并收起侧栏", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await seedWorkspace({ repoPrefix: "recent-mobile-" });
    try {
      const previous = await seeded.client.createAgent({
        provider: "mock",
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: "之前的聊天",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      const latest = await seeded.client.createAgent({
        provider: "mock",
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: "最近发送的聊天",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      await openAgentRoute(page, { workspaceId: seeded.workspaceId, agentId: latest.id });
      const prompt = "用于手机最近会话验证";
      await fillComposerDraft(page, prompt);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
      await seeded.client.waitForFinish(latest.id, 15_000);
      await openAgentRoute(page, { workspaceId: seeded.workspaceId, agentId: previous.id });
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toContainText("之前的聊天");
      await openMobileAgentSidebar(page);
      await expect(recentWorkspaceRow(page, seeded.workspaceId)).toContainText(
        seeded.workspaceName,
      );
      await expect
        .poll(() => recentWorkspaceRow(page, seeded.workspaceId).getAttribute("aria-label"))
        .toContain(`${seeded.projectDisplayName}, ${seeded.workspaceName}`);
      await expectRecentOrder(page, [
        {
          workspaceId: seeded.workspaceId,
          agentId: latest.id,
          workspaceName: seeded.workspaceName,
        },
      ]);
      await page.screenshot({ path: "../../.note/goal-recent-sessions/recent-mobile.png" });
      await recentWorkspaceRow(page, seeded.workspaceId).click();
      await expectMobileAgentSidebarHidden(page);
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toContainText(
        "最近发送的聊天",
      );
      await expectComposerVisible(page);
    } finally {
      await seeded.cleanup();
    }
  });

  test("git and non-git projects both render as expandable parents, both show a per-row New workspace icon, and the global button covers both", async ({
    page,
  }) => {
    const gitProject = await seedWorkspace({ repoPrefix: "model-b-git-" });
    const nonGitProject = await seedWorkspace({ repoPrefix: "model-b-nongit-", git: false });

    try {
      const gitSecondId = await seedSecondWorkspace(gitProject, "Git second");
      const nonGitSecondId = await seedSecondWorkspace(nonGitProject, "Non-git second");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // Both projects are expandable parents — the non-git one is NOT flattened
      // into a bare workspace link.
      await expect(projectRow(page, gitProject.projectKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, nonGitProject.projectKey)).toBeVisible({ timeout: 30_000 });

      // Each parent shows both of its workspace rows underneath.
      await expect(workspaceRow(page, gitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, gitSecondId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitSecondId)).toBeVisible({ timeout: 30_000 });

      // Both projects show a per-row New workspace icon (revealed on hover): the
      // git project can branch off a worktree, and the non-git project can add
      // another workspace because the host supports workspaceMultiplicity.
      await projectRow(page, gitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, gitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await projectRow(page, nonGitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, nonGitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });

      // The global new-workspace button is the universal entry — present for both
      // kinds regardless of their per-row affordance.
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await gitProject.cleanup();
      await nonGitProject.cleanup();
    }
  });

  test("no tab, agent, or terminal ever renders as a sidebar row", async ({ page }) => {
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-leaf-",
      title: "Leaf workspace",
    });

    try {
      // Open the workspace and materialize both an agent tab and a terminal tab.
      await gotoWorkspace(page, mock.workspaceId);
      await expect(
        page.getByTestId(`workspace-tab-agent_${mock.agentId}`).filter({ visible: true }),
      ).toBeVisible();

      await clickNewTerminal(page);
      await expect(
        page.locator('[data-testid^="workspace-tab-terminal_"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // The deepest level inside the sidebar is the workspace row: no tab,
      // agent, or terminal element appears as a sidebar descendant.
      const sidebar = page.getByTestId("sidebar-sessions").filter({ visible: true }).first();
      await expect(workspaceRow(page, mock.workspaceId).first()).toBeVisible({ timeout: 30_000 });
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-agent-row-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-terminal-row-"]')).toHaveCount(0);
    } finally {
      await mock.cleanup();
    }
  });

  test("status grouping shows only workspace rows and moves a single row when its status changes", async ({
    page,
  }) => {
    const idleProject = await seedWorkspace({ repoPrefix: "model-b-status-idle-" });
    const activeMock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-status-active-",
      title: "Working workspace",
      initialPrompt: "stay busy",
      model: "one-minute-stream",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(workspaceRow(page, idleProject.workspaceId)).toBeVisible({ timeout: 30_000 });

      // Switch to status grouping.
      await selectSidebarStatusGrouping(page);

      const sidebar = page.getByTestId("sidebar-sessions").filter({ visible: true }).first();

      // The idle workspace lands in the Done bucket; the busy mock-agent workspace
      // lands in the Working bucket. Each workspace is bucketed independently.
      await expect(page.getByTestId("sidebar-status-group-done")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("sidebar-status-group-running")).toBeVisible({
        timeout: 60_000,
      });
      await expect(workspaceRow(page, idleProject.workspaceId).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(workspaceRow(page, activeMock.workspaceId).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(workspaceRow(page, idleProject.workspaceId).first()).toHaveAccessibleName(
        `${idleProject.projectDisplayName}, ${idleProject.workspaceName}`,
      );
      await expect(workspaceRow(page, activeMock.workspaceId).first()).toHaveAccessibleName(
        /Working$/,
      );

      // Only workspace rows are shown — no tab/agent/terminal leaves leak into
      // the status view.
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);

      // Status mode drops the project grouping, so each row leads its subtitle
      // with the project's icon to keep projects distinguishable.
      for (const workspaceId of [idleProject.workspaceId, activeMock.workspaceId]) {
        await expect(
          page.getByTestId(`sidebar-row-project-icon-${getServerId()}:${workspaceId}`).first(),
        ).toBeVisible({ timeout: 60_000 });
      }

      // The busy workspace is grouped under Working, the idle one under Done:
      // changing one workspace's status moved only that row.
      const workingRows = page.getByTestId("sidebar-status-group-rows-running");
      const doneRows = page.getByTestId("sidebar-status-group-rows-done");
      await expect(
        workingRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${activeMock.workspaceId}`),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        doneRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${idleProject.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });
      // The busy workspace is NOT also sitting in the Done bucket — only its own
      // row moved.
      await expect(
        doneRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${activeMock.workspaceId}`),
      ).toHaveCount(0);
    } finally {
      await idleProject.cleanup();
      await activeMock.cleanup();
    }
  });
});

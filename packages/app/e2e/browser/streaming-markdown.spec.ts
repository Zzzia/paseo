import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expect, test } from "../support/fixtures";
import {
  withAcpStreamingMarkdown,
  requestAcpMarkdown,
  expectAcpMarkdown,
  reloadAcpMarkdown,
} from "../support/helpers/acp-streaming-markdown";
import {
  expectFinishedMarkdown,
  expectReloadedMarkdown,
  expectUnfinishedBold,
  expectUnfinishedLink,
  requestStreamingMarkdown,
  withStreamingMarkdown,
} from "../support/helpers/streaming-markdown";

test("formats unfinished Markdown while streaming and preserves the completed rendering", async ({
  page,
}, testInfo) => {
  await withStreamingMarkdown(page, testInfo, async (agent) => {
    await requestStreamingMarkdown(agent);
    await expectUnfinishedBold(page);
    await expectUnfinishedLink(page, agent, testInfo);
    await expectFinishedMarkdown(page, agent, testInfo);
    await expectReloadedMarkdown(page);
  });
});

for (const width of [1100, 390]) {
  test(`ACP plugin chunks preserve Markdown and separate turns at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await withAcpStreamingMarkdown(page, async (agent) => {
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 1);
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 2);
      await reloadAcpMarkdown(page, testInfo);
    });
  });
}

test("preserves LaTeX in the new Markdown renderer and after reload", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "markdown-math-",
    title: "Markdown Math",
    featureValues: {
      mockStreamingAssistantResponse:
        String.raw`内联 \(x^2\) 和分式 $\frac{a}{b}$。

\[
x + y = z
\]

` + "```math\nE = mc^2\n```",
      mockStreamingAssistantIntervalMs: 10,
    },
  });
  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "展示公式");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    const message = page.getByTestId("assistant-message").last();
    await expect(message.locator("math")).toHaveCount(4);
    await expect(message.locator("mfrac")).toHaveCount(1);
    await expect(message.locator('math[display="block"]')).toHaveCount(2);
    await expect(message).toContainText("内联");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(message.locator("math")).toHaveCount(4);
    await testInfo.attach("markdown-math", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await agent.cleanup();
  }
});

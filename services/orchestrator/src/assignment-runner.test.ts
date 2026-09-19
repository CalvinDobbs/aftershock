import { describe, expect, it, vi } from "vitest";

import type { Assignment } from "@aftershock/schema/browser";
import type { BrowserSession } from "@aftershock/browser";

import { runObservableAssignment } from "./assignment-runner.js";
import { InMemoryEventRepository, RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

const usage = {
  inputTokens: 10,
  outputTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 12,
};

const action = {
  selector: "xpath=//a",
  description: "Comments link",
  method: "click",
  arguments: [],
};

const assignment: Assignment = {
  id: "assignment-1",
  runId: "run-1",
  archetype: "conformance",
  route: "/",
  objective: "Open the top story discussion",
  journey: [{ instruction: "Click the comments link for the top story" }],
};

function fakeSession() {
  return {
    sessionId: "session-1",
    page: {
      goto: vi.fn().mockResolvedValue(null),
      snapshot: vi.fn().mockResolvedValue({ formattedTree: "a comments", urlMap: {}, xpathMap: {} }),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7])),
      url: vi.fn().mockResolvedValue("https://news.ycombinator.com/item?id=1"),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    },
    stagehand: {
      observe: vi.fn().mockResolvedValue({
        data: [action],
        metadata: { actionId: "observe-1", cache: { status: "MISS" }, usage },
      }),
      act: vi.fn().mockResolvedValue({
        data: { success: true },
        metadata: { actionId: "act-1", cache: { status: "DISABLED" }, usage },
      }),
    },
    browserbase: { sessions: { logs: { list: vi.fn().mockResolvedValue([]) } } },
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserSession;
}

describe("runObservableAssignment", () => {
  it("publishes the lifecycle and stores step screenshots", async () => {
    const repository = new InMemoryEventRepository();
    const eventStream = new RunEventStream(repository);
    const put = vi.fn().mockResolvedValue("screenshot-1");
    const screenshotRepository: ScreenshotRepository = {
      put,
      get: async () => undefined,
    };

    const result = await runObservableAssignment({
      assignment,
      targetUrl: "https://news.ycombinator.com",
      mode: "plan",
      side: "preview",
      config: { browserbaseApiKey: "test-key", modelName: "openai/gpt-5.4-mini" },
      sessionFactory: async () => fakeSession(),
      eventStream,
      screenshotRepository,
    });

    expect(result.sessionId).toBe("session-1");
    const traces = await eventStream.history("run-1");
    expect(traces.map((trace) => trace.event.type)).toEqual([
      "session.opened",
      "step.planned",
      "step.executed",
      "step.captured",
      "session.closed",
    ]);
    expect(put).toHaveBeenCalledWith({
      runId: "run-1",
      assignmentId: "assignment-1",
      index: 0,
      body: Uint8Array.from([9, 8, 7]),
    });
    const captured = traces.find((trace) => trace.event.type === "step.captured");
    expect(captured?.event).toMatchObject({ screenshotId: "screenshot-1" });
  });
});

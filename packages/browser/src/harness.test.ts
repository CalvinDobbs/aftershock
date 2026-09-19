import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent, Assignment } from "@aftershock/schema/browser";

import type { BrowserConfig } from "./config.js";
import type { BrowserSession } from "./session.js";

vi.mock("./evidence.js", () => ({
  collectSessionEvidence: vi.fn().mockResolvedValue({
    network: { requestCount: 2, failedRequests: [] },
    console: [],
  }),
}));

const usage = {
  inputTokens: 10,
  outputTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 12,
};

const action = {
  selector: "xpath=//button",
  description: "Apply button",
  method: "click",
  arguments: [],
};

const config: BrowserConfig = {
  browserbaseApiKey: "test-key",
  modelName: "openai/gpt-5.4-mini",
  modelApiKey: "model-key",
};

const baseAssignment: Assignment = {
  id: "assignment-1",
  runId: "run-1",
  archetype: "conformance",
  assertionId: "A1",
  route: "/checkout",
  objective: "Apply a coupon",
  journey: [{ instruction: "Click the Apply button" }],
};

function fakeSession() {
  const close = vi.fn().mockResolvedValue(undefined);
  const observe = vi.fn().mockResolvedValue({
    data: [action],
    metadata: {
      actionId: "observe-1",
      cache: { status: "MISS" },
      usage,
    },
  });
  const act = vi.fn().mockResolvedValue({
    data: { success: true, message: "clicked", actionDescription: "Apply button", actions: [action] },
    metadata: {
      actionId: "act-1",
      cache: { status: "DISABLED" },
      usage,
    },
  });
  const goto = vi.fn().mockResolvedValue(null);

  return {
    close,
    observe,
    act,
    goto,
    value: {
      sessionId: "session-1",
      liveViewUrl: "https://www.browserbase.com/sessions/session-1",
      page: {
        goto,
        snapshot: vi.fn().mockResolvedValue({ formattedTree: "button Apply", urlMap: {}, xpathMap: {} }),
        screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        url: vi.fn().mockResolvedValue("https://preview.example/checkout"),
      },
      stagehand: { observe, act },
      browserbase: {},
      close,
    } as unknown as BrowserSession,
  };
}

function clock() {
  let value = Date.parse("2026-09-19T12:00:00.000Z");
  return () => value += 10;
}

describe("runAssignment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("plans, executes, captures, and emits the observable lifecycle", async () => {
    const session = fakeSession();
    const events: AgentEvent[] = [];
    const writeScreenshot = vi.fn().mockResolvedValue("screenshot-1");
    const { runAssignment } = await import("./harness.js");

    const result = await runAssignment({
      assignment: baseAssignment,
      targetUrl: "https://preview.example",
      mode: "plan",
      side: "preview",
      config,
      sessionFactory: async () => session.value,
      emit: (event) => events.push(event),
      writeScreenshot,
      now: clock(),
    });

    expect(session.goto).toHaveBeenCalledWith("https://preview.example/checkout", {
      waitUntil: "domcontentloaded",
    });
    expect(session.observe).toHaveBeenCalledWith("Click the Apply button");
    expect(session.act).toHaveBeenCalledWith(action);
    expect(events.map((event) => event.type)).toEqual([
      "session.opened",
      "step.planned",
      "step.executed",
      "step.captured",
      "session.closed",
    ]);
    expect(writeScreenshot).toHaveBeenCalledWith({
      runId: "run-1",
      assignmentId: "assignment-1",
      index: 0,
      body: Uint8Array.from([1, 2, 3]),
    });
    const captured = events.find((event) => event.type === "step.captured");
    expect(captured).toMatchObject({ screenshotId: "screenshot-1" });
    expect(result.steps[0]?.action).toEqual(action);
    expect(result.steps[0]?.snapshot.screenshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("replays persisted actions without observing the page again", async () => {
    const session = fakeSession();
    const { runAssignment } = await import("./harness.js");

    await runAssignment({
      assignment: { ...baseAssignment, journey: [{ ...baseAssignment.journey[0]!, action }] },
      targetUrl: "https://base.example",
      mode: "replay",
      side: "base",
      config,
      sessionFactory: async () => session.value,
      emit: () => undefined,
      now: clock(),
    });

    expect(session.observe).not.toHaveBeenCalled();
    expect(session.act).toHaveBeenCalledWith(action);
  });

  it("emits failure and closes the session when an action fails", async () => {
    const session = fakeSession();
    const events: AgentEvent[] = [];
    session.act.mockRejectedValueOnce(new Error("action failed"));
    const { runAssignment } = await import("./harness.js");

    await expect(runAssignment({
      assignment: baseAssignment,
      targetUrl: "https://preview.example",
      mode: "plan",
      side: "preview",
      config,
      sessionFactory: async () => session.value,
      emit: (event) => events.push(event),
      now: clock(),
    })).rejects.toThrow("action failed");

    expect(events.map((event) => event.type)).toContain("session.failed");
    expect(events.at(-1)?.type).toBe("session.closed");
    expect(session.close).toHaveBeenCalledOnce();
  });
});

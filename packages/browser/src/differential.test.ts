import { describe, expect, it, vi } from "vitest";

import type { AgentEvent, Assignment } from "@aftershock/schema/browser";

import type { BrowserConfig } from "./config.js";
import type { BrowserSession } from "./session.js";
import { isReplayable, runDifferential, withRecordedActions } from "./differential.js";

vi.mock("./evidence.js", () => ({
  collectSessionEvidence: vi.fn().mockResolvedValue({
    network: { requestCount: 1, failedRequests: [] },
    console: [],
  }),
}));

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 1,
};
const action = { selector: "xpath=//a", description: "Open the cart", method: "click", arguments: [] };
const config: BrowserConfig = { browserbaseApiKey: "k", modelName: "openai/gpt-5.4-mini" };

const assignment: Assignment = {
  id: "D1",
  runId: "run-1",
  archetype: "differential",
  route: "/cart",
  objective: "Add two items and open the cart",
  journey: [{ instruction: "Open the cart" }],
};

/** A session whose page renders `tree` and reports `host` as its origin. */
function session(host: string, tree: string, observe = vi.fn()) {
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    sessionId: `sess-${host}`,
    page: {
      goto: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ formattedTree: tree }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
      url: vi.fn().mockReturnValue(`https://${host}/cart`),
    },
    stagehand: {
      observe: observe.mockResolvedValue({
        data: [action],
        metadata: { actionId: "o1", cache: { status: "MISS" }, usage },
      }),
      act: vi.fn().mockResolvedValue({
        data: { success: true, message: "ok", actionDescription: "d", actions: [action] },
        metadata: { actionId: "a1", cache: { status: "MISS" }, usage },
      }),
    },
    browserbase: {},
    close,
  } as unknown as BrowserSession & { stagehand: { observe: ReturnType<typeof vi.fn> } };
}

describe("isReplayable / withRecordedActions", () => {
  it("knows a freshly planned journey is not yet replayable", () => {
    expect(isReplayable(assignment)).toBe(false);
  });

  it("copies discovered Actions onto the journey", () => {
    const recorded = withRecordedActions(assignment, {
      assignmentId: "D1",
      sessionId: "s",
      steps: [
        {
          index: 0,
          instruction: "Open the cart",
          action,
          snapshot: {
            url: "https://a.dev/cart",
            formattedTree: "",
            screenshot: new Uint8Array([1]),
            network: { requestCount: 0, failedRequests: [] },
            console: [],
          },
          durationMs: 1,
        },
      ],
      findings: [],
      startedAt: "2026-09-19T14:00:00.000Z",
      finishedAt: "2026-09-19T14:00:01.000Z",
    });
    expect(recorded).not.toBeNull();
    expect(isReplayable(recorded!)).toBe(true);
    expect(recorded!.journey[0]!.action).toEqual(action);
  });
});

describe("runDifferential", () => {
  it("plans once and replays the same Action on the other side", async () => {
    const previewObserve = vi.fn();
    const baseObserve = vi.fn();
    const preview = session("preview.dev", 'text "Subtotal $NaN"', previewObserve);
    const base = session("base.dev", 'text "Subtotal $132.00"', baseObserve);

    const events: AgentEvent[] = [];
    const sessions = [preview, base];

    const result = await runDifferential({
      assignment,
      previewUrl: "https://preview.dev",
      baseUrl: "https://base.dev",
      emit: (e) => void events.push(e),
      config,
      sessionFactory: async () => sessions.shift()!,
    });

    // The confound this exists to remove: the base side must never infer.
    expect(previewObserve).toHaveBeenCalledTimes(1);
    expect(baseObserve).not.toHaveBeenCalled();

    expect(result.previewSessionId).toBe("sess-preview.dev");
    expect(result.baseSessionId).toBe("sess-base.dev");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.class).toBe("unclaimed_delta");
    expect(result.findings[0]!.summary).toContain("$132.00");
    expect(result.findings[0]!.summary).toContain("$NaN");
  });

  it("emits a comparison per step and a finding for each regression", async () => {
    const sessions = [
      session("preview.dev", 'text "Subtotal $NaN"'),
      session("base.dev", 'text "Subtotal $132.00"'),
    ];
    const events: AgentEvent[] = [];

    await runDifferential({
      assignment,
      previewUrl: "https://preview.dev",
      baseUrl: "https://base.dev",
      emit: (e) => void events.push(e),
      config,
      sessionFactory: async () => sessions.shift()!,
    });

    expect(events.filter((e) => e.type === "step.compared")).toHaveLength(1);
    expect(events.filter((e) => e.type === "finding.raised")).toHaveLength(1);
    // Both sides must announce themselves so the room can pair the panes.
    expect(
      events.filter((e) => e.type === "session.opened").map((e) => (e as { side: string }).side),
    ).toEqual(["preview", "base"]);
  });

  it("reports a journey that completes on base and breaks here", async () => {
    // The worst regression is a journey that no longer completes. Step counts
    // cannot express it — the base side only replays what the preview planned,
    // so both stop at the same index and look like they agree.
    const twoStep: Assignment = {
      ...assignment,
      journey: [{ instruction: "Open the cart" }, { instruction: "Go to checkout" }],
    };

    const preview = session("preview.dev", 'text "Cart"');
    const ok = {
      data: { success: true, message: "ok", actionDescription: "d", actions: [action] },
      metadata: { actionId: "a1", cache: { status: "MISS" }, usage },
    };
    (preview.stagehand.act as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(new Error("element is not attached to the DOM"));

    const sessions = [preview, session("base.dev", 'text "Cart"')];

    const result = await runDifferential({
      assignment: twoStep,
      previewUrl: "https://preview.dev",
      baseUrl: "https://base.dev",
      emit: () => undefined,
      config,
      sessionFactory: async () => sessions.shift()!,
    });

    const finding = result.findings.find((f) => f.signature.includes("journey completion"));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.class).toBe("hard_failure");
    expect(finding!.summary).toContain("not attached to the DOM");
  });

  it("stays silent when nothing could be planned at all", async () => {
    // No Actions means no replay and no comparison. That is an errored
    // assignment, not a finding — claiming otherwise would be inventing one.
    const preview = session("preview.dev", 'text "Cart"');
    (preview.stagehand.act as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("nothing to click"),
    );
    const sessions = [preview, session("base.dev", 'text "Cart"')];

    const result = await runDifferential({
      assignment,
      previewUrl: "https://preview.dev",
      baseUrl: "https://base.dev",
      emit: () => undefined,
      config,
      sessionFactory: async () => sessions.shift()!,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.baseSessionId).toBe("");
  });

  it("raises nothing when the two deployments agree", async () => {
    const sessions = [
      session("preview.dev", 'text "Subtotal $132.00"'),
      session("base.dev", 'text "Subtotal $132.00"'),
    ];
    const result = await runDifferential({
      assignment,
      previewUrl: "https://preview.dev",
      baseUrl: "https://base.dev",
      emit: () => undefined,
      config,
      sessionFactory: async () => sessions.shift()!,
    });
    expect(result.findings).toHaveLength(0);
    expect(result.deltas).toHaveLength(0);
  });

  it("runs both sides at once when the Actions are already recorded", async () => {
    const recorded: Assignment = {
      ...assignment,
      journey: [{ instruction: "Open the cart", action }],
    };
    const previewObserve = vi.fn();
    const baseObserve = vi.fn();
    const sessions = [
      session("preview.dev", 'text "Subtotal $132.00"', previewObserve),
      session("base.dev", 'text "Subtotal $132.00"', baseObserve),
    ];

    await runDifferential({
      assignment: recorded,
      previewUrl: "https://preview.dev",
      baseUrl: "https://base.dev",
      emit: () => undefined,
      config,
      sessionFactory: async () => sessions.shift()!,
    });

    expect(previewObserve).not.toHaveBeenCalled();
    expect(baseObserve).not.toHaveBeenCalled();
  });
});

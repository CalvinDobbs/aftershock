import { describe, expect, it } from "vitest";

import { AgentEventSchema, AssignmentSchema, RunSummarySchema } from "./browser.js";

describe("AssignmentSchema", () => {
  it("accepts an atomic browser journey", () => {
    const assignment = AssignmentSchema.parse({
      id: "assignment-1",
      runId: "run-1",
      archetype: "conformance",
      assertionId: "A1",
      route: "/checkout",
      objective: "Applying SAVE20 reduces the total",
      journey: [{ instruction: "Click the Apply button" }],
    });

    expect(assignment.journey).toHaveLength(1);
  });

  it("rejects routes that are not absolute paths", () => {
    expect(() =>
      AssignmentSchema.parse({
        id: "assignment-1",
        runId: "run-1",
        archetype: "conformance",
        route: "checkout",
        objective: "Open checkout",
        journey: [{ instruction: "Open checkout" }],
      }),
    ).toThrow();
  });
});

describe("AgentEventSchema", () => {
  it("parses events used by the live frontend stream", () => {
    const event = AgentEventSchema.parse({
      type: "session.opened",
      runId: "run-1",
      assignmentId: "assignment-1",
      timestamp: "2026-09-19T12:00:00.000Z",
      side: "preview",
      sessionId: "session-1",
      liveViewUrl: "https://www.browserbase.com/sessions/session-1",
    });

    expect(event.type).toBe("session.opened");
  });

  it("parses step.captured with a screenshotId", () => {
    const event = AgentEventSchema.parse({
      type: "step.captured",
      runId: "run-1",
      assignmentId: "assignment-1",
      timestamp: "2026-09-19T12:00:00.000Z",
      index: 0,
      url: "https://example.com/checkout",
      screenshotId: "screenshot-1",
      network: { requestCount: 1, failedRequests: [] },
      consoleErrors: [],
    });

    expect(event.type).toBe("step.captured");
    if (event.type === "step.captured") expect(event.screenshotId).toBe("screenshot-1");
  });
});

describe("RunSummarySchema", () => {
  it("parses dashboard run summaries", () => {
    const summary = RunSummarySchema.parse({
      runId: "run-1",
      status: "completed",
      startedAt: "2026-09-19T12:00:00.000Z",
      updatedAt: "2026-09-19T12:01:00.000Z",
      assignmentCount: 1,
      eventCount: 5,
    });

    expect(summary.status).toBe("completed");
  });
});

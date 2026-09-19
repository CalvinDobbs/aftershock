import { describe, expect, it } from "vitest";
import { RunDetail } from "@aftershock/schema";
import { AgentTraceEventSchema, AssignmentResultSchema, DifferentialResultSchema, type Assignment } from "@aftershock/schema/browser";
import { completedAssignment, initialRun } from "./pipeline-projection.js";

const assignment: Assignment = { id: "D1", runId: "run", archetype: "differential", route: "/cart", objective: "Check cart", journey: [{ instruction: "Open /cart" }] };
const time = "2026-09-19T10:00:00Z";
const pair = DifferentialResultSchema.parse({ assignmentId: "D1", previewSessionId: "preview", baseSessionId: "base", completed: true,
  findings: [], deltas: [], noiseFiltered: 0, startedAt: time, finishedAt: time });
const capture = (side: "preview" | "base", screenshotId: string, sequence: number) => AgentTraceEventSchema.parse({ sequence,
  event: { type: "step.captured", runId: "run", assignmentId: "D1", timestamp: time, side, index: 0,
    screenshotId, url: "https://shop.example/cart", network: { requestCount: 0, requests: [], failedRequests: [], captured: true }, consoleErrors: [] } });

describe("pipeline projection", () => {
  it("keeps simultaneous base and preview screenshots on the correct side", () => {
    const product = completedAssignment(assignment, [capture("base", "base-shot", 0), capture("preview", "preview-shot", 1)], pair,
      undefined, (id) => `https://api.example/screenshots/${id}`);
    expect(product.steps[0]).toMatchObject({ screenshotUrl: "https://api.example/screenshots/preview-shot", baseScreenshotUrl: "https://api.example/screenshots/base-shot" });
    expect(product.status).toBe("passed");
  });

  it("marks incomplete comparisons errored, not passed", () => {
    expect(completedAssignment(assignment, [], { ...pair, completed: false }).status).toBe("errored");
  });

  it("does not label unevaluated conformance as a passing assertion", () => {
    const result = AssignmentResultSchema.parse({ assignmentId: "D1", sessionId: "preview", findings: [], steps: [], startedAt: time, finishedAt: time });
    const product = completedAssignment({ ...assignment, archetype: "conformance" }, [], result);
    expect(product.status).toBe("skipped");
    expect(product.trace[0]?.content).toContain("assertion evaluation is not implemented");
  });

  it("retains failure explanations when a browser throws", () => {
    const product = completedAssignment(assignment, [], undefined, "Browser disconnected");
    expect(product.status).toBe("errored");
    expect(product.trace[0]?.content).toBe("Browser disconnected");
  });

  it("constructs a schema-valid run without inventing author metadata", () => {
    const run = initialRun({ runId: "run", repo: "demo/shop", head: "head", base: "main", previewUrl: "https://preview.example", baseUrl: null }, time);
    expect(run.commit.author).toBe("unknown");
    expect(run.baseBranch).toBeNull();
    expect(RunDetail.safeParse({ run, charter: null, assignments: [], findings: [], issues: [], diagnosis: null, patch: null, verification: null, pullRequest: null }).success).toBe(true);
  });
});

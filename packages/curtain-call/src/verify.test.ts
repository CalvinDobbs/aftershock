import { describe, expect, it, vi } from "vitest";
import type { Issue, Patch } from "@aftershock/schema";
import type { Assignment, AssignmentResult, DifferentialResult } from "@aftershock/schema/browser";

import { checklistAssignment, verify, type VerifyDeps } from "./verify.js";

const issue: Issue = {
  id: "issue-143",
  runId: "run_8f2a",
  findingId: "f1",
  number: 143,
  url: "https://github.com/o/r/issues/143",
  title: "Checkout total does not update",
  body: "...",
  labels: ["aftershock"],
  fixChecklist: ["Cart total recomputes when a coupon is applied"],
};

const patch: Patch = {
  id: "patch-143-1",
  issueId: "issue-143",
  branch: "aftershock/fix-143",
  commitMessage: "fix: x",
  diff: "d",
  attempt: 1,
  verified: false,
  previewUrl: null,
};

const assignment: Assignment = {
  id: "A1",
  runId: "run_8f2a",
  archetype: "conformance",
  route: "/checkout",
  objective: "Entering coupon SAVE20 reduces the order total",
  journey: [{ instruction: "Click apply", action: { selector: "#apply", description: "apply" } }],
};

const result = (findings: number, sessionId = "sess"): AssignmentResult => ({
  assignmentId: "A1",
  sessionId,
  steps: [],
  findings: Array.from({ length: findings }, () => ({
    class: "assertion_violation" as const,
    severity: "high" as const,
    signature: "sig",
    summary: "s",
    stepIndex: 0,
    evidence: [],
  })),
  startedAt: "2026-09-19T00:00:00.000Z",
  finishedAt: "2026-09-19T00:01:00.000Z",
});

const differential = (findings: number): DifferentialResult => ({
  assignmentId: "D1",
  previewSessionId: "p",
  baseSessionId: "b",
  deltas: [],
  noiseFiltered: 0,
  findings: result(findings).findings,
  startedAt: "2026-09-19T00:00:00.000Z",
  finishedAt: "2026-09-19T00:01:00.000Z",
});

const deps = (over: Partial<VerifyDeps> = {}): VerifyDeps => ({
  runAssignment: vi.fn(async () => result(0, "after-sess")),
  runDifferential: vi.fn(async () => differential(0)),
  ...over,
});

const base = {
  patch,
  issue,
  failed: [{ assignment, before: result(1, "before-sess") }],
  fixUrl: "https://fix.example",
  baseUrl: "https://base.example",
  route: "/checkout",
  runId: "run_8f2a",
};

describe("checklistAssignment", () => {
  it("turns a checklist line into a one-step conformance assignment", () => {
    const built = checklistAssignment({
      runId: "run_8f2a",
      issueNumber: 143,
      index: 0,
      item: "Cart total recomputes",
      route: "/checkout",
    });
    expect(built.id).toBe("check-143-1");
    expect(built.archetype).toBe("conformance");
    expect(built.journey).toEqual([{ instruction: "Cart total recomputes" }]);
  });
});

describe("verify", () => {
  it("passes only when all three gates pass", async () => {
    const verification = await verify(base, deps());
    expect(verification.passed).toBe(true);
    expect(verification.regressionSuitePassed).toBe(true);
    expect(verification.rows[0]).toMatchObject({
      assignmentId: "A1",
      before: "failed",
      after: "passed",
      beforeSessionId: "before-sess",
      afterSessionId: "after-sess",
    });
  });

  it("replays the failing assignment rather than re-planning it", async () => {
    const runAssignment = vi.fn(async () => result(0));
    await verify(base, deps({ runAssignment }));
    expect(runAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ assignment, mode: "replay", side: "fix", targetUrl: "https://fix.example" }),
    );
  });

  it("plans the checklist items, because the behaviour is new", async () => {
    const runAssignment = vi.fn(async () => result(0));
    await verify(base, deps({ runAssignment }));
    const checklistCall = runAssignment.mock.calls.find(
      (call) => (call[0] as { assignment: Assignment }).assignment.id === "check-143-1",
    );
    expect(checklistCall).toBeDefined();
    expect(checklistCall![0]).toMatchObject({ mode: "plan" });
  });

  it("fails when the replayed assignment still finds something", async () => {
    const verification = await verify(base, deps({ runAssignment: vi.fn(async () => result(1)) }));
    expect(verification.rows[0]!.after).toBe("failed");
    expect(verification.passed).toBe(false);
  });

  it("treats a crashed replay as a failure, never as a pass", async () => {
    const verification = await verify(
      base,
      deps({
        runAssignment: vi.fn(async () => {
          throw new Error("browser died");
        }),
      }),
    );
    expect(verification.rows[0]!.after).toBe("failed");
    expect(verification.rows[0]!.afterSessionId).toBeNull();
    expect(verification.passed).toBe(false);
  });

  it("fails when the patch fixes the bug but breaks something else", async () => {
    const verification = await verify(
      { ...base, regressionSuite: [{ ...assignment, id: "D1", archetype: "differential" }] },
      deps({ runDifferential: vi.fn(async () => differential(2)) }),
    );
    expect(verification.regressionSuitePassed).toBe(false);
    expect(verification.passed).toBe(false);
  });

  it("skips the regression suite without a base rather than failing a working patch", async () => {
    const runDifferential = vi.fn(async () => differential(0));
    const verification = await verify(
      { ...base, baseUrl: null, regressionSuite: [assignment] },
      deps({ runDifferential }),
    );
    expect(runDifferential).not.toHaveBeenCalled();
    expect(verification.regressionSuitePassed).toBe(true);
    expect(verification.passed).toBe(true);
  });

  it("fails when a checklist item does not hold", async () => {
    const runAssignment = vi.fn(async (input: { assignment: Assignment }) =>
      input.assignment.id.startsWith("check-") ? result(1) : result(0),
    );
    const verification = await verify(base, deps({ runAssignment }));
    expect(verification.rows[0]!.after).toBe("passed");
    expect(verification.checklist[0]!.passed).toBe(false);
    expect(verification.passed).toBe(false);
  });

  it("carries screenshot urls into the before/after pair when they resolve", async () => {
    const verification = await verify(
      base,
      deps({ screenshotUrlFor: (r) => `https://shots.example/${r.sessionId}.png` }),
    );
    expect(verification.rows[0]!.beforeScreenshotUrl).toBe("https://shots.example/before-sess.png");
    expect(verification.rows[0]!.afterScreenshotUrl).toBe("https://shots.example/after-sess.png");
  });
});

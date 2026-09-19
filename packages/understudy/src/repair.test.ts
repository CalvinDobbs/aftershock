import { describe, expect, it, vi } from "vitest";
import type { Diagnosis, Issue, Verification } from "@aftershock/schema";
import type { CommitIntent } from "@aftershock/scout";

import type { CodexRunner } from "./codex.js";
import { failuresFrom, repair, unverifiedBody } from "./repair.js";

const issue: Issue = {
  id: "issue-143",
  runId: "run_8f2a",
  findingId: "f1",
  number: 143,
  url: "https://github.com/o/r/issues/143",
  title: "Checkout total does not update",
  body: "...",
  labels: ["aftershock"],
  fixChecklist: ["Cart total recomputes"],
};

const diagnosis: Diagnosis = {
  issueId: "issue-143",
  hypotheses: [
    {
      file: "hooks/useCartTotal.ts",
      lines: [12],
      confidence: 0.8,
      explanation: "memo omits appliedCoupon",
      evidence: ["diff"],
    },
  ],
  recommendedApproach: "Add the dependency.",
  inconclusive: false,
};

const intent: CommitIntent = {
  repo: "o/r",
  baseSha: "a",
  headSha: "b",
  messages: ["feat: coupons"],
  files: [{ filename: "hooks/useCartTotal.ts", status: "modified", additions: 2, deletions: 1 }],
};

const goodDiff = [
  "diff --git a/hooks/useCartTotal.ts b/hooks/useCartTotal.ts",
  "--- a/hooks/useCartTotal.ts",
  "+++ b/hooks/useCartTotal.ts",
  "+  }, [subtotal, appliedCoupon])",
].join("\n");

const testDiff = [
  "diff --git a/hooks/useCartTotal.test.ts b/hooks/useCartTotal.test.ts",
  "+  expect(1).toBe(1)",
].join("\n");

const codex = (): CodexRunner => ({
  session: vi.fn(() => ({
    run: vi.fn(async () => ({
      finalResponse: JSON.stringify({
        summary: "fix: recompute cart total",
        rationale: "Added the missing dependency.",
        usedHypothesis: "hooks/useCartTotal.ts",
      }),
      threadId: "thread-1",
      changedFiles: ["hooks/useCartTotal.ts"],
    })),
  })),
});

const verification = (over: Partial<Verification> = {}): Verification => ({
  patchId: "patch-143-1",
  rows: [
    {
      assignmentId: "A1",
      label: "Coupon reduces the total",
      before: "failed",
      after: "passed",
      beforeSessionId: "b",
      afterSessionId: "a",
      beforeScreenshotUrl: null,
      afterScreenshotUrl: null,
    },
  ],
  checklist: [{ item: "Cart total recomputes", passed: true }],
  regressionSuitePassed: true,
  passed: true,
  ...over,
});

const base = {
  issue,
  diagnosis,
  intent,
  workingDirectory: "/checkout",
  runId: "8f2a",
};

describe("failuresFrom", () => {
  it("names every failing gate, not just the first", () => {
    const failures = failuresFrom(
      verification({
        rows: [
          {
            assignmentId: "A1",
            label: "Coupon reduces the total",
            before: "failed",
            after: "failed",
            beforeSessionId: "b",
            afterSessionId: "a",
            beforeScreenshotUrl: null,
            afterScreenshotUrl: null,
          },
        ],
        checklist: [{ item: "Cart total recomputes", passed: false }],
        regressionSuitePassed: false,
        passed: false,
      }),
    );
    expect(failures).toHaveLength(3);
    expect(failures.join(" ")).toContain("A1");
    expect(failures.join(" ")).toContain("Cart total recomputes");
    expect(failures.join(" ")).toContain("broke something it did not fix");
  });

  it("says nothing about a verification that passed", () => {
    expect(failuresFrom(verification())).toEqual([]);
  });
});

describe("repair", () => {
  it("stops at one attempt when verification passes, and marks the patch verified", async () => {
    const verify = vi.fn(async () => verification());
    const outcome = await repair(base, { codex: codex(), readDiff: async () => goodDiff, verify });

    expect(outcome.verified).toBe(true);
    expect(outcome.patch.verified).toBe(true);
    expect(outcome.attempts).toHaveLength(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("retries once with the failure appended, then gives up honestly", async () => {
    const verify = vi.fn(async () => verification({ passed: false, regressionSuitePassed: false }));
    const runner = codex();
    const outcome = await repair(base, { codex: runner, readDiff: async () => goodDiff, verify });

    expect(outcome.verified).toBe(false);
    expect(outcome.attempts).toHaveLength(2);
    expect(verify).toHaveBeenCalledTimes(2);
    // The second attempt resumes the first one's thread rather than starting over.
    expect(runner.session).toHaveBeenLastCalledWith(
      expect.objectContaining({ resumeThreadId: "thread-1" }),
    );
  });

  it("never claims a fix it could not verify", async () => {
    const outcome = await repair(base, {
      codex: codex(),
      readDiff: async () => goodDiff,
      verify: async () => verification({ passed: false }),
    });
    expect(outcome.patch.verified).toBe(false);
    expect(outcome.verification?.passed).toBe(false);
  });

  it("retries a constraint breach, because the agent can be told what it broke", async () => {
    const diffs = [testDiff, goodDiff];
    let call = 0;
    const verify = vi.fn(async () => verification());
    const outcome = await repair(base, {
      codex: codex(),
      readDiff: async () => diffs[call++]!,
      verify,
    });

    expect(outcome.attempts[0]!.rejectedFor).toContain("tests were modified");
    expect(outcome.verified).toBe(true);
    // The rejected attempt was never verified — there was nothing to verify.
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("does not retry an inconclusive diagnosis, because nothing about it changes", async () => {
    const runner = codex();
    const verify = vi.fn();
    const outcome = await repair(
      { ...base, diagnosis: { ...diagnosis, hypotheses: [], inconclusive: true } },
      { codex: runner, readDiff: async () => goodDiff, verify },
    );

    expect(outcome.attempts).toHaveLength(1);
    expect(runner.session).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(outcome.verified).toBe(false);
  });

  it("honours a caller's attempt limit", async () => {
    const outcome = await repair(
      { ...base, maxAttempts: 3 },
      {
        codex: codex(),
        readDiff: async () => goodDiff,
        verify: async () => verification({ passed: false }),
      },
    );
    expect(outcome.attempts).toHaveLength(3);
  });
});

describe("unverifiedBody", () => {
  it("leads with the fact that it is unverified", async () => {
    const outcome = await repair(base, {
      codex: codex(),
      readDiff: async () => goodDiff,
      verify: async () =>
        verification({
          passed: false,
          checklist: [{ item: "Cart total recomputes", passed: false }],
        }),
    });

    const body = unverifiedBody(outcome, 143);
    expect(body.split("\n")[0]).toContain("could not verify this fix");
    expect(body).toContain("2 attempts");
    expect(body).toContain("What still fails");
    expect(body).toContain("Cart total recomputes");
  });

  it("describes a rejected attempt by its reason, not by a commit message it never had", async () => {
    const outcome = await repair(base, {
      codex: codex(),
      readDiff: async () => testDiff,
      verify: async () => verification(),
    });
    expect(unverifiedBody(outcome, 143)).toContain("Rejected before review: tests were modified");
  });
});

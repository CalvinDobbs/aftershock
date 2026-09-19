import { describe, expect, it, vi } from "vitest";
import type { Diagnosis, Issue } from "@aftershock/schema";
import type { CommitIntent } from "@aftershock/scout";

import { branchName, commitMessage } from "./brief.js";
import type { CodexRunner, CodexTurn } from "./codex.js";
import { parseSummary, writePatch } from "./understudy.js";

const issue: Issue = {
  id: "issue-143",
  runId: "run_8f2a",
  findingId: "f1",
  number: 143,
  url: "https://github.com/o/r/issues/143",
  title: "Checkout total does not update when a valid coupon is applied",
  body: "The coupon is accepted but the total stays at $84.00.",
  labels: ["aftershock"],
  fixChecklist: ["Cart total recomputes when a coupon is applied"],
};

const diagnosis: Diagnosis = {
  issueId: "issue-143",
  hypotheses: [
    {
      file: "hooks/useCartTotal.ts",
      lines: [12],
      confidence: 0.81,
      explanation: "useMemo omits appliedCoupon.",
      evidence: ["diff: appliedCoupon added"],
    },
  ],
  recommendedApproach: "Add appliedCoupon to the dependency array.",
  inconclusive: false,
};

const intent: CommitIntent = {
  repo: "o/r",
  baseSha: "aaaaaaa",
  headSha: "bbbbbbb",
  messages: ["feat: coupon codes"],
  files: [
    { filename: "hooks/useCartTotal.ts", status: "modified", additions: 4, deletions: 1, patch: "@@" },
  ],
};

const goodDiff = [
  "diff --git a/hooks/useCartTotal.ts b/hooks/useCartTotal.ts",
  "--- a/hooks/useCartTotal.ts",
  "+++ b/hooks/useCartTotal.ts",
  "@@ -10,3 +10,3 @@",
  "-  }, [subtotal])",
  "+  }, [subtotal, appliedCoupon])",
].join("\n");

const codexReturning = (turn: Partial<CodexTurn>, run = vi.fn()): CodexRunner => ({
  session: vi.fn(() => ({
    run: run.mockResolvedValue({
      finalResponse: JSON.stringify({
        summary: "fix: recompute cart total when a coupon is applied",
        rationale: "The useCartTotal memo omitted appliedCoupon from its dependency array.",
        usedHypothesis: "hooks/useCartTotal.ts",
      }),
      threadId: "thread-1",
      changedFiles: ["hooks/useCartTotal.ts"],
      ...turn,
    }),
  })),
});

const base = {
  issue,
  diagnosis,
  intent,
  workingDirectory: "/checkout",
  runId: "8f2a",
};

describe("branchName", () => {
  it("follows the convention and stays short", () => {
    expect(branchName(143, "Checkout total does not update when a valid coupon is applied")).toBe(
      "aftershock/fix-143-checkout-total-does-not",
    );
  });

  it("survives a title with nothing sluggable in it", () => {
    expect(branchName(7, "!!!")).toBe("aftershock/fix-7");
  });
});

describe("commitMessage", () => {
  it("carries the closing keyword and the run provenance", () => {
    const message = commitMessage({
      summary: "fix: recompute cart total",
      rationale: "The memo omitted appliedCoupon.",
      issueNumber: 143,
      runId: "8f2a",
    });
    expect(message.split("\n")[0]).toBe("fix: recompute cart total");
    expect(message).toContain("Closes #143");
    expect(message).toContain("Aftershock run 8f2a");
  });

  it("wraps the body so git log stays readable", () => {
    const message = commitMessage({
      summary: "fix: x",
      rationale: "word ".repeat(60),
      issueNumber: 1,
      runId: "r",
    });
    for (const line of message.split("\n")) expect(line.length).toBeLessThanOrEqual(72);
  });
});

describe("parseSummary", () => {
  it("reads a bare JSON answer", () => {
    expect(parseSummary('{"summary":"s","rationale":"r","usedHypothesis":"h"}')?.summary).toBe("s");
  });

  it("reads an answer the CLI wrapped in a fence", () => {
    const fenced = '```json\n{"summary":"s","rationale":"r","usedHypothesis":"h"}\n```';
    expect(parseSummary(fenced)?.summary).toBe("s");
  });

  it("returns null on prose rather than throwing", () => {
    expect(parseSummary("I fixed it!")).toBeNull();
  });
});

describe("writePatch", () => {
  it("returns a patch whose diff came from git, not from the model", async () => {
    const patch = await writePatch(base, {
      codex: codexReturning({}),
      readDiff: async () => goodDiff,
    });

    expect(patch.rejectedFor).toBeUndefined();
    expect(patch.diff).toBe(goodDiff);
    expect(patch.branch).toBe("aftershock/fix-143-checkout-total-does-not");
    expect(patch.commitMessage).toContain("Closes #143");
    expect(patch.threadId).toBe("thread-1");
    expect(patch.verified).toBe(false);
  });

  it("never runs Codex when the diagnosis was inconclusive", async () => {
    const codex = codexReturning({});
    const patch = await writePatch(
      { ...base, diagnosis: { ...diagnosis, hypotheses: [], inconclusive: true } },
      { codex, readDiff: async () => goodDiff },
    );

    expect(codex.session).not.toHaveBeenCalled();
    expect(patch.rejectedFor).toContain("no patch attempted");
    expect(patch.diff).toBe("");
  });

  it("rejects a patch that edited tests, even though the model produced one", async () => {
    const withTests = `${goodDiff}\ndiff --git a/hooks/useCartTotal.test.ts b/hooks/useCartTotal.test.ts\n+  expect(1).toBe(1)`;
    const patch = await writePatch(base, {
      codex: codexReturning({}),
      readDiff: async () => withTests,
    });

    expect(patch.rejectedFor).toContain("tests were modified");
    expect(patch.diff).toBe("");
    // The thread is kept so the retry can resume rather than start over.
    expect(patch.threadId).toBe("thread-1");
  });

  it("rejects an empty patch rather than reporting success on no change", async () => {
    const patch = await writePatch(base, {
      codex: codexReturning({}),
      readDiff: async () => "",
    });
    expect(patch.rejectedFor).toContain("empty");
  });

  it("returns a rejected patch when Codex itself fails", async () => {
    const codex: CodexRunner = {
      session: () => ({
        run: async () => {
          throw new Error("codex exited 1");
        },
      }),
    };
    const patch = await writePatch(base, { codex, readDiff: async () => goodDiff });
    expect(patch.rejectedFor).toContain("codex exited 1");
  });

  it("resumes the thread on a retry and sends the failure, not the original brief", async () => {
    const run = vi.fn();
    const codex = codexReturning({}, run);
    await writePatch(
      {
        ...base,
        attempt: 2,
        resumeThreadId: "thread-1",
        previousFailure: { reason: "Curtain Call failed", failures: ["A1 still failed"] },
      },
      { codex, readDiff: async () => goodDiff },
    );

    expect(codex.session).toHaveBeenCalledWith(
      expect.objectContaining({ resumeThreadId: "thread-1" }),
    );
    const prompt = run.mock.calls[0]![0] as string;
    expect(prompt).toContain("Your patch did not work");
    expect(prompt).toContain("A1 still failed");
    expect(prompt).not.toContain("## The issue");
  });

  it("sends the full brief on the first attempt", async () => {
    const run = vi.fn();
    await writePatch(base, { codex: codexReturning({}, run), readDiff: async () => goodDiff });
    const prompt = run.mock.calls[0]![0] as string;
    expect(prompt).toContain("## The issue");
    expect(prompt).toContain("Cart total recomputes when a coupon is applied");
    expect(prompt).toContain("Do not modify tests");
    expect(prompt).toContain("hooks/useCartTotal.ts:12");
  });

  it("still ships a patch when the model's summary is unreadable", async () => {
    const patch = await writePatch(base, {
      codex: codexReturning({ finalResponse: "I had a go at it" }),
      readDiff: async () => goodDiff,
    });
    expect(patch.rejectedFor).toBeUndefined();
    expect(patch.commitMessage).toContain("Closes #143");
    expect(patch.commitMessage.split("\n")[0]).toContain("fix:");
  });

  it("numbers the patch by attempt so two attempts are distinguishable", async () => {
    const first = await writePatch(base, {
      codex: codexReturning({}),
      readDiff: async () => goodDiff,
    });
    const second = await writePatch(
      { ...base, attempt: 2 },
      { codex: codexReturning({}), readDiff: async () => goodDiff },
    );
    expect(first.id).toBe("patch-143-1");
    expect(second.id).toBe("patch-143-2");
  });
});

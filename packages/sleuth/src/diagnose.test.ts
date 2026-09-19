import { describe, expect, it, vi } from "vitest";
import type { Issue } from "@aftershock/schema";
import type { CommitIntent } from "@aftershock/scout";

import { buildPrompt, diagnose, type DiagnosisModel } from "./diagnose.js";

const issue: Issue = {
  id: "issue-143",
  runId: "run_8f2a",
  findingId: "f1",
  number: 143,
  url: "https://github.com/o/r/issues/143",
  title: "Checkout total does not update when a valid coupon is applied",
  body: "The coupon is accepted but the displayed total stays at $84.00.",
  labels: ["aftershock", "bug"],
  fixChecklist: ["Cart total recomputes when a coupon is applied"],
};

const intent: CommitIntent = {
  repo: "o/r",
  baseSha: "aaaaaaa",
  headSha: "bbbbbbb",
  messages: ["feat: coupon codes at checkout"],
  files: [
    {
      filename: "hooks/useCartTotal.ts",
      status: "modified",
      additions: 12,
      deletions: 2,
      patch: "@@ const total = useMemo(() => subtotal, [subtotal]) @@",
    },
  ],
};

const modelReturning = (value: unknown): DiagnosisModel => ({
  complete: vi.fn(async () => value),
});

const goodAnswer = {
  hypotheses: [
    {
      file: "hooks/useCartTotal.ts",
      lines: [12, 19],
      confidence: 0.81,
      explanation: "useMemo omits appliedCoupon, so the total never recomputes.",
      evidence: ["network: no recalc request after 200", "diff: appliedCoupon added"],
    },
  ],
  recommendedApproach: "Add appliedCoupon to the dependency array.",
  inconclusive: false,
};

describe("buildPrompt", () => {
  it("hands the model a ranked suspect list, not just the diff", () => {
    const prompt = buildPrompt({ issue, intent, route: "/checkout" });
    expect(prompt).toContain("ranked by how likely");
    expect(prompt).toContain("1. hooks/useCartTotal.ts");
    expect(prompt).toContain("Issue #143");
  });

  it("includes the network capture when there is one, because it is often decisive", () => {
    const prompt = buildPrompt({
      issue,
      intent,
      evidence: { network: ["POST /api/coupon/validate 200"], console: [] },
    });
    expect(prompt).toContain("Network capture:");
    expect(prompt).toContain("POST /api/coupon/validate 200");
  });

  it("leaves the evidence sections out entirely when there is none", () => {
    expect(buildPrompt({ issue, intent })).not.toContain("Console capture:");
  });
});

describe("diagnose", () => {
  it("returns ranked hypotheses with their evidence", async () => {
    const result = await diagnose({ issue, intent }, { model: modelReturning(goodAnswer) });
    expect(result.inconclusive).toBe(false);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0]!.file).toBe("hooks/useCartTotal.ts");
    expect(result.hypotheses[0]!.evidence).toHaveLength(2);
    expect(result.recommendedApproach).toContain("dependency array");
  });

  it("is inconclusive when the model says so, rather than passing hypotheses through", async () => {
    const result = await diagnose(
      { issue, intent },
      {
        model: modelReturning({
          hypotheses: [{ ...goodAnswer.hypotheses[0]!, confidence: 0.9 }],
          recommendedApproach: "Nothing in the diff explains this.",
          inconclusive: true,
        }),
      },
    );
    expect(result.inconclusive).toBe(true);
    expect(result.hypotheses).toEqual([]);
  });

  it("is inconclusive rather than inventing a file when the model cannot be reached", async () => {
    const result = await diagnose(
      { issue, intent },
      {
        model: {
          complete: vi.fn(async () => {
            throw new Error("503");
          }),
        },
      },
    );
    expect(result.inconclusive).toBe(true);
    expect(result.hypotheses).toEqual([]);
    expect(result.recommendedApproach).toContain("could not be reached");
  });

  it("is inconclusive on an unusable answer", async () => {
    const result = await diagnose({ issue, intent }, { model: modelReturning({ nope: true }) });
    expect(result.inconclusive).toBe(true);
  });

  it("drops hypotheses nobody believes, and says so when none survive", async () => {
    const result = await diagnose(
      { issue, intent },
      {
        model: modelReturning({
          ...goodAnswer,
          hypotheses: [{ ...goodAnswer.hypotheses[0]!, confidence: 0.1 }],
        }),
      },
    );
    expect(result.inconclusive).toBe(true);
    expect(result.recommendedApproach).toContain("confidence floor");
  });

  it("sorts by confidence and honours the limit", async () => {
    const result = await diagnose(
      { issue, intent, hypothesesLimit: 2 },
      {
        model: modelReturning({
          ...goodAnswer,
          hypotheses: [
            { ...goodAnswer.hypotheses[0]!, file: "low.ts", confidence: 0.4 },
            { ...goodAnswer.hypotheses[0]!, file: "high.ts", confidence: 0.9 },
            { ...goodAnswer.hypotheses[0]!, file: "mid.ts", confidence: 0.6 },
          ],
        }),
      },
    );
    expect(result.hypotheses.map((h) => h.file)).toEqual(["high.ts", "mid.ts"]);
  });

  it("strips blank evidence and impossible line numbers", async () => {
    const result = await diagnose(
      { issue, intent },
      {
        model: modelReturning({
          ...goodAnswer,
          hypotheses: [
            { ...goodAnswer.hypotheses[0]!, lines: [12, 0, -3, 1.5], evidence: ["real", "  ", ""] },
          ],
        }),
      },
    );
    expect(result.hypotheses[0]!.lines).toEqual([12]);
    expect(result.hypotheses[0]!.evidence).toEqual(["real"]);
  });
});

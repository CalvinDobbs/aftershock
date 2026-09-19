import { describe, expect, it, vi } from "vitest";

import type { Surface } from "@aftershock/schema";

import { buildPrompt, inferCharter, smokeCharter, withCriticalPath } from "./charter.js";
import type { CommitIntent } from "./github.js";
import type { CharterModel } from "./model.js";

const intent: CommitIntent = {
  repo: "meridian-labs/meridian",
  baseSha: "c72d40ba91e7",
  headSha: "a3f9c2148d0e",
  messages: ["feat: coupon codes at checkout\n\nadds a percentage discount"],
  files: [
    {
      filename: "app/checkout/page.tsx",
      status: "modified",
      additions: 40,
      deletions: 2,
      patch: "@@ -1 +1 @@\n+<CouponInput />",
    },
  ],
  prNumber: 142,
  prTitle: "Coupon codes at checkout",
  prBody: "Applies a percentage discount to the order total.",
};

const surfaces: Surface[] = [
  { route: "/checkout", confidence: 0.95, reason: "direct: app/checkout/page.tsx changed" },
];

const GOOD = {
  summary: "Adds a coupon field to checkout that applies a percentage discount.",
  claims: ["Valid codes reduce the displayed total"],
  confidence: 0.86,
  assertions: [
    {
      id: "A1",
      route: "/checkout",
      statement: "Entering SAVE20 reduces the order total by 20 percent",
      steps: ["Add an item to the cart", "Open checkout", "Enter SAVE20 and apply"],
      severity: "critical",
      derivedFrom: "applyDiscount.ts:14",
    },
  ],
  blastRadius: ["checkout"],
  riskScore: 0.72,
};

const model = (impl: () => Promise<unknown>): CharterModel => ({ complete: vi.fn(impl) });

describe("buildPrompt", () => {
  it("shows the model intent, routes and diff", () => {
    const prompt = buildPrompt({ runId: "r", intent, surfaces });
    expect(prompt).toContain("feat: coupon codes at checkout");
    expect(prompt).toContain("Applies a percentage discount");
    expect(prompt).toContain("/checkout  (confidence 0.95");
    expect(prompt).toContain("app/checkout/page.tsx");
  });
});

describe("inferCharter", () => {
  it("turns a model response into a charter with citations intact", async () => {
    const charter = await inferCharter(
      { runId: "run_1", intent, surfaces },
      { model: model(async () => GOOD) },
    );

    expect(charter.intent.claims).toEqual(["Valid codes reduce the displayed total"]);
    const a1 = charter.assertions.find((a) => a.id === "A1");
    expect(a1?.type).toBe("conformance");
    expect(a1?.derivedFrom).toBe("applyDiscount.ts:14");
    expect(a1?.steps).toHaveLength(3);
  });

  it("always adds a differential assertion for the critical path", async () => {
    // The conformance oracle only checks what the author thought to mention.
    const charter = await inferCharter(
      {
        runId: "run_1",
        intent,
        surfaces,
        criticalJourney: { description: "Buy something", steps: ["Add to cart", "Check out"] },
      },
      { model: model(async () => GOOD) },
    );

    const differential = charter.assertions.filter((a) => a.type === "differential");
    expect(differential).toHaveLength(1);
    expect(differential[0]!.steps).toEqual(["Add to cart", "Check out"]);
  });

  it("falls back to a smoke charter when the model throws", async () => {
    const charter = await inferCharter(
      { runId: "run_1", intent, surfaces },
      { model: model(async () => { throw new Error("rate limited"); }) },
    );

    expect(charter.intent.confidence).toBe(0);
    expect(charter.intent.claims).toEqual([]);
    // Degraded, not aborted: the differential oracle needs no intent.
    expect(charter.assertions.filter((a) => a.type === "differential")).toHaveLength(1);
  });

  it("falls back when the model returns something unusable", async () => {
    const charter = await inferCharter(
      { runId: "run_1", intent, surfaces },
      { model: model(async () => ({ summary: "", nonsense: true })) },
    );
    expect(charter.intent.confidence).toBe(0);
  });

  it("clamps confidence and risk a model may return out of range", async () => {
    const charter = await inferCharter(
      { runId: "run_1", intent, surfaces },
      { model: model(async () => ({ ...GOOD, confidence: 4.2, riskScore: -1 })) },
    );
    expect(charter.intent.confidence).toBe(1);
    expect(charter.riskScore).toBe(0);
  });

  it("drops blank steps rather than handing a browser an empty instruction", async () => {
    const charter = await inferCharter(
      { runId: "run_1", intent, surfaces },
      {
        model: model(async () => ({
          ...GOOD,
          assertions: [{ ...GOOD.assertions[0], steps: ["Open checkout", "  ", ""] }],
        })),
      },
    );
    expect(charter.assertions.find((a) => a.id === "A1")?.steps).toEqual(["Open checkout"]);
  });
});

describe("withCriticalPath", () => {
  it("anchors on a route a browser can actually visit", () => {
    // The highest-confidence surface is often dynamic. Anchoring there meant
    // resolveRoute dropped the assignment and the run lost its only oracle
    // that works without intent.
    const dynamic: Surface[] = [
      { route: "/products/[slug]", confidence: 0.95, reason: "direct" },
      { route: "/cart", confidence: 0.6, reason: "direct" },
    ];
    const [added] = withCriticalPath([], dynamic, { description: "d", steps: ["s"] });
    expect(added!.route).toBe("/cart");
  });

  it("does not collide with a model-emitted D1", () => {
    const existing = [
      { id: "D1", type: "conformance" as const, route: "/", statement: "x", severity: "low" as const },
    ];
    const result = withCriticalPath(existing, surfaces, { description: "d", steps: ["s"] });
    expect(new Set(result.map((a) => a.id)).size).toBe(result.length);
  });

  it("does not add a second differential when one already exists", () => {
    const existing = [
      { id: "D1", type: "differential" as const, route: "/", severity: "critical" as const },
    ];
    expect(withCriticalPath(existing, surfaces, { description: "d", steps: ["s"] })).toHaveLength(1);
  });
});

describe("smokeCharter", () => {
  it("still tests something when Scout is lost entirely", () => {
    const charter = smokeCharter({ runId: "r", intent, surfaces });
    expect(charter.assertions).toHaveLength(1);
    expect(charter.assertions[0]!.type).toBe("differential");
  });
});

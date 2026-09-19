import { describe, expect, it } from "vitest";

import type { TestCharter } from "@aftershock/schema";

import { dispatchOrder, resolveRoute, sessionBudget, toAssignments } from "./assignments.js";

const charter = (assertions: TestCharter["assertions"]): TestCharter => ({
  runId: "run_1",
  intent: { summary: "s", claims: [], confidence: 0.5 },
  surfaces: [],
  assertions,
  blastRadius: [],
  riskScore: 0.5,
});

describe("resolveRoute", () => {
  it("passes concrete routes through", () => {
    expect(resolveRoute("/checkout")).toBe("/checkout");
  });

  it("fills dynamic segments from samples", () => {
    expect(resolveRoute("/products/[slug]", { slug: "wool-scarf" })).toBe("/products/wool-scarf");
  });

  it("refuses to guess at a dynamic segment", () => {
    // A guessed URL 404s, and a finding about a 404 we caused is noise.
    expect(resolveRoute("/products/[slug]")).toBeNull();
  });

  it("handles catch-all segments", () => {
    expect(resolveRoute("/docs/[...path]", { path: "intro" })).toBe("/docs/intro");
  });
});

describe("toAssignments", () => {
  it("converts assertions into runnable journeys", () => {
    const { assignments } = toAssignments(
      charter([
        {
          id: "A1",
          type: "conformance",
          route: "/checkout",
          statement: "SAVE20 reduces the total",
          steps: ["Open checkout", "Apply SAVE20"],
          severity: "critical",
        },
      ]),
      { runId: "run_1" },
    );

    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ archetype: "conformance", route: "/checkout" });
    expect(assignments[0]!.journey.map((j) => j.instruction)).toEqual([
      "Open checkout",
      "Apply SAVE20",
    ]);
  });

  it("uses the statement when the model gave no steps", () => {
    const { assignments } = toAssignments(
      charter([
        {
          id: "A1",
          type: "conformance",
          route: "/checkout",
          statement: "SAVE20 reduces the total",
          severity: "high",
        },
      ]),
      { runId: "run_1" },
    );
    expect(assignments[0]!.journey[0]!.instruction).toBe("SAVE20 reduces the total");
  });

  it("skips what it cannot run, and says why", () => {
    const { assignments, skipped } = toAssignments(
      charter([
        { id: "A1", type: "conformance", route: "/products/[slug]", statement: "x", severity: "low" },
        { id: "A2", type: "conformance", route: "/cart", severity: "low" },
      ]),
      { runId: "run_1" },
    );

    expect(assignments).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]!.reason).toContain("dynamic segment");
    expect(skipped[1]!.reason).toContain("no steps");
  });
});

describe("sessionBudget", () => {
  it("gives a trivial change a small fleet and a risky one the maximum", () => {
    expect(sessionBudget(0)).toBe(3);
    expect(sessionBudget(1)).toBe(8);
    expect(sessionBudget(0.72)).toBeGreaterThan(5);
  });

  it("never drops below the floor", () => {
    expect(sessionBudget(-5)).toBe(3);
  });
});

describe("dispatchOrder", () => {
  it("puts differential pairs first", () => {
    const order = dispatchOrder([
      { id: "A1", runId: "r", archetype: "conformance", route: "/", objective: "o", journey: [{ instruction: "i" }] },
      { id: "D1", runId: "r", archetype: "differential", route: "/", objective: "o", journey: [{ instruction: "i" }] },
    ]);
    expect(order[0]!.id).toBe("D1");
  });
});

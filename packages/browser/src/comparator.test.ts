import { describe, expect, it } from "vitest";

import type { AssignmentResult, StepSnapshot } from "@aftershock/schema/browser";

import { claimCovering, compareResults, compareSnapshots, findingsFrom } from "./comparator.js";

const shot = new Uint8Array([1]);

function snapshot(partial: Partial<StepSnapshot> & { url: string }): StepSnapshot {
  return {
    formattedTree: "",
    screenshot: shot,
    network: { requestCount: 0, failedRequests: [] },
    console: [],
    ...partial,
  };
}

const CLAIMS = [
  "A coupon input appears on the checkout page",
  "Valid codes reduce the displayed total",
];

describe("compareSnapshots", () => {
  it("catches the cart regression the diff never mentioned", () => {
    // The PRD's second planted bug: a shared formatPrice change breaks the
    // cart subtotal on a route the developer never touched.
    const deltas = compareSnapshots(
      4,
      snapshot({
        url: "https://app.vercel.app/cart",
        formattedTree: 'text "Wool scarf, oat"\ntext "Subtotal $132.00"',
      }),
      snapshot({
        url: "https://app-git-feat-coupons.vercel.app/cart",
        formattedTree: 'text "Wool scarf, oat"\ntext "Subtotal $NaN"',
      }),
      { claims: CLAIMS },
    );

    const unclaimed = deltas.filter((d) => d.classification === "unclaimed");
    expect(unclaimed).toHaveLength(1);
    expect(unclaimed[0]!.base).toContain("$132.00");
    expect(unclaimed[0]!.preview).toContain("$NaN");
    // Different hosts must not register as a navigation difference.
    expect(deltas.some((d) => d.channel === "url")).toBe(false);
  });

  it("lets a change the diff claimed through as expected", () => {
    const deltas = compareSnapshots(
      1,
      snapshot({ url: "https://a.dev/checkout", formattedTree: 'text "Total $84.00"' }),
      snapshot({
        url: "https://b.dev/checkout",
        formattedTree: 'text "Total $84.00"\ntextbox "Coupon code"',
      }),
      { claims: CLAIMS, route: "/checkout" },
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.classification).toBe("claimed");
    expect(deltas[0]!.reason).toContain("coupon input appears");
  });

  it("normalises churn away instead of reporting it", () => {
    const deltas = compareSnapshots(
      0,
      snapshot({
        url: "https://a.dev/cart?_=1758290000000",
        formattedTree: 'text "Placed 2026-09-19T14:02:11Z" [ref=e11]',
      }),
      snapshot({
        url: "https://b.dev/cart?_=1758299999999",
        formattedTree: 'text "Placed 2026-09-19T14:44:02Z" [ref=e87]',
      }),
      { claims: CLAIMS },
    );

    expect(deltas.filter((d) => d.classification === "unclaimed")).toHaveLength(0);
  });

  it("does not treat reordering as a difference", () => {
    const deltas = compareSnapshots(
      0,
      snapshot({ url: "https://a.dev/cart", formattedTree: 'text "A"\ntext "B"' }),
      snapshot({ url: "https://b.dev/cart", formattedTree: 'text "B"\ntext "A"' }),
    );
    expect(deltas).toHaveLength(0);
  });

  it("reports a request that only fails on the preview", () => {
    const deltas = compareSnapshots(
      2,
      snapshot({ url: "https://a.dev/checkout" }),
      snapshot({
        url: "https://b.dev/checkout",
        network: {
          requestCount: 4,
          failedRequests: [{ method: "POST", url: "https://b.dev/api/orders", status: 500 }],
        },
      }),
    );

    const net = deltas.find((d) => d.channel === "network");
    expect(net?.classification).toBe("unclaimed");
    expect(net?.base).toBe("ok on base");
  });

  it("ignores a failure that is already broken on base", () => {
    // Aftershock never reports a bug that already existed on main.
    const failing = {
      requestCount: 3,
      failedRequests: [{ method: "POST", url: "https://host/api/subscribe", status: 500 }],
    };
    const deltas = compareSnapshots(
      0,
      snapshot({ url: "https://a.dev/cart", network: failing }),
      snapshot({ url: "https://b.dev/cart", network: failing }),
    );
    expect(deltas.filter((d) => d.channel === "network")).toHaveLength(0);
  });

  it("reports a console error the base never logs", () => {
    const deltas = compareSnapshots(
      3,
      snapshot({ url: "https://a.dev/cart" }),
      snapshot({
        url: "https://b.dev/cart",
        console: [{ level: "error", text: "Received NaN for the children attribute", timestamp: 1 }],
      }),
    );
    expect(deltas.find((d) => d.channel === "console")?.classification).toBe("unclaimed");
  });

  it("flags a journey that diverged to a different page", () => {
    const deltas = compareSnapshots(
      5,
      snapshot({ url: "https://a.dev/orders/confirmed" }),
      snapshot({ url: "https://b.dev/cart" }),
    );
    const url = deltas.find((d) => d.channel === "url");
    expect(url?.classification).toBe("unclaimed");
  });

  it("never lets churn crowd out a real regression", () => {
    // A page with a dozen timestamps and one broken subtotal. Capping the
    // combined list meant the noise consumed the budget and the regression
    // was dropped without even being counted.
    const churn = (n: number) =>
      Array.from({ length: n }, (_, i) => `text "Row ${i} at 2026-09-19T14:0${i % 10}:11Z"`);

    const deltas = compareSnapshots(
      0,
      snapshot({
        url: "https://a.dev/cart",
        formattedTree: [...churn(14), 'text "Subtotal $132.00"'].join("\n"),
      }),
      snapshot({
        url: "https://b.dev/cart",
        formattedTree: [
          ...churn(14).map((l) => l.replace("14:0", "15:0")),
          'text "Subtotal $NaN"',
        ].join("\n"),
      }),
      { maxTreeDeltas: 12 },
    );

    const unclaimed = deltas.filter((d) => d.classification === "unclaimed");
    expect(unclaimed).toHaveLength(1);
    expect(unclaimed[0]!.preview).toContain("$NaN");
    expect(deltas.filter((d) => d.classification === "noise").length).toBeGreaterThan(0);
  });

  it("keeps distinct console errors as distinct findings", () => {
    const deltas = compareSnapshots(
      0,
      snapshot({ url: "https://a.dev/cart" }),
      snapshot({
        url: "https://b.dev/cart",
        console: [
          { level: "error", text: "Received NaN for the children attribute", timestamp: 1 },
          { level: "error", text: "Cannot read properties of undefined", timestamp: 2 },
        ],
      }),
    );
    expect(findingsFrom(deltas)).toHaveLength(2);
  });

  it("pairs two halves of a change that share exactly half their tokens", () => {
    const deltas = compareSnapshots(
      0,
      snapshot({ url: "https://a.dev/cart", formattedTree: "[0-17] text: Subtotal $132.00" }),
      snapshot({ url: "https://b.dev/cart", formattedTree: "[0-22] text: Subtotal $NaN" }),
    );
    // One paired change, not an orphan removal plus an orphan addition.
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.base).toContain("$132.00");
    expect(deltas[0]!.preview).toContain("$NaN");
  });
});

describe("claimCovering", () => {
  it("needs real overlap, not one shared word", () => {
    expect(claimCovering("total", "$84.00", "$67.20", ["A coupon input appears"])).toBeNull();
  });

  it("stays null when there are no claims at all", () => {
    // The oracle has to work with no charter — that is the whole point.
    expect(claimCovering("subtotal", "$132.00", "$NaN", [])).toBeNull();
  });
});

describe("findingsFrom", () => {
  it("clusters one behaviour seen on many steps into one finding", () => {
    const base = {
      channel: "tree" as const,
      field: 'text "Subtotal"',
      base: "$132.00",
      preview: "$NaN",
      classification: "unclaimed" as const,
      reason: "r",
    };
    const findings = findingsFrom([
      { ...base, stepIndex: 6 },
      { ...base, stepIndex: 4 },
      { ...base, stepIndex: 5 },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.stepIndex).toBe(4);
    expect(findings[0]!.evidence).toContain("seen on 3 steps");
  });

  it("raises nothing for claimed, noise or matching deltas", () => {
    expect(
      findingsFrom([
        { stepIndex: 0, channel: "tree", field: "f", base: "a", preview: "b", classification: "claimed", reason: "r" },
        { stepIndex: 0, channel: "tree", field: "g", base: "a", preview: "b", classification: "noise", reason: "r" },
        { stepIndex: 0, channel: "tree", field: "h", base: "a", preview: "a", classification: "match", reason: "r" },
      ]),
    ).toHaveLength(0);
  });
});

describe("compareResults", () => {
  const result = (id: string, urls: string[], trees: string[]): AssignmentResult => ({
    assignmentId: "D1",
    sessionId: id,
    steps: urls.map((url, i) => ({
      index: i,
      instruction: `step ${i}`,
      action: { selector: "x", description: "d" },
      snapshot: snapshot({ url, formattedTree: trees[i] ?? "" }),
      durationMs: 10,
    })),
    findings: [],
    startedAt: "2026-09-19T14:00:00.000Z",
    finishedAt: "2026-09-19T14:01:00.000Z",
  });

  it("walks both runs step for step and counts what it dismissed", () => {
    const outcome = compareResults(
      result("base", ["https://a.dev/cart", "https://a.dev/checkout"], [
        'text "Subtotal $132.00"',
        'text "Placed 2026-09-19T14:02:11Z"',
      ]),
      result("prev", ["https://b.dev/cart", "https://b.dev/checkout"], [
        'text "Subtotal $NaN"',
        'text "Placed 2026-09-19T14:40:00Z"',
      ]),
    );

    expect(outcome.findings).toHaveLength(1);
    expect(outcome.noiseFiltered).toBe(1);
  });

  it("treats a journey that stopped short as a finding in itself", () => {
    const outcome = compareResults(
      result("base", ["https://a.dev/cart", "https://a.dev/checkout"], ["", ""]),
      result("prev", ["https://b.dev/cart"], [""]),
    );
    expect(outcome.findings.some((f) => f.signature.includes("journey length"))).toBe(true);
  });
});

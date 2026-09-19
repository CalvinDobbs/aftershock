import { describe, expect, it } from "vitest";

import { normalise, normaliseTreeLine, pathAndQuery, volatileReason } from "./normalise.js";

describe("normalise", () => {
  it("collapses volatile shapes", () => {
    expect(normalise("order 2026-09-19T14:02:11Z")).toBe("order <ts>");
    expect(normalise("id 3f2a9c1e-4b5d-4c7a-9e1f-0a2b3c4d5e6f")).toBe("id <uuid>");
    expect(normalise("build dpl_9Fk2QxRt")).toBe("build <deployment>");
    expect(normalise("etag a1b2c3d4e5f607")).toBe("etag <hex>");
    expect(normalise("updated 4 minutes ago")).toBe("updated <ago>");
  });

  it("leaves the values a finding is made of alone", () => {
    // The coupon bug and the cart regression both live in these strings. If
    // normalisation touches them the comparator goes blind.
    expect(normalise("Total $84.00")).toBe("Total $84.00");
    expect(normalise("Total $67.20")).toBe("Total $67.20");
    expect(normalise("Subtotal $NaN")).toBe("Subtotal $NaN");
    expect(normalise("Order #142")).toBe("Order #142");
    expect(normalise("3 items")).toBe("3 items");
  });
});

describe("volatileReason", () => {
  it("explains a dismissal by naming the rules that fired", () => {
    const reason = volatileReason(
      "placed 2026-09-19T14:02:11Z",
      "placed 2026-09-19T14:09:44Z",
    );
    expect(reason).toBe("volatile: iso-8601");
  });

  it("returns null when the difference is real", () => {
    expect(volatileReason("Total $84.00", "Total $67.20")).toBeNull();
    expect(volatileReason("Subtotal $132.00", "Subtotal $NaN")).toBeNull();
  });

  it("returns null when the values already agree", () => {
    expect(volatileReason("Total $84.00", "Total $84.00")).toBeNull();
  });

  it("does not leak regex state between calls", () => {
    const a = volatileReason("id 3f2a9c1e-4b5d-4c7a-9e1f-0a2b3c4d5e6f", "id 11111111-2222-4333-8444-555555555555");
    const b = volatileReason("id 3f2a9c1e-4b5d-4c7a-9e1f-0a2b3c4d5e6f", "id 11111111-2222-4333-8444-555555555555");
    expect(a).toBe(b);
    expect(a).toContain("uuid");
  });
});

describe("pathAndQuery", () => {
  it("drops the origin so two deployments are comparable at all", () => {
    expect(pathAndQuery("https://app-git-feat.vercel.app/checkout")).toBe("/checkout");
    expect(pathAndQuery("https://app.vercel.app/checkout")).toBe("/checkout");
  });

  it("keeps meaningful query but drops cache-busters", () => {
    expect(pathAndQuery("https://a.dev/cart?step=2&_=1758290000000")).toBe("/cart?step=2");
  });

  it("still reports a real navigation difference", () => {
    expect(pathAndQuery("https://a.dev/orders/confirmed")).not.toBe(
      pathAndQuery("https://b.dev/cart"),
    );
  });
});

describe("normaliseTreeLine", () => {
  it("ignores attribute-only churn", () => {
    expect(normaliseTreeLine('button "Apply" [ref=e17]')).toBe(
      normaliseTreeLine('button "Apply" [ref=e42]'),
    );
  });

  it("ignores Stagehand's per-session node numbering", () => {
    // Two captures of an identical page disagree on every node id. The live
    // noise canary reported twelve findings against a static page until this
    // rule existed.
    expect(normaliseTreeLine("[0-20] link: Homepage")).toBe(
      normaliseTreeLine("[0-65] link: Homepage"),
    );
  });

  it("keeps the accessible name", () => {
    expect(normaliseTreeLine('button "Apply" [ref=e17]')).not.toBe(
      normaliseTreeLine('button "Remove" [ref=e17]'),
    );
  });
});

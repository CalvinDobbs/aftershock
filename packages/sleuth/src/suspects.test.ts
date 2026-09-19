import { describe, expect, it } from "vitest";

import { keywords, rankSuspects } from "./suspects.js";

const file = (
  filename: string,
  patch = "",
  additions = 10,
  deletions = 1,
): { filename: string; status: string; additions: number; deletions: number; patch?: string } => ({
  filename,
  status: "modified",
  additions,
  deletions,
  ...(patch ? { patch } : {}),
});

describe("keywords", () => {
  it("keeps short decisive words and drops boilerplate", () => {
    const words = keywords("The checkout total does not update when a coupon is applied");
    expect(words).toContain("total");
    expect(words).toContain("coupon");
    expect(words).toContain("checkout");
    expect(words).not.toContain("the");
    expect(words).not.toContain("does");
  });

  it("deduplicates", () => {
    expect(keywords("total total total")).toEqual(["total"]);
  });
});

describe("rankSuspects", () => {
  it("puts the file whose path matches the route first", () => {
    const ranked = rankSuspects({
      files: [file("lib/analytics.ts"), file("app/checkout/page.tsx")],
      route: "/checkout",
      failure: "something went wrong",
    });
    expect(ranked[0]!.file.filename).toBe("app/checkout/page.tsx");
    expect(ranked[0]!.reasons.join(" ")).toContain("/checkout");
  });

  it("promotes a file whose patch mentions the failure's own words", () => {
    const ranked = rankSuspects({
      files: [
        file("lib/analytics.ts", "track(event)"),
        file("hooks/useCartTotal.ts", "const total = useMemo(() => subtotal - coupon, [subtotal])"),
      ],
      route: "/",
      failure: "The cart total does not update when a coupon is applied",
    });
    expect(ranked[0]!.file.filename).toBe("hooks/useCartTotal.ts");
  });

  it("caps keyword scoring so the largest patch does not swamp the route", () => {
    // A file mentioning eight of the failure's words scores 1 + min(8, 4) = 5.
    // The file actually sitting on the route scores 1 + 3 + 1 = 5. Uncapped it
    // would be 9 against 5 — a rout decided by patch size rather than by
    // relevance, which is the wrong prior.
    const noisy = file("lib/strings.ts", "total coupon cart discount checkout order price apply");
    const onRoute = file("app/checkout/page.tsx", "render()");
    const ranked = rankSuspects({
      files: [noisy, onRoute],
      route: "/checkout",
      failure: "total coupon cart discount checkout order price apply",
    });
    const byName = Object.fromEntries(ranked.map((s) => [s.file.filename, s.score]));
    expect(byName["lib/strings.ts"]).toBe(5);
    expect(byName["app/checkout/page.tsx"]).toBe(5);
  });

  it("demotes a file the commit only deleted from", () => {
    const ranked = rankSuspects({
      files: [file("kept.ts", "x", 5, 0), file("gone.ts", "x", 0, 40)],
      route: "/",
      failure: "anything",
    });
    expect(ranked[ranked.length - 1]!.file.filename).toBe("gone.ts");
  });

  it("keeps every changed file, so the model is never handed a pre-emptied list", () => {
    const ranked = rankSuspects({
      files: [file("a.ts"), file("b.ts"), file("c.ts")],
      route: "/nowhere",
      failure: "unrelated words entirely",
    });
    expect(ranked).toHaveLength(3);
  });

  it("ignores dynamic segments when matching a route", () => {
    const ranked = rankSuspects({
      files: [file("app/products/[slug]/page.tsx"), file("lib/misc.ts")],
      route: "/products/[slug]",
      failure: "x",
    });
    expect(ranked[0]!.file.filename).toBe("app/products/[slug]/page.tsx");
  });
});

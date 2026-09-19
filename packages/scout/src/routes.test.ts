import { describe, expect, it } from "vitest";

import { mapRoutes } from "./routes.js";
import type { ChangedFile } from "./github.js";

const file = (filename: string): ChangedFile => ({
  filename,
  status: "modified",
  additions: 1,
  deletions: 0,
});

describe("mapRoutes", () => {
  it("maps app-router pages by convention", () => {
    const surfaces = mapRoutes([file("app/checkout/page.tsx")]);
    expect(surfaces[0]).toMatchObject({ route: "/checkout", confidence: 0.95 });
    expect(surfaces[0]!.reason).toContain("direct");
  });

  it("strips route groups and private folders from the URL", () => {
    expect(mapRoutes([file("app/(shop)/cart/page.tsx")])[0]!.route).toBe("/cart");
    expect(mapRoutes([file("app/_internal/admin/page.tsx")])[0]!.route).toBe("/admin");
  });

  it("keeps dynamic segments as written", () => {
    expect(mapRoutes([file("app/products/[slug]/page.tsx")])[0]!.route).toBe("/products/[slug]");
  });

  it("maps the root page", () => {
    expect(mapRoutes([file("app/page.tsx")])[0]!.route).toBe("/");
    expect(mapRoutes([file("pages/index.tsx")])[0]!.route).toBe("/");
  });

  it("maps pages-router files", () => {
    expect(mapRoutes([file("pages/checkout.tsx")])[0]!.route).toBe("/checkout");
  });

  it("never sends a browser at an API route", () => {
    const surfaces = mapRoutes([file("app/api/coupon/route.ts")], {
      fallbackRoutes: ["/checkout"],
    });
    expect(surfaces.map((s) => s.route)).not.toContain("/api/coupon");
    // It still raises the fallback: the data behind a page changed.
    expect(surfaces.map((s) => s.route)).toContain("/checkout");
  });

  it("treats a root route handler as an API route, not the home page", () => {
    const surfaces = mapRoutes([file("app/route.ts")], { fallbackRoutes: ["/"] });
    expect(surfaces[0]!.confidence).toBe(0.4);
    expect(surfaces[0]!.reason).toContain("fallback");
  });

  it("falls back to primary journeys when only shared code changed", () => {
    const surfaces = mapRoutes([file("lib/formatPrice.ts")], {
      fallbackRoutes: ["/cart", "/checkout"],
    });
    expect(surfaces.map((s) => s.route)).toEqual(["/cart", "/checkout"]);
    expect(surfaces[0]!.confidence).toBeLessThan(0.5);
    expect(surfaces[0]!.reason).toContain("shared code");
  });

  it("reports a page directly and its shared dependencies as fallbacks", () => {
    const surfaces = mapRoutes(
      [file("app/checkout/page.tsx"), file("lib/formatPrice.ts")],
      { fallbackRoutes: ["/cart"] },
    );
    expect(surfaces[0]).toMatchObject({ route: "/checkout", confidence: 0.95 });
    expect(surfaces[1]).toMatchObject({ route: "/cart", confidence: 0.4 });
  });

  it("prefers the strongest reason when a route is reached twice", () => {
    const surfaces = mapRoutes([file("app/cart/page.tsx"), file("lib/x.ts")], {
      fallbackRoutes: ["/cart"],
    });
    expect(surfaces.filter((s) => s.route === "/cart")).toHaveLength(1);
    expect(surfaces[0]!.confidence).toBe(0.95);
  });

  it("returns nothing rather than guessing when there is no fallback", () => {
    expect(mapRoutes([file("README.md")])).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { EMPTY_PROJECT, loadProjects, projectFor } from "./projects.js";

describe("loadProjects", () => {
  it("reads per-repo configuration", () => {
    const projects = loadProjects(
      JSON.stringify({
        "o/r": {
          baseUrl: "https://base.test",
          fallbackRoutes: ["/cart"],
          routeSetup: { "/checkout": ["Go to /products/x", "Click add to cart"] },
        },
      }),
    );
    expect(projects["o/r"]?.routeSetup["/checkout"]).toHaveLength(2);
    expect(projects["o/r"]?.baseUrl).toBe("https://base.test");
  });

  it("ignores malformed config instead of taking the trigger down", () => {
    // A typo in one project must not stop every other repo being tested.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(loadProjects("{not json")).toEqual({});
    expect(loadProjects(JSON.stringify({ "o/r": { fallbackRoutes: ["cart"] } }))).toEqual({});
    spy.mockRestore();
  });

  it("returns nothing when unset", () => {
    expect(loadProjects(undefined)).toEqual({});
  });
});

describe("projectFor", () => {
  it("falls back to an empty config for an unknown repo", () => {
    expect(projectFor({}, "o/unknown")).toEqual(EMPTY_PROJECT);
    expect(EMPTY_PROJECT.baseUrl).toBeNull();
  });
});

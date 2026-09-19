import { describe, expect, it } from "vitest";

import { changedLineCount, changedPaths, violations } from "./constraints.js";

const diffFor = (paths: string[], linesEach = 2) =>
  paths
    .map((path) =>
      [
        `diff --git a/${path} b/${path}`,
        "index 1111111..2222222 100644",
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,3 +1,3 @@",
        ...Array.from({ length: linesEach }, (_, i) => `+  line ${i}`),
        "-  old line",
      ].join("\n"),
    )
    .join("\n");

describe("changedPaths", () => {
  it("reads the post-change name from the diff headers", () => {
    expect(changedPaths(diffFor(["hooks/useCartTotal.ts", "lib/price.ts"]))).toEqual([
      "hooks/useCartTotal.ts",
      "lib/price.ts",
    ]);
  });

  it("takes the b-side of a rename", () => {
    const diff = "diff --git a/old/name.ts b/new/name.ts\n--- a/old/name.ts\n+++ b/new/name.ts";
    expect(changedPaths(diff)).toEqual(["new/name.ts"]);
  });

  it("finds nothing in an empty diff", () => {
    expect(changedPaths("")).toEqual([]);
  });
});

describe("changedLineCount", () => {
  it("counts added and removed lines but not the file headers", () => {
    // Two + lines and one - line per file, and the +++/--- headers excluded.
    expect(changedLineCount(diffFor(["a.ts"]))).toBe(3);
  });
});

describe("violations", () => {
  it("passes a small, focused patch", () => {
    expect(violations(diffFor(["hooks/useCartTotal.ts"]))).toEqual([]);
  });

  it("rejects an empty patch", () => {
    expect(violations("")).toEqual(["the patch is empty: no files were changed"]);
  });

  it("rejects a patch that edits tests", () => {
    const found = violations(diffFor(["hooks/useCartTotal.test.ts"]));
    expect(found.join(" ")).toContain("tests were modified");
  });

  it("catches tests in a __tests__ or e2e directory too", () => {
    expect(violations(diffFor(["__tests__/cart.ts"])).join(" ")).toContain("tests were modified");
    expect(violations(diffFor(["e2e/checkout.ts"])).join(" ")).toContain("tests were modified");
  });

  it("rejects a patch that adds a dependency", () => {
    expect(violations(diffFor(["package.json"])).join(" ")).toContain("dependencies were changed");
  });

  it("catches a lockfile-only dependency change", () => {
    // An agent that adds a dependency usually touches both; catching only the
    // manifest would let a lockfile-only change install the package anyway.
    expect(violations(diffFor(["pnpm-lock.yaml"])).join(" ")).toContain("dependencies were changed");
  });

  it("rejects a patch spread over too many files", () => {
    const found = violations(diffFor(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]));
    expect(found.join(" ")).toContain("6 files changed");
  });

  it("rejects a refactor wearing a fix's clothes", () => {
    expect(violations(diffFor(["a.ts"], 200)).join(" ")).toContain("this is a refactor, not a fix");
  });

  it("reports every reason at once, so one retry can address them all", () => {
    const found = violations(diffFor(["package.json", "a.test.ts"]));
    expect(found).toHaveLength(2);
  });

  it("honours a caller's own limits", () => {
    expect(violations(diffFor(["a.ts", "b.ts"]), { maxFiles: 1, maxChangedLines: 500 })).toHaveLength(1);
  });
});

import { basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { resolveDataDirectory } from "./data-directory.js";

describe("resolveDataDirectory", () => {
  it("resolves a relative path against the repository root", () => {
    const resolved = resolveDataDirectory(".aftershock");
    const root = fileURLToPath(new URL("../..", import.meta.url));
    expect(isAbsolute(resolved)).toBe(true);
    expect(basename(resolved)).toBe(".aftershock");
    expect(dirname(resolved)).toBe(dirname(root));
  });

  it("preserves an absolute path", () => {
    const absolute = isAbsolute(tmpdir()) ? tmpdir() : `/${tmpdir()}`;
    expect(resolveDataDirectory(absolute)).toBe(absolute);
  });
});

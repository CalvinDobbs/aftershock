import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { gitDiff } from "./codex.js";

const exec = promisify(execFile);

/**
 * `gitDiff` shells out to real git, so the one thing worth testing is that the
 * argument list is one git accepts. Two live runs were lost to this: first
 * `-c diff.external=` made git execute the empty command, then `--no-ext-diff`
 * was placed before `diff` where it is not a valid global option.
 */
describe("gitDiff against a real repository", () => {
  it("returns the working-tree diff of an edited tracked file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aftershock-gitdiff-"));
    const git = (...args: string[]) =>
      exec("git", ["-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
    await git("init", "-q");
    await writeFile(join(dir, "money.ts"), "export const a = 1;\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "base");
    await writeFile(join(dir, "money.ts"), "export const a = 2;\n");

    const diff = await gitDiff(dir);

    expect(diff).toContain("--- a/money.ts");
    expect(diff).toContain("-export const a = 1;");
    expect(diff).toContain("+export const a = 2;");
  });

  it("returns an empty diff when nothing changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aftershock-gitdiff-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    expect(await gitDiff(dir)).toBe("");
  });
});

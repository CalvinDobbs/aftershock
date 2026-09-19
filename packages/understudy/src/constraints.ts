/**
 * The constraint gate.
 *
 * The PRD's four hard constraints go in the brief, but a brief is advisory:
 * an unconstrained coding agent handed a bug report will reformat a file,
 * rename three variables and bury the actual fix, and asking it not to does
 * not reliably stop it. So the constraints are checked here, from the diff
 * that actually came back, and a patch that breaks one never reaches a
 * reviewer.
 *
 * Same division of labour as the Critic: the model proposes, deterministic
 * code disposes.
 */

export interface Constraints {
  /** A reviewable patch is a small patch. */
  maxFiles: number;
  /** Guards against a refactor riding along with the fix. */
  maxChangedLines: number;
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxFiles: 5,
  maxChangedLines: 120,
};

const TEST_PATH = /(^|\/)(__tests__|test|tests|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Files whose change means a new dependency, not a fix.
 *
 * Lockfiles are listed alongside the manifests because an agent that adds a
 * dependency usually updates both, and catching only the manifest would let a
 * lockfile-only change through — which still installs the package.
 */
const DEPENDENCY_FILE =
  /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|requirements\.txt|go\.mod|Cargo\.toml)$/i;

/** Paths touched by a unified diff, read from its own headers. */
export function changedPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    // `diff --git a/path b/path`. The b-side is the post-change name, which is
    // the one that matters for a rename.
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2]) paths.add(match[2]);
  }
  return [...paths];
}

/** Added and removed lines, ignoring the +++/--- file headers. */
export function changedLineCount(diff: string): number {
  return diff
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---")),
    ).length;
}

/**
 * Every reason this patch is not acceptable, not just the first.
 *
 * Understudy gets one retry, and a retry that fixes the one violation it was
 * told about only to fail on the next is a wasted Codex run.
 */
export function violations(diff: string, constraints = DEFAULT_CONSTRAINTS): string[] {
  const paths = changedPaths(diff);
  const found: string[] = [];

  if (paths.length === 0) {
    found.push("the patch is empty: no files were changed");
    return found;
  }

  const tests = paths.filter((path) => TEST_PATH.test(path));
  if (tests.length > 0) {
    found.push(`tests were modified: ${tests.join(", ")}`);
  }

  const deps = paths.filter((path) => DEPENDENCY_FILE.test(path));
  if (deps.length > 0) {
    found.push(`dependencies were changed: ${deps.join(", ")}`);
  }

  if (paths.length > constraints.maxFiles) {
    found.push(
      `${paths.length} files changed, at most ${constraints.maxFiles} allowed: ${paths.join(", ")}`,
    );
  }

  const lines = changedLineCount(diff);
  if (lines > constraints.maxChangedLines) {
    found.push(
      `${lines} lines changed, at most ${constraints.maxChangedLines} allowed — this is a refactor, not a fix`,
    );
  }

  return found;
}

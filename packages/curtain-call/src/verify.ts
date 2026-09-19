import { Verification, type Issue, type Patch } from "@aftershock/schema";
import {
  AssignmentSchema,
  type Assignment,
  type AssignmentResult,
  type DifferentialResult,
} from "@aftershock/schema/browser";

/**
 * Stage 6. The loop closes, or it honestly does not.
 *
 * Without this, Aftershock is a bug finder that also guesses at fixes. With
 * it, Aftershock is a system that proves its own work — so the bar is three
 * gates, all of which must pass:
 *
 *   1. The exact failing assignments, replayed against the fix.
 *   2. The issue's fix checklist, as fresh conformance assertions.
 *   3. The full differential suite against the original base, because a fix
 *      that introduces a second regression is worse than no fix at all.
 *
 * Gate 1 replays rather than re-plans. The original run's Actions are
 * persisted, so the same test runs again and a pass therefore means something;
 * asking a model to find the button a second time would be a different test
 * wearing the same name, and it would cost inference to be less trustworthy.
 */

export interface VerifyInput {
  patch: Patch;
  issue: Issue;
  /** What failed, and the result that proves it failed. Gate 1. */
  failed: readonly { assignment: Assignment; before: AssignmentResult }[];
  /** Deployment of the patch branch. */
  fixUrl: string;
  /** The original base. Null skips gate 3 rather than failing it. */
  baseUrl: string | null;
  /** Gate 3. The differential assignments from the original run. */
  regressionSuite?: readonly Assignment[];
  /** Where checklist assertions are exercised. */
  route: string;
  runId: string;
}

export interface VerifyDeps {
  runAssignment(input: {
    assignment: Assignment;
    targetUrl: string;
    mode: "plan" | "replay";
    side: "preview" | "base" | "fix";
  }): Promise<AssignmentResult>;
  runDifferential(input: {
    assignment: Assignment;
    previewUrl: string;
    baseUrl: string;
  }): Promise<DifferentialResult>;
  /** Resolves a stored screenshot for the before/after pair, when there is one. */
  screenshotUrlFor?(result: AssignmentResult): string | null;
}

/** An assignment passes when it produced no findings. Nothing subtler is needed. */
const passed = (result: { findings: readonly unknown[] }): boolean =>
  result.findings.length === 0;

/**
 * A checklist line becomes a one-step conformance assignment.
 *
 * These are planned, not replayed: the checklist describes behaviour that did
 * not exist before the patch, so there is no recorded Action to replay. That
 * is the one place in this stage where inference is correct rather than a
 * shortcut.
 */
export function checklistAssignment(input: {
  runId: string;
  issueNumber: number;
  index: number;
  item: string;
  route: string;
}): Assignment {
  return AssignmentSchema.parse({
    id: `check-${input.issueNumber}-${input.index + 1}`,
    runId: input.runId,
    archetype: "conformance",
    route: input.route,
    objective: input.item,
    journey: [{ instruction: input.item }],
  });
}

export async function verify(input: VerifyInput, deps: VerifyDeps): Promise<Verification> {
  const screenshotUrlFor = deps.screenshotUrlFor ?? (() => null);

  // Gate 1 — the same test that failed, against the fix.
  const rows = await Promise.all(
    input.failed.map(async ({ assignment, before }) => {
      let after: AssignmentResult | null = null;
      try {
        after = await deps.runAssignment({
          assignment,
          targetUrl: input.fixUrl,
          mode: "replay",
          side: "fix",
        });
      } catch {
        // A browser that died is not a patch that worked. Treating a crashed
        // replay as a pass is the one mistake this stage must never make.
        after = null;
      }

      return {
        assignmentId: assignment.id,
        label: assignment.objective,
        before: passed(before) ? ("passed" as const) : ("failed" as const),
        after: after && passed(after) ? ("passed" as const) : ("failed" as const),
        beforeSessionId: before.sessionId,
        afterSessionId: after?.sessionId ?? null,
        beforeScreenshotUrl: screenshotUrlFor(before),
        afterScreenshotUrl: after ? screenshotUrlFor(after) : null,
      };
    }),
  );

  // Gate 2 — the checklist, as assertions rather than as prose.
  const checklist = await Promise.all(
    input.issue.fixChecklist.map(async (item, index) => {
      const assignment = checklistAssignment({
        runId: input.runId,
        issueNumber: input.issue.number,
        index,
        item,
        route: input.route,
      });
      try {
        const result = await deps.runAssignment({
          assignment,
          targetUrl: input.fixUrl,
          mode: "plan",
          side: "fix",
        });
        return { item, passed: passed(result) };
      } catch {
        return { item, passed: false };
      }
    }),
  );

  // Gate 3 — no second regression. Skipped, not failed, without a base:
  // losing the comparison is a coverage gap, and reporting a gap as a
  // failure would send a working patch back to Understudy.
  const suite = input.regressionSuite ?? [];
  let regressionSuitePassed = true;
  if (input.baseUrl && suite.length > 0) {
    const results = await Promise.all(
      suite.map(async (assignment) => {
        try {
          const result = await deps.runDifferential({
            assignment,
            previewUrl: input.fixUrl,
            baseUrl: input.baseUrl as string,
          });
          return passed(result);
        } catch {
          return false;
        }
      }),
    );
    regressionSuitePassed = results.every(Boolean);
  }

  return Verification.parse({
    patchId: input.patch.id,
    rows,
    checklist,
    regressionSuitePassed,
    passed:
      rows.every((row) => row.after === "passed") &&
      checklist.every((entry) => entry.passed) &&
      regressionSuitePassed,
  });
}

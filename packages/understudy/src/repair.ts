import type { Patch, Verification } from "@aftershock/schema";

import { writePatch, type WritePatchDeps, type WritePatchInput } from "./understudy.js";

/**
 * The retry policy, as a loop rather than as a rule somebody has to remember.
 *
 * The PRD is specific: if verification fails the patch goes back for one more
 * attempt with the failure appended, and after two failures the PR opens as a
 * draft labelled unverified with both attempts described. Aftershock never
 * silently gives up and never claims a fix it could not verify — so "we tried
 * twice and here is what happened" has to be a real artefact, not an absence.
 *
 * Verification is injected rather than imported so this does not depend on the
 * browser stack: the loop is about attempts and evidence, and it is testable
 * without opening a session.
 */

export interface RepairLoopInput
  extends Omit<WritePatchInput, "attempt" | "resumeThreadId" | "previousFailure"> {
  /** The PRD allows two. More would be a coding agent thrashing at a reviewer's expense. */
  maxAttempts?: number;
}

export interface RepairLoopDeps extends WritePatchDeps {
  verify(patch: Patch): Promise<Verification>;
}

export interface RepairOutcome {
  /** The attempt that was offered, which is the last one made. */
  patch: Patch;
  /** Absent when no attempt ever produced something worth verifying. */
  verification: Verification | null;
  /** Every attempt, in order. The PR body describes all of them. */
  attempts: Patch[];
  verified: boolean;
}

/**
 * Why a verification failed, in the words the retry brief needs.
 *
 * Every failing gate is listed rather than just the first, because a retry
 * that fixes one gate only to fail the next has spent a Codex run to learn
 * something the first failure already knew.
 */
export function failuresFrom(verification: Verification): string[] {
  const failures: string[] = [];

  for (const row of verification.rows) {
    if (row.after === "failed") {
      failures.push(`${row.assignmentId} (${row.label}) still fails against your patch`);
    }
  }
  for (const entry of verification.checklist) {
    if (!entry.passed) failures.push(`the fix checklist item "${entry.item}" does not hold`);
  }
  if (!verification.regressionSuitePassed) {
    failures.push(
      "the differential suite against the base branch regressed: your patch broke something it did not fix",
    );
  }

  return failures;
}

export async function repair(
  input: RepairLoopInput,
  deps: RepairLoopDeps,
): Promise<RepairOutcome> {
  const maxAttempts = input.maxAttempts ?? 2;
  const attempts: Patch[] = [];

  let resumeThreadId: string | undefined;
  let previousFailure: { reason: string; failures: string[] } | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const patch = await writePatch(
      {
        ...input,
        attempt,
        ...(resumeThreadId ? { resumeThreadId } : {}),
        ...(previousFailure ? { previousFailure } : {}),
      },
      deps,
    );
    attempts.push(patch);
    if (patch.threadId) resumeThreadId = patch.threadId;

    // Rejected before it was ever offered — a constraint breach, an empty
    // diff, or a diagnosis that never justified an attempt. The first two are
    // worth retrying because the agent can be told what it broke; the third
    // is not, because nothing about it changes on a second run.
    if (patch.rejectedFor) {
      if (!patch.threadId) break;
      previousFailure = {
        reason: "Your patch was rejected before it was offered to a reviewer.",
        failures: [patch.rejectedFor],
      };
      continue;
    }

    const verification = await deps.verify(patch);
    if (verification.passed) {
      const verified = { ...patch, verified: true };
      attempts[attempts.length - 1] = verified;
      return { patch: verified, verification, attempts, verified: true };
    }

    previousFailure = {
      reason: "Verification re-ran the failing journeys against your patch and they did not pass.",
      failures: failuresFrom(verification),
    };

    if (attempt === maxAttempts) {
      return { patch, verification, attempts, verified: false };
    }
  }

  return {
    patch: attempts[attempts.length - 1]!,
    verification: null,
    attempts,
    verified: false,
  };
}

/**
 * The PR body for an attempt that could not be verified.
 *
 * It leads with the fact rather than burying it: a reviewer who opens this
 * expecting a working fix and discovers otherwise three paragraphs down stops
 * trusting every PR the system opens after it.
 */
export function unverifiedBody(outcome: RepairOutcome, issueNumber: number): string {
  return [
    "> **Aftershock could not verify this fix.** It is open as a draft so you can",
    "> see what was tried. Do not merge it on the strength of the diff alone.",
    "",
    `Closes #${issueNumber} — if you finish it.`,
    "",
    `## What was tried (${outcome.attempts.length} attempt${outcome.attempts.length === 1 ? "" : "s"})`,
    "",
    ...outcome.attempts.flatMap((attempt, index) => [
      `**Attempt ${index + 1}.** ${
        attempt.rejectedFor
          ? `Rejected before review: ${attempt.rejectedFor}`
          : attempt.commitMessage.split("\n")[0]
      }`,
      "",
    ]),
    ...(outcome.verification
      ? ["## What still fails", "", ...failuresFrom(outcome.verification).map((f) => `- ${f}`), ""]
      : []),
  ].join("\n");
}

import { z } from "zod";
import { Patch, type Diagnosis, type Issue } from "@aftershock/schema";
import type { CommitIntent } from "@aftershock/scout";

import { branchName, buildBrief, commitMessage, retryBrief } from "./brief.js";
import { gitDiff, type CodexRunner, type DiffReader } from "./codex.js";
import { DEFAULT_CONSTRAINTS, violations, type Constraints } from "./constraints.js";

/**
 * Stage 5. A diagnosis becomes a patch.
 *
 * Codex is wrapped, not reimplemented: it is the repair engine inside the
 * product rather than a tool used to build it. What this module adds around it
 * is the part a coding agent does not do for you — a bounded brief, a patch
 * read from git rather than from the model, and a gate that rejects a patch
 * that ignored its constraints before any human is asked to read it.
 *
 * Every attempt returns a `Patch`, including the ones that produced nothing
 * usable. `Patch.rejectedFor` says why. Aftershock never silently gives up,
 * so "we tried and this is what came back" has to be representable.
 */

export interface WritePatchInput {
  issue: Issue;
  diagnosis: Diagnosis;
  intent: CommitIntent;
  /** A checkout of the commit under test. Codex edits this tree in place. */
  workingDirectory: string;
  /** Named in the commit trailer, so a reader can find the run that filed it. */
  runId: string;
  attempt?: number;
  /** From the previous attempt's Patch. Resuming keeps Codex's own reasoning. */
  resumeThreadId?: string;
  /** Why the previous attempt failed, appended to the same thread. */
  previousFailure?: { reason: string; failures: string[] };
  constraints?: Constraints;
}

export interface WritePatchDeps {
  codex: CodexRunner;
  readDiff?: DiffReader;
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "rationale", "usedHypothesis"],
  properties: {
    summary: {
      type: "string",
      description:
        "Conventional-commit subject line for this fix, under 72 characters. e.g. 'fix: recompute cart total when a coupon is applied'",
    },
    rationale: {
      type: "string",
      description:
        "Two or three sentences: what was wrong and what you changed. This becomes the commit body, so write it for a reviewer.",
    },
    usedHypothesis: {
      type: "string",
      description:
        "The file you actually fixed. If it was not one of the ranked hypotheses, say which one you rejected and why.",
    },
  },
};

const CodexSummary = z.object({
  summary: z.string().min(1),
  rationale: z.string(),
  usedHypothesis: z.string(),
});

/**
 * Codex answers with JSON when an outputSchema is set, but the CLI sometimes
 * wraps it in a fenced block. Parsing defensively here beats losing an
 * otherwise good patch to a formatting detail — the patch itself comes from
 * git, so a summary we cannot read costs a commit message, not the fix.
 */
export function parseSummary(finalResponse: string): z.infer<typeof CodexSummary> | null {
  const unfenced = finalResponse.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = CodexSummary.safeParse(JSON.parse(unfenced.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** An attempt that produced nothing to offer, with the reason preserved. */
function refused(input: WritePatchInput, attempt: number, reason: string, threadId?: string): Patch {
  return Patch.parse({
    id: `patch-${input.issue.number}-${attempt}`,
    issueId: input.issue.id,
    branch: branchName(input.issue.number, input.issue.title),
    commitMessage: "",
    diff: "",
    attempt,
    verified: false,
    previewUrl: null,
    rejectedFor: reason,
    ...(threadId ? { threadId } : {}),
  });
}

export async function writePatch(
  input: WritePatchInput,
  deps: WritePatchDeps,
): Promise<Patch> {
  const attempt = input.attempt ?? 1;
  const constraints = input.constraints ?? DEFAULT_CONSTRAINTS;

  // Sleuth reporting that it cannot find the cause is a useful answer, and
  // acting on it anyway would spend a Codex run to produce a diff aimed at a
  // file nobody believes in — which a reviewer then has to read and reject.
  if (input.diagnosis.inconclusive || input.diagnosis.hypotheses.length === 0) {
    return refused(
      input,
      attempt,
      `no patch attempted: ${input.diagnosis.recommendedApproach || "the diagnosis was inconclusive"}`,
    );
  }

  const session = deps.codex.session({
    workingDirectory: input.workingDirectory,
    ...(input.resumeThreadId ? { resumeThreadId: input.resumeThreadId } : {}),
  });

  const prompt =
    input.previousFailure && input.resumeThreadId
      ? retryBrief(input.previousFailure.reason, input.previousFailure.failures)
      : buildBrief({
          issue: input.issue,
          diagnosis: input.diagnosis,
          intent: input.intent,
          constraints,
        });

  let turn;
  try {
    turn = await session.run(prompt, OUTPUT_SCHEMA);
  } catch (error) {
    return refused(
      input,
      attempt,
      `codex failed: ${error instanceof Error ? error.message : String(error)}`,
      input.resumeThreadId,
    );
  }

  const threadId = turn.threadId ?? input.resumeThreadId;
  const readDiff = deps.readDiff ?? gitDiff;

  let diff: string;
  try {
    diff = await readDiff(input.workingDirectory);
  } catch (error) {
    return refused(
      input,
      attempt,
      `could not read the patch: ${error instanceof Error ? error.message : String(error)}`,
      threadId,
    );
  }

  // The gate. The brief asked for these; asking is not enforcing.
  const broken = violations(diff, constraints);
  if (broken.length > 0) {
    return refused(input, attempt, broken.join("; "), threadId);
  }

  const summary = parseSummary(turn.finalResponse);

  return Patch.parse({
    id: `patch-${input.issue.number}-${attempt}`,
    issueId: input.issue.id,
    branch: branchName(input.issue.number, input.issue.title),
    commitMessage: commitMessage({
      // A patch with an unreadable summary still ships; it just gets the
      // issue title as its subject rather than Codex's own wording.
      summary: summary?.summary ?? `fix: ${input.issue.title.toLowerCase()}`,
      rationale: summary?.rationale ?? input.diagnosis.recommendedApproach,
      issueNumber: input.issue.number,
      runId: input.runId,
    }),
    diff,
    attempt,
    verified: false,
    previewUrl: null,
    ...(threadId ? { threadId } : {}),
  });
}

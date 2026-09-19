import { z } from "zod";
import { Diagnosis, type Issue } from "@aftershock/schema";
import { renderDiff, type CommitIntent } from "@aftershock/scout";

import { rankSuspects } from "./suspects.js";

/**
 * Stage 4. A behavioural report becomes a code location.
 *
 * Sleuth is separate from Understudy on purpose: diagnosis and repair are
 * different skills, and merging them produces patches that fix the symptom.
 * What leaves here is a ranked set of hypotheses with the evidence for each —
 * never a single confident answer, because the Understudy brief is stronger
 * when it can see the second-best explanation and reject it.
 */

/**
 * Structurally identical to Scout's `CharterModel`, so `openAiModel()` can be
 * passed straight in. Declared here rather than imported so this package does
 * not depend on Scout's model wiring to be testable.
 */
export interface DiagnosisModel {
  complete(input: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface DiagnoseInput {
  issue: Issue;
  intent: CommitIntent;
  /** The route the failure was observed on. Drives the suspect ranking. */
  route?: string;
  hypothesesLimit?: number;
  /**
   * What the browser saw. The PRD is explicit that this is often decisive on
   * its own: a 200 from the API followed by no recalculation request localises
   * a bug to client state before any file is read.
   */
  evidence?: {
    network?: string[];
    console?: string[];
  };
}

export interface DiagnoseDeps {
  model: DiagnosisModel;
}

const SYSTEM = `You are Sleuth, the root cause stage of an automated QA system.

You are given a confirmed bug report and the commit that probably caused it.
You do not write code and you do not fix anything. You produce ranked
hypotheses about where the bug lives, each with the evidence that supports it.

Rules you must follow:

- Reason from the observable evidence to the code, never from the code
  outward. The network and console capture is often decisive on its own. If a
  request succeeded and no follow-up request was made, the bug is in client
  state and you can say so before reading a single line.
- You are given the changed files already ranked by how likely they are to
  hold the bug. That ranking is a prior, not an answer. Disagree with it when
  the evidence says otherwise, and say why you disagreed.
- Cite real evidence for every hypothesis. "diff: appliedCoupon added in this
  commit" and "network: no recalc request after 200" are evidence. "This looks
  suspicious" is not. Every string in the evidence array must be something a
  person could go and check.
- Line numbers must come from the diff you were shown. If you cannot tell
  which lines, return an empty array rather than a plausible-looking guess.
- Stop as soon as one hypothesis explains the observed behaviour. Two good
  hypotheses beat five, and the second exists mainly so the repair stage can
  reject it for a reason.
- If nothing you can see explains the behaviour, set inconclusive to true and
  return no hypotheses. This is a correct and useful answer. Inventing a
  plausible file is the failure that makes this whole stage untrustworthy,
  because a wrong location sends the repair stage somewhere it cannot help.
- recommendedApproach describes the smallest change that would fix the cause
  you identified, in one or two sentences. It is a brief for another agent,
  not a patch.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["hypotheses", "recommendedApproach", "inconclusive"],
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "lines", "confidence", "explanation", "evidence"],
        properties: {
          file: { type: "string", description: "Repository-relative path." },
          lines: {
            type: "array",
            items: { type: "number" },
            description: "Lines from the diff. Empty if you cannot tell.",
          },
          confidence: { type: "number", description: "0-1." },
          explanation: {
            type: "string",
            description: "How this code produces the observed behaviour.",
          },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "Checkable facts, each prefixed with its source.",
          },
        },
      },
    },
    recommendedApproach: { type: "string" },
    inconclusive: { type: "boolean" },
  },
};

const ModelDiagnosis = z.object({
  hypotheses: z.array(
    z.object({
      file: z.string().min(1),
      lines: z.array(z.number()),
      confidence: z.number(),
      explanation: z.string().min(1),
      evidence: z.array(z.string()),
    }),
  ),
  recommendedApproach: z.string(),
  inconclusive: z.boolean(),
});

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Below this, a hypothesis is not worth sending to the repair stage.
 *
 * Understudy edits real files. A patch aimed at a file nobody believes in
 * costs a Codex run and produces a diff a reviewer has to read and reject,
 * which is worse than Sleuth admitting it does not know.
 */
export const INCONCLUSIVE_BELOW = 0.3;

/** Everything the model is shown, in the order a person would read it. */
export function buildPrompt(input: DiagnoseInput): string {
  const route = input.route ?? "/";
  const suspects = rankSuspects({
    files: input.intent.files,
    route,
    failure: `${input.issue.title} ${input.issue.body}`,
  });

  return [
    `Issue #${input.issue.number}: ${input.issue.title}`,
    `Observed on route: ${route}`,
    "",
    input.issue.body,
    "",
    ...(input.evidence?.network?.length
      ? ["Network capture:", ...input.evidence.network.map((line) => `  ${line}`), ""]
      : []),
    ...(input.evidence?.console?.length
      ? ["Console capture:", ...input.evidence.console.map((line) => `  ${line}`), ""]
      : []),
    "Changed files, ranked by how likely they are to hold this bug:",
    ...suspects.map(
      (s, i) => `  ${i + 1}. ${s.file.filename} (score ${s.score}) — ${s.reasons.join("; ")}`,
    ),
    "",
    "Diff:",
    renderDiff(input.intent.files),
  ].join("\n");
}

/**
 * The honest answer when there is nothing to say.
 *
 * Returned when the model fails, returns something unusable, or returns only
 * hypotheses nobody believes. All three are the same situation from the repair
 * stage's point of view — no location worth patching — so they produce the
 * same artefact rather than three failure modes downstream.
 */
export function inconclusiveDiagnosis(issueId: string, reason: string): Diagnosis {
  return Diagnosis.parse({
    issueId,
    hypotheses: [],
    recommendedApproach: reason,
    inconclusive: true,
  });
}

export async function diagnose(
  input: DiagnoseInput,
  deps: DiagnoseDeps,
): Promise<Diagnosis> {
  let raw: unknown;
  try {
    raw = await deps.model.complete({
      system: SYSTEM,
      user: buildPrompt(input),
      schemaName: "diagnosis",
      schema: SCHEMA,
    });
  } catch {
    return inconclusiveDiagnosis(input.issue.id, "The diagnosis model could not be reached.");
  }

  const parsed = ModelDiagnosis.safeParse(raw);
  if (!parsed.success) {
    return inconclusiveDiagnosis(input.issue.id, "The diagnosis model returned an unusable answer.");
  }

  if (parsed.data.inconclusive) {
    return inconclusiveDiagnosis(
      input.issue.id,
      parsed.data.recommendedApproach || "No hypothesis explains the observed behaviour.",
    );
  }

  const hypotheses = parsed.data.hypotheses
    .map((h) => ({
      file: h.file,
      lines: h.lines.filter((line) => Number.isInteger(line) && line > 0),
      confidence: clamp(h.confidence),
      explanation: h.explanation,
      // An unsourced hypothesis reads as confident and is not. Dropping the
      // empty strings here keeps the issue body and the Understudy brief from
      // citing a blank line as evidence.
      evidence: h.evidence.filter((line) => line.trim().length > 0),
    }))
    .filter((h) => h.confidence >= INCONCLUSIVE_BELOW)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, input.hypothesesLimit ?? 3);

  if (hypotheses.length === 0) {
    return inconclusiveDiagnosis(
      input.issue.id,
      "No hypothesis cleared the confidence floor; the cause is not in the changed files.",
    );
  }

  return Diagnosis.parse({
    issueId: input.issue.id,
    hypotheses,
    recommendedApproach: parsed.data.recommendedApproach,
    inconclusive: false,
  });
}

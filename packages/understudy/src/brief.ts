import type { Diagnosis, Issue } from "@aftershock/schema";
import { renderDiff, type CommitIntent } from "@aftershock/scout";

import type { Constraints } from "./constraints.js";

/**
 * The brief Understudy hands Codex.
 *
 * Tightly bounded, not a vague request. The PRD is specific about what goes in
 * and the order matters: the issue states the behaviour, the hypotheses say
 * where to look, the diff says what just changed, the checklist is the
 * acceptance criteria, and the constraints are last because they are what the
 * agent is most likely to drift from.
 */

export function branchName(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 4)
    .join("-");
  return `aftershock/fix-${issueNumber}${slug ? `-${slug}` : ""}`;
}

/**
 * The commit message convention from the PRD, including the provenance line.
 *
 * "Found and verified by" is written before verification has happened, which
 * is deliberate: the commit is amended by nothing, and a patch that fails
 * Curtain Call never reaches a branch a reviewer sees — it comes back here for
 * one more attempt, or opens as an unverified draft that says so in its body.
 */
export function commitMessage(input: {
  summary: string;
  rationale: string;
  issueNumber: number;
  runId: string;
}): string {
  const wrapped = input.rationale
    .split(/\s+/)
    .reduce<string[]>((lines, word) => {
      const last = lines[lines.length - 1];
      if (last !== undefined && `${last} ${word}`.length <= 72) {
        lines[lines.length - 1] = `${last} ${word}`;
      } else {
        lines.push(word);
      }
      return lines;
    }, [])
    .join("\n");

  return [
    input.summary,
    "",
    wrapped,
    "",
    `Closes #${input.issueNumber}`,
    `Found and verified by Aftershock run ${input.runId}`,
  ].join("\n");
}

export function buildBrief(input: {
  issue: Issue;
  diagnosis: Diagnosis;
  intent: CommitIntent;
  constraints: Constraints;
}): string {
  const { issue, diagnosis, intent, constraints } = input;

  return [
    "You are fixing one confirmed bug in this repository. The working tree is",
    "checked out at the commit that introduced it.",
    "",
    "## The issue",
    "",
    `#${issue.number}: ${issue.title}`,
    "",
    issue.body,
    "",
    "## Where it probably lives",
    "",
    "These hypotheses come from a separate diagnosis stage, ranked by",
    "confidence. Treat them as a strong prior, not as instructions — if the",
    "code says otherwise, follow the code and say so in your summary.",
    "",
    ...diagnosis.hypotheses.map(
      (h, i) =>
        [
          `${i + 1}. ${h.file}${h.lines.length ? `:${h.lines.join(",")}` : ""} (confidence ${h.confidence.toFixed(2)})`,
          `   ${h.explanation}`,
          ...h.evidence.map((e) => `   - ${e}`),
        ].join("\n"),
    ),
    "",
    `Recommended approach: ${diagnosis.recommendedApproach}`,
    "",
    "## The commit that introduced it",
    "",
    renderDiff(intent.files, 2000),
    "",
    "## Acceptance criteria",
    "",
    "Your patch must satisfy every one of these. They are checked by replaying",
    "real browser sessions against your fix, so they are not advisory.",
    "",
    ...issue.fixChecklist.map((item) => `- ${item}`),
    "",
    "## Hard constraints",
    "",
    `- Change the minimum number of files. At most ${constraints.maxFiles}.`,
    `- Keep the patch under ${constraints.maxChangedLines} changed lines.`,
    "- Do not modify tests. Not to make them pass, not to add new ones.",
    "- Do not refactor adjacent code, rename anything, or reformat files.",
    "- Do not add, remove or upgrade any dependency.",
    "",
    "A patch breaking any of these is rejected automatically and never reaches",
    "a reviewer, so a smaller fix that satisfies the checklist always wins.",
    "",
    "Edit the files in place. Do not print a diff, do not create a branch and",
    "do not commit — that is handled for you.",
  ].join("\n");
}

/**
 * The second attempt.
 *
 * Appended to the same Codex thread rather than sent as a fresh prompt, so the
 * agent still has its own reasoning from the first attempt and can see what it
 * got wrong rather than re-deriving the problem from scratch.
 */
export function retryBrief(reason: string, failures: readonly string[]): string {
  return [
    "Your patch did not work. Here is exactly what happened:",
    "",
    reason,
    "",
    ...failures.map((failure) => `- ${failure}`),
    "",
    "Revise your fix in place. The same constraints and the same acceptance",
    "criteria still apply. If you now believe the cause is somewhere other than",
    "where you first looked, say so and fix it there instead.",
  ].join("\n");
}

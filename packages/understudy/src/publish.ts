import type { Issue, PullRequest } from "@aftershock/schema";

import { changedPaths } from "./constraints.js";
import { readChangedFiles } from "./codex.js";
import { unverifiedBody, type RepairOutcome } from "./repair.js";

/**
 * Shipping the outcome.
 *
 * The repair chain produces a patch and a verdict on it; this is what turns
 * that into something a person can review. It is the last step where the
 * product can mislead, so the rule it enforces is the one the PRD states
 * plainly: a patch that did not verify opens as a draft that says so, in its
 * labels and in its first line. Nothing opens quietly.
 */

/** The write surface this needs. `GitHubClient` satisfies it structurally. */
export interface PatchGitHub {
  createBranch(input: { repo: string; name: string; sha?: string; from?: string }): Promise<string>;
  commitFiles(input: {
    repo: string;
    branch: string;
    message: string;
    files: readonly { path: string; content: string }[];
  }): Promise<string>;
  openPullRequest(input: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    labels?: string[];
    draft?: boolean;
  }): Promise<{ number: number; html_url: string }>;
  setCommitStatus(input: {
    repo: string;
    sha: string;
    state: "success" | "failure" | "pending" | "error";
    description: string;
  }): Promise<void>;
}

export interface PublishInput {
  outcome: RepairOutcome;
  issue: Issue;
  repo: string;
  /** Branch the PR merges into. */
  baseBranch: string;
  /** Commit the patch was written against. The fix branches from here. */
  headSha: string;
  /** The checkout Codex edited; the committed contents are read from it. */
  workingDirectory: string;
  runId: string;
}

export interface PublishDeps {
  github: PatchGitHub;
  readFiles?: typeof readChangedFiles;
}

/**
 * The body for a patch that verified.
 *
 * Evidence first, code second. The reviewer's first question is "does this
 * actually work", so the answer to it is the first thing on the page — the
 * diff is one click away and the verification is not.
 */
export function verifiedBody(outcome: RepairOutcome, issue: Issue, runId: string): string {
  const verification = outcome.verification;
  return [
    `Closes #${issue.number}`,
    "",
    "## Verified",
    "",
    "Every journey below was **replayed** against this patch using the same",
    "recorded actions that failed on the original commit — the same test, not a",
    "new one written to pass.",
    "",
    ...(verification
      ? [
          "| Journey | Before | After |",
          "| --- | --- | --- |",
          ...verification.rows.map(
            (row) => `| ${row.label} | ${row.before} | **${row.after}** |`,
          ),
          "",
          "Fix checklist:",
          "",
          ...verification.checklist.map(
            (entry) => `- [${entry.passed ? "x" : " "}] ${entry.item}`,
          ),
          "",
          verification.regressionSuitePassed
            ? "The full differential suite against the base branch still passes, so this fix did not trade one regression for another."
            : "",
        ]
      : []),
    "",
    "## The change",
    "",
    outcome.patch.commitMessage.split("\n").slice(2).join("\n").replace(/\n\nCloses[\s\S]*$/, ""),
    "",
    `Found and fixed by Aftershock run ${runId}. No human opened a browser.`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

/**
 * Pushes the branch and opens the PR, or explains why it did not.
 *
 * Returns null when no attempt produced a diff at all — there is nothing to
 * push, and an empty PR is worse than none. The reason travels with it so the
 * run can report the gap rather than showing a stage that silently did nothing.
 */
export async function publishPatch(
  input: PublishInput,
  deps: PublishDeps,
): Promise<{ pullRequest: PullRequest; commitSha: string } | { pullRequest: null; reason: string }> {
  const { outcome, issue, repo } = input;
  const patch = outcome.patch;

  if (!patch.diff.trim()) {
    return {
      pullRequest: null,
      reason:
        patch.rejectedFor ?? "no attempt produced a patch, so there was nothing to open a PR for",
    };
  }

  const readFiles = deps.readFiles ?? readChangedFiles;
  const files = await readFiles(input.workingDirectory, changedPaths(patch.diff));

  await deps.github.createBranch({ repo, name: patch.branch, sha: input.headSha });
  const commitSha = await deps.github.commitFiles({
    repo,
    branch: patch.branch,
    message: patch.commitMessage,
    files,
  });

  const title = patch.commitMessage.split("\n")[0] ?? `fix: ${issue.title}`;
  const opened = await deps.github.openPullRequest({
    repo,
    head: patch.branch,
    base: input.baseBranch,
    title,
    body: outcome.verified
      ? verifiedBody(outcome, issue, input.runId)
      : unverifiedBody(outcome, issue.number),
    labels: [
      "aftershock",
      "automated-fix",
      outcome.verified ? "verified" : "aftershock:unverified",
    ],
    // An unverified patch is a draft. A reviewer who has to read the body to
    // discover it was never checked has already been misled by the PR list.
    draft: !outcome.verified,
  });

  await deps.github.setCommitStatus({
    repo,
    sha: commitSha,
    state: outcome.verified ? "success" : "failure",
    description: outcome.verified
      ? "Aftershock replayed the failing journeys against this patch and they pass"
      : "Aftershock could not verify this patch",
  });

  return {
    commitSha,
    pullRequest: {
      number: opened.number,
      url: opened.html_url,
      title,
      branch: patch.branch,
      baseBranch: input.baseBranch,
      labels: [
        "aftershock",
        "automated-fix",
        outcome.verified ? "verified" : "aftershock:unverified",
      ],
      draft: !outcome.verified,
      closesIssue: issue.number,
      body: outcome.verified
        ? verifiedBody(outcome, issue, input.runId)
        : unverifiedBody(outcome, issue.number),
    },
  };
}

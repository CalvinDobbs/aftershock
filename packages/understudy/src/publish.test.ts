import { describe, expect, it, vi } from "vitest";
import type { Issue, Verification } from "@aftershock/schema";

import { publishPatch, verifiedBody, type PatchGitHub } from "./publish.js";
import type { RepairOutcome } from "./repair.js";

const issue: Issue = {
  id: "issue-143",
  runId: "run_8f2a",
  findingId: "f1",
  number: 143,
  url: "https://github.com/o/r/issues/143",
  title: "Checkout total does not update",
  body: "...",
  labels: ["aftershock"],
  fixChecklist: ["Cart total recomputes when a coupon is applied"],
};

const diff = [
  "diff --git a/hooks/useCartTotal.ts b/hooks/useCartTotal.ts",
  "--- a/hooks/useCartTotal.ts",
  "+++ b/hooks/useCartTotal.ts",
  "+  }, [subtotal, appliedCoupon])",
].join("\n");

const verification: Verification = {
  patchId: "patch-143-1",
  rows: [
    {
      assignmentId: "A1",
      label: "Entering coupon SAVE20 reduces the order total",
      before: "failed",
      after: "passed",
      beforeSessionId: "b",
      afterSessionId: "a",
      beforeScreenshotUrl: null,
      afterScreenshotUrl: null,
    },
  ],
  checklist: [{ item: "Cart total recomputes when a coupon is applied", passed: true }],
  regressionSuitePassed: true,
  passed: true,
};

const outcome = (over: Partial<RepairOutcome> = {}): RepairOutcome => ({
  patch: {
    id: "patch-143-1",
    issueId: "issue-143",
    branch: "aftershock/fix-143-checkout-total",
    commitMessage:
      "fix: recompute cart total when a coupon is applied\n\nThe memo omitted appliedCoupon.\n\nCloses #143\nFound and verified by Aftershock run 8f2a",
    diff,
    attempt: 1,
    verified: true,
    previewUrl: null,
  },
  verification,
  attempts: [],
  verified: true,
  ...over,
});

function fakeGitHub() {
  const calls: Record<string, unknown[]> = {
    createBranch: [],
    commitFiles: [],
    openPullRequest: [],
    setCommitStatus: [],
  };
  const github: PatchGitHub = {
    createBranch: vi.fn(async (i) => {
      calls.createBranch!.push(i);
      return "headsha";
    }),
    commitFiles: vi.fn(async (i) => {
      calls.commitFiles!.push(i);
      return "newcommit";
    }),
    openPullRequest: vi.fn(async (i) => {
      calls.openPullRequest!.push(i);
      return { number: 145, html_url: "https://github.com/o/r/pull/145" };
    }),
    setCommitStatus: vi.fn(async (i) => {
      calls.setCommitStatus!.push(i);
    }),
  };
  return { github, calls };
}

const base = {
  issue,
  repo: "o/r",
  baseBranch: "main",
  headSha: "abc1234",
  workingDirectory: "/checkout",
  runId: "8f2a",
};

const readFiles = async () => [{ path: "hooks/useCartTotal.ts", content: "fixed" }];

describe("publishPatch", () => {
  it("opens a normal PR for a verified patch", async () => {
    const { github, calls } = fakeGitHub();
    const published = await publishPatch(
      { ...base, outcome: outcome() },
      { github, readFiles },
    );

    expect(published.pullRequest).not.toBeNull();
    expect(published.pullRequest!.number).toBe(145);
    expect(published.pullRequest!.draft).toBe(false);
    expect(published.pullRequest!.labels).toContain("verified");
    expect(published.pullRequest!.labels).not.toContain("aftershock:unverified");
    expect(published.pullRequest!.closesIssue).toBe(143);
    expect(calls.openPullRequest[0]).toMatchObject({ base: "main", draft: false });
  });

  it("branches from the commit under test, not from the base branch", async () => {
    const { github, calls } = fakeGitHub();
    await publishPatch({ ...base, outcome: outcome() }, { github, readFiles });
    expect(calls.createBranch[0]).toMatchObject({ sha: "abc1234" });
  });

  it("commits only the files the diff actually touched", async () => {
    const { github, calls } = fakeGitHub();
    await publishPatch({ ...base, outcome: outcome() }, { github, readFiles });
    expect(calls.commitFiles[0]).toMatchObject({
      branch: "aftershock/fix-143-checkout-total",
      files: [{ path: "hooks/useCartTotal.ts", content: "fixed" }],
    });
  });

  it("opens an unverified patch as a draft that says so", async () => {
    const { github, calls } = fakeGitHub();
    const published = await publishPatch(
      {
        ...base,
        outcome: outcome({
          verified: false,
          verification: { ...verification, passed: false, regressionSuitePassed: false },
          attempts: [outcome().patch, outcome().patch],
        }),
      },
      { github, readFiles },
    );

    expect(published.pullRequest!.draft).toBe(true);
    expect(published.pullRequest!.labels).toContain("aftershock:unverified");
    expect(published.pullRequest!.labels).not.toContain("verified");
    expect(published.pullRequest!.body).toContain("could not verify this fix");
    expect(calls.setCommitStatus[0]).toMatchObject({ state: "failure" });
  });

  it("posts a passing commit status only when it really verified", async () => {
    const { github, calls } = fakeGitHub();
    await publishPatch({ ...base, outcome: outcome() }, { github, readFiles });
    expect(calls.setCommitStatus[0]).toMatchObject({ sha: "newcommit", state: "success" });
  });

  it("opens nothing at all when no attempt produced a diff", async () => {
    const { github } = fakeGitHub();
    const published = await publishPatch(
      {
        ...base,
        outcome: outcome({
          verified: false,
          patch: { ...outcome().patch, diff: "", rejectedFor: "tests were modified" },
        }),
      },
      { github, readFiles },
    );

    expect(published.pullRequest).toBeNull();
    expect(github.createBranch).not.toHaveBeenCalled();
    expect(github.openPullRequest).not.toHaveBeenCalled();
    expect("reason" in published && published.reason).toContain("tests were modified");
  });
});

describe("verifiedBody", () => {
  it("leads with the evidence, not the code", () => {
    const body = verifiedBody(outcome(), issue, "8f2a");
    expect(body.indexOf("## Verified")).toBeLessThan(body.indexOf("## The change"));
    expect(body).toContain("Closes #143");
    expect(body).toContain("| Entering coupon SAVE20 reduces the order total | failed | **passed** |");
    expect(body).toContain("- [x] Cart total recomputes when a coupon is applied");
    expect(body).toContain("did not trade one regression for another");
  });

  it("does not repeat the closing trailer out of the commit body", () => {
    expect(verifiedBody(outcome(), issue, "8f2a").match(/Closes #143/g)).toHaveLength(1);
  });
});

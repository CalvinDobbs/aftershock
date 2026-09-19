import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The GitHub trigger.
 *
 * Two events, not one, and the order matters. A push arrives before any
 * preview exists, so the run is created immediately and does no work — which
 * is also good for the demo, because the run appears in the dashboard the
 * instant someone pushes. Real work starts when the deployment reports
 * success and there is finally somewhere to point a browser.
 *
 * Every path here converges on one `createRun`. The webhook is a caller, not
 * a second pipeline: if the manual trigger and the webhook diverge, the path
 * that gets demoed is not the path that got tested.
 */

export type WebhookOutcome =
  | { action: "created"; runId: string; status: "pending" }
  | { action: "started"; runId: string }
  | { action: "ignored"; reason: string };

export interface CreateRunInput {
  repo: string;
  /** Head SHA. */
  sha: string;
  ref: string;
  baseRef: string;
  prNumber?: number;
  /** Absent on a push: the deployment does not exist yet. */
  previewUrl?: string;
  /** Who pushed, as GitHub reports it. The sidebar shows this before Scout has read anything. */
  author?: string;
}

export interface WebhookDeps {
  /** The single convergence point. Idempotent per (repo, sha). */
  createRun(input: CreateRunInput): Promise<{ runId: string }>;
  /** Called once a deployment is live and the run can actually do work. */
  startRun(input: { runId: string; previewUrl: string }): Promise<void>;
  /** Looks up a run created earlier by an earlier event for the same commit. */
  findRun(input: { repo: string; sha: string }): Promise<{ runId: string } | null>;
}

/**
 * Constant-time signature check.
 *
 * An unsigned webhook endpoint lets anyone start browser runs on our budget,
 * so this fails closed: no secret configured means no requests accepted.
 */
export function verifySignature(
  body: string,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on a length mismatch, which is itself a leak.
  return a.length === b.length && timingSafeEqual(a, b);
}

type PushEvent = {
  ref?: string;
  after?: string;
  repository?: { full_name?: string; default_branch?: string };
  pusher?: { name?: string };
  head_commit?: { author?: { name?: string; username?: string } };
};
type PullRequestEvent = {
  action?: string;
  number?: number;
  pull_request?: {
    head?: { sha?: string; ref?: string };
    base?: { ref?: string };
    draft?: boolean;
    user?: { login?: string };
  };
  repository?: { full_name?: string };
};
type DeploymentStatusEvent = {
  deployment_status?: { state?: string; environment_url?: string; target_url?: string };
  deployment?: { sha?: string; ref?: string; environment?: string };
  repository?: { full_name?: string };
};

/** Branches we never test: tags, and the branch that *is* the baseline. */
function isTestableRef(ref: string, defaultBranch: string): boolean {
  if (!ref.startsWith("refs/heads/")) return false;
  return ref.replace("refs/heads/", "") !== defaultBranch;
}

export async function handleWebhook(
  event: string,
  payload: unknown,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  if (event === "push") {
    const p = payload as PushEvent;
    const repo = p.repository?.full_name;
    const ref = p.ref ?? "";
    const sha = p.after;
    if (!repo || !sha) return { action: "ignored", reason: "push without a repository or sha" };
    if (sha === "0000000000000000000000000000000000000000") {
      return { action: "ignored", reason: "branch deleted" };
    }
    const defaultBranch = p.repository?.default_branch ?? "main";
    if (!isTestableRef(ref, defaultBranch)) {
      // The default branch *is* the base every differential compares against.
      return { action: "ignored", reason: `${ref} is the baseline, not a change to test` };
    }

    // The commit's author over the pusher: a rebase-and-push by a teammate
    // should still credit whoever wrote the change.
    const author = p.head_commit?.author?.name ?? p.head_commit?.author?.username ?? p.pusher?.name;
    const { runId } = await deps.createRun({
      repo,
      sha,
      ref,
      baseRef: defaultBranch,
      ...(author ? { author } : {}),
    });
    return { action: "created", runId, status: "pending" };
  }

  if (event === "pull_request") {
    const p = payload as PullRequestEvent;
    const repo = p.repository?.full_name;
    const sha = p.pull_request?.head?.sha;
    if (!repo || !sha) return { action: "ignored", reason: "pull_request without a head sha" };
    if (!["opened", "synchronize", "reopened", "ready_for_review"].includes(p.action ?? "")) {
      return { action: "ignored", reason: `pull_request.${p.action} is not a code change` };
    }

    // A PR body is usually a richer statement of intent than the commit
    // message, so a run that knows its PR number gets a better charter.
    const { runId } = await deps.createRun({
      repo,
      sha,
      ref: p.pull_request?.head?.ref ?? "",
      baseRef: p.pull_request?.base?.ref ?? "main",
      ...(p.number !== undefined ? { prNumber: p.number } : {}),
      ...(p.pull_request?.user?.login ? { author: p.pull_request.user.login } : {}),
    });
    return { action: "created", runId, status: "pending" };
  }

  if (event === "deployment_status") {
    const p = payload as DeploymentStatusEvent;
    const repo = p.repository?.full_name;
    const sha = p.deployment?.sha;
    const state = p.deployment_status?.state;
    if (!repo || !sha) return { action: "ignored", reason: "deployment_status without a sha" };
    if (state !== "success") return { action: "ignored", reason: `deployment is ${state}` };

    const url = p.deployment_status?.environment_url ?? p.deployment_status?.target_url;
    if (!url) return { action: "ignored", reason: "deployment succeeded with no url" };

    // The run was created by the push or the PR that preceded this. If it was
    // not, the deployment belongs to something we are not watching.
    const existing = await deps.findRun({ repo, sha });
    if (!existing) return { action: "ignored", reason: "no run is waiting on this commit" };

    await deps.startRun({ runId: existing.runId, previewUrl: url });
    return { action: "started", runId: existing.runId };
  }

  return { action: "ignored", reason: `${event} is not a trigger` };
}

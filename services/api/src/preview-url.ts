/**
 * Finding the deployment a run should test.
 *
 * Boring, and it eats an hour if it is not planned, so all four paths exist
 * from the start and each one is tried in turn.
 *
 * The PRD's first fallback is the `deployment_status` webhook payload. On the
 * project we actually target that event never arrives: Vercel reports through
 * GitHub **commit statuses**, not the deployments API — `GET /deployments?ref=…`
 * returns an empty list while `GET /commits/:ref/status` carries the build.
 * So the payload path stays first for platforms that do emit it, and the
 * status path sits immediately behind it rather than being an afterthought.
 */

export interface PreviewUrlSources {
  /** From a `deployment_status` webhook, when the platform sends one. */
  payloadUrl?: string | null;
  /** Explicitly supplied on a manual trigger. Always wins if present. */
  manualUrl?: string | null;
  repo: string;
  /** Branch name, used for the deterministic host pattern. */
  ref: string;
  sha: string;
}

export interface PreviewUrlDeps {
  /** GitHub commit status → the build's target URL, if any. */
  commitStatusUrl?: (repo: string, sha: string) => Promise<string | null>;
  /** Vercel API → the ready deployment for this branch. */
  vercelDeploymentUrl?: (repo: string, ref: string, sha: string) => Promise<string | null>;
  /** Last resort: guess the host and check it answers. */
  probe?: (url: string) => Promise<boolean>;
  /** `demo-site` in `demo-site-git-<branch>-<team>.vercel.app`. */
  projectSlug?: string;
  teamSlug?: string;
}

export interface PreviewUrlResult {
  url: string | null;
  /** Which path produced it. Shown in the run, so a miss is diagnosable. */
  source: "manual" | "payload" | "commit-status" | "platform-api" | "pattern" | "none";
  /** Everything tried and why it did not work, in order. */
  attempts: string[];
}

/** `feat/coupon-codes` → `feat-coupon-codes`, as the host pattern requires. */
export function slugifyRef(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function deterministicHost(project: string, ref: string, team: string): string {
  return `https://${project}-git-${slugifyRef(ref)}-${team}.vercel.app`;
}

export async function resolvePreviewUrl(
  sources: PreviewUrlSources,
  deps: PreviewUrlDeps = {},
): Promise<PreviewUrlResult> {
  const attempts: string[] = [];

  if (sources.manualUrl) {
    return { url: sources.manualUrl, source: "manual", attempts };
  }
  attempts.push("manual: not supplied");

  if (sources.payloadUrl) {
    return { url: sources.payloadUrl, source: "payload", attempts };
  }
  attempts.push("deployment_status payload: no environment_url");

  if (deps.commitStatusUrl) {
    const url = await deps.commitStatusUrl(sources.repo, sources.sha).catch(() => null);
    if (url) return { url, source: "commit-status", attempts };
    attempts.push("commit status: no target_url for this sha");
  }

  if (deps.vercelDeploymentUrl) {
    const url = await deps
      .vercelDeploymentUrl(sources.repo, sources.ref, sources.sha)
      .catch(() => null);
    if (url) return { url, source: "platform-api", attempts };
    attempts.push("platform api: no ready deployment for this ref");
  }

  if (deps.projectSlug && deps.teamSlug) {
    const guess = deterministicHost(deps.projectSlug, sources.ref, deps.teamSlug);
    // Guessed hosts are checked before being trusted. Handing an agent a URL
    // that does not resolve produces a run full of findings about a 404 we
    // caused ourselves.
    const alive = deps.probe ? await deps.probe(guess).catch(() => false) : false;
    if (alive) return { url: guess, source: "pattern", attempts };
    attempts.push(`pattern: ${guess} did not respond`);
  }

  return { url: null, source: "none", attempts };
}

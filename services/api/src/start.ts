import { createServer } from "./server.js";
import { resolvePreviewUrl } from "./preview-url.js";

/**
 * Boots the trigger service.
 *
 * The four preview-URL paths are wired here rather than in the server so the
 * server stays testable without a network: every lookup is injected.
 */
const port = Number.parseInt(process.env.PORT ?? "3002", 10);
const githubToken = process.env.GITHUB_TOKEN;
const vercelToken = process.env.VERCEL_TOKEN;

async function commitStatusUrl(repo: string, sha: string): Promise<string | null> {
  if (!githubToken) return null;
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}/status`,
    { headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json" } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { statuses?: { state: string; target_url?: string }[] };
  // Vercel's target_url points at its dashboard, not the deployment, so this
  // only helps for platforms that link the deployment itself.
  const success = body.statuses?.find((s) => s.state === "success" && s.target_url);
  return success?.target_url?.startsWith("http") && !success.target_url.includes("vercel.com/")
    ? success.target_url
    : null;
}

async function vercelDeploymentUrl(_repo: string, ref: string): Promise<string | null> {
  if (!vercelToken || !process.env.VERCEL_PROJECT) return null;
  const response = await fetch(
    `https://api.vercel.com/v6/deployments?app=${process.env.VERCEL_PROJECT}&limit=20&state=READY`,
    { headers: { authorization: `Bearer ${vercelToken}` } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    deployments?: { url?: string; meta?: { githubCommitRef?: string } }[];
  };
  const match = body.deployments?.find((d) => d.meta?.githubCommitRef === ref.replace(/^refs\/heads\//, ""));
  return match?.url ? `https://${match.url}` : null;
}

const probe = async (url: string): Promise<boolean> =>
  fetch(url, { method: "GET", redirect: "manual" })
    .then((r) => r.status < 400)
    .catch(() => false);

const resolve = (input: { repo: string; sha: string; ref: string }) =>
  resolvePreviewUrl(
    { repo: input.repo, sha: input.sha, ref: input.ref },
    {
      commitStatusUrl,
      vercelDeploymentUrl: (repo, ref) => vercelDeploymentUrl(repo, ref),
      probe,
      ...(process.env.VERCEL_PROJECT ? { projectSlug: process.env.VERCEL_PROJECT } : {}),
      ...(process.env.VERCEL_TEAM ? { teamSlug: process.env.VERCEL_TEAM } : {}),
    },
  ).then((r) => r.url);

const app = createServer({
  ...(process.env.GITHUB_WEBHOOK_SECRET ? { webhookSecret: process.env.GITHUB_WEBHOOK_SECRET } : {}),
  ...(process.env.ORCHESTRATOR_URL ? { orchestratorUrl: process.env.ORCHESTRATOR_URL } : {}),
  resolvePreview: resolve,
  // The base is whatever the repo's default branch is deployed at. Null is
  // legal: differential pairs are skipped and the run carries on.
  resolveBase: async () => process.env.BASE_DEPLOYMENT_URL ?? null,
  logger: true,
});

app.listen({ port, host: "127.0.0.1" }).then(
  (address) => console.log(JSON.stringify({ url: address })),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

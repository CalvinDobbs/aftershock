# Operations guide

This guide covers live browser execution, GitHub triggers, repair publication,
and the repeatable judging rehearsal. To inspect the UI without credentials,
use the fixture-mode quick start in the root README.

## Prerequisites

- Node.js 22
- pnpm 10.17.1
- Browserbase and OpenAI credentials for live browser runs
- A reachable preview deployment for the change under test

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
cp project.example.json project.json
```

Edit `.env` and `project.json` for your environment. Both are ignored by git.

## Project configuration

`AFTERSHOCK_PROJECTS` is a JSON object keyed by `owner/repo`. It tells the API
which routes and setup steps matter for that application. A webhook payload can
describe what changed, but it cannot know that checkout requires items in a cart
or that a particular journey must never break.

`project.example.json` contains every supported field:

- `baseUrl`: deployment of the default branch; `null` skips differential pairs.
- `fallbackRoutes`: routes to test when shared code changes.
- `routeSamples`: values for dynamic URL segments.
- `routeSetup`: steps required before a route can be asserted.
- `criticalJourney`: behavior that should be checked for every relevant change.
- `maxConcurrent`: optional browser-session cap for the project.

Load the file when starting the API:

```bash
AFTERSHOCK_PROJECTS="$(cat project.json)" \
  pnpm --filter @aftershock/api dev
```

## Start the live stack

Run the three services in separate terminals:

```bash
# Director: stage machine, browsers, evidence, and replay
pnpm --filter @aftershock/orchestrator dev

# API: GitHub triggers, run registry, and preview URL resolution
PORT=3002 AFTERSHOCK_PROJECTS="$(cat project.json)" \
  pnpm --filter @aftershock/api dev

# Dashboard
AFTERSHOCK_API_URL=http://127.0.0.1:3002 pnpm dev
```

## Trigger a run

A GitHub webhook is the intended entry point. Configure
`GITHUB_WEBHOOK_SECRET`, then send `push`, `pull_request`, and
`deployment_status` events to `POST /webhooks/github`. Signature verification
fails closed when a secret is configured.

The API resolves a preview URL from the webhook payload, commit status, Vercel
API, or a deterministic Vercel branch URL with a reachability probe. Every
trigger converges on the same `createRun()` path.

For a manual run through the dashboard-compatible API:

```bash
curl -X POST localhost:3002/runs \
  -H 'content-type: application/json' \
  -d '{
    "repo": "owner/repo",
    "sha": "<commit-sha>",
    "ref": "refs/heads/feature",
    "baseRef": "main",
    "prNumber": 123,
    "previewUrl": "https://preview.example.com",
    "baseUrl": "https://baseline.example.com"
  }'
```

Open `http://localhost:3000/runs/<runId>` with the returned run ID.

## Enable live repair

Issue filing, patch generation, deployment, verification, and pull-request
publication are enabled only when both variables are present:

```dotenv
GITHUB_TOKEN=
AFTERSHOCK_PREVIEW_COMMAND=
```

`AFTERSHOCK_PREVIEW_COMMAND` is a JSON argument array, not a shell string. It
runs inside an isolated checkout of the patched source and must print a ready
public HTTPS URL as its final stdout line. `scripts/preview-deploy.sh` is a
working Vercel adapter.

```dotenv
AFTERSHOCK_PREVIEW_COMMAND='["bash","/absolute/path/to/aftershock/scripts/preview-deploy.sh"]'
AFTERSHOCK_REPAIR_BASE_BRANCH=feat/coupon-codes
AFTERSHOCK_PUBLISH_REPAIRS=true
```

Set `AFTERSHOCK_PUBLISH_REPAIRS=false` to retain generated patches and
verification results without pushing a repair branch, opening a pull request,
or posting a commit status. Issue filing and preview deployment still run.

The pipeline files at most three confirmed issues and repairs the
highest-ranked one. A verified repair for that issue is not a claim that every
other finding was fixed.

## One-command rehearsal

With the live environment configured:

```bash
pnpm live
```

The launcher starts an isolated dashboard, Director, and API, then prints a
single-use start link. It pins the known baseline and broken demo refs and
refuses to run if they changed.

- `pnpm live --check`: read-only configuration, URL, branch, and port checks.
- `pnpm live --serve-only`: start services and wait for the browser start link.
- `DEMO_PORT=3020 pnpm live`: use ports 3020 through 3022.

Each rehearsal stores its logs, media, and metadata under `.aftershock/demos/`.
The launcher stops only the services it started.

## Canary

```bash
curl -X POST localhost:3001/api/demo/canary
```

The canary compares a static page with itself. Any reported finding means the
normalization rules need review before differential findings can be trusted.

# Aftershock

**Autonomous QA and repair for every commit.** Your commit walks into a room
full of testers, and walks out with a fix.

Aftershock watches a repository. When a branch is pushed, it reads the diff,
works out what the change *claims* to do, drives real browsers against the
preview deployment to find out whether it does, files what it can prove, then
writes a patch, redeploys it, replays the same failing journey against the fix,
and opens a pull request only if the replay goes green.

No test suite. No selectors. Nobody writes a spec.

---

## It actually did this

One commit pushed to a storefront: a coupon feature that also moved price
formatting into a shared helper. It typechecks, lints and builds clean.
Aftershock was handed nothing but the webhook.

```
  scout          read the diff, wrote 6 assertions
  cast           6 assignments, 7 sessions — 2 passed, 3 failed, 1 skipped
  critic         reproduced all 3 failures, discarded none            112s
                 → issues #8, #9, #10 filed on GitHub                   1s
  sleuth         lib/money.ts lines 15-17, confidence 1.00              3s
  understudy     attempt 1 — 604 byte patch                            16s
  curtain call   replayed the failing journey against it · still red   69s
  understudy     attempt 2 — 489 byte patch, first failure as context  27s
  curtain call   replayed it again · green, no new regressions         65s
  maestro        → PR #11, labelled verified, not draft                 4s

  6m 29s wall clock · 0.6 browser-hours · 0 human decisions
```

The patch it wrote:

```diff
--- a/lib/money.ts
+++ b/lib/money.ts
@@ -15,6 +15,6 @@
 export function formatPrice(cents: number, discountPct?: number): string {
-  const net = cents * (1 - discountPct! / 100);
+  const net = discountPct === undefined ? cents : cents * (1 - discountPct / 100);
   return `$${(net / 100).toFixed(2)}`;
 }
```

One file, `+1 −1`. The non-null assertion made `discountPct!` pass typecheck,
and at runtime `1 - undefined / 100` is `NaN`, so every cart line rendered
`$NaN` — on a route the coupon feature never touched. CI was green the whole
time. The only way to find it was to open the page and look.

---

## Why this is not "an AI that writes tests"

An agent asked to test a change will write assertions that pass, because it
read the same code it is testing. Aftershock never trusts a single judgement.
Every finding has to survive two independent oracles and then a critic.

**Conformance** — *does the change do what it says?*
Scout reads the diff and the commit message and extracts the claim, before any
browser opens. Each claim becomes one assertion with a `derivedFrom` pointer
back to the line that justified it. An agent then drives the preview deployment
to check it. The gap between what the author said and what shipped is the
product.

**Differential** — *did it break something it never mentioned?*
The base branch is the oracle. The same recorded actions are replayed against
the preview and against `main`, and the accessibility trees are diffed. This
needs no charter, no model judgement and no ground truth: if the two pages
disagree about something the diff never claimed would change, that is a
regression by construction.

The `$NaN` bug was found by the differential oracle. Conformance could not have
caught it — the commit message never mentions the cart, and the assertion list
had no reason to look there.

Then the **Critic** tries to kill every finding: it reproduces the failure with
the recorded actions, checks the same behaviour is absent on base, and scores
confidence against a 0.70 threshold. Findings that survive get filed, with the
arithmetic shown. Three per run, maximum — a tool that files twelve issues is a
tool nobody reads.

---

## The room

A run is a thread, and every agent is in it. The dashboard is not a log viewer
with avatars bolted on; the transcript is a *pure projection* of pipeline
artefacts, computed in [`apps/web/lib/room.ts`](apps/web/lib/room.ts). Nothing
in the backend knows a conversation is being rendered.

| Agent | Stage | Job |
| --- | --- | --- |
| **Diffany** | Scout | turns the diff into claims |
| **QAizen** | Cast · conformance | checks one claim, start to finish |
| **Doppler** | Cast · differential | runs your branch against main |
| **Gavel** | Critic | the only one allowed to file |
| **Clueso** | Sleuth | reads the trace, then the code |
| **Patchouli** | Understudy | writes the smallest patch that passes |

**Maestro** — the Director — has no seat. It is deterministic code: a stage
machine, a concurrency semaphore and a journal, and it speaks as the room's
centred system lines. **Curtain Call** has no agent either, by design: it
re-runs QAizen and Doppler against the fix preview using *the actions that
originally failed*, so the verification is the same test, not a new one written
to pass.

```
TestCharter          → Diffany's message and the assertion list
Assignment.trace     → what QAizen and Doppler say, verbatim
Assignment.steps     → the recording card, screenshot strip, diff panes
Finding + modifiers  → Gavel's verdict and the discarded-finding ledger
Diagnosis            → Clueso's message and the suspect-file card
Patch / Verification → Patchouli's diff and the before-and-after table
```

Give an agent a good reasoning trace and it speaks well. Add a stage and it
gets a seat.

---

## Run it

```bash
corepack enable pnpm
pnpm install
pnpm dev                      # http://localhost:3000
```

**The dashboard runs with no backend at all.** With `AFTERSHOCK_API_URL` unset
it serves a recorded golden run and replays it over SSE at real pace. That is
both the frontend development mode and the demo-safety fallback — if the
network dies on stage, the run still plays. `?speed=0` replays instantly.

### The full pipeline, locally

Three processes. Copy `.env.example` to `.env` first and fill in
`BROWSERBASE_API_KEY` and `OPENAI_API_KEY` at minimum.

```bash
# 1. The Director — stage machine, browser runtime, evidence store
pnpm --filter @aftershock/orchestrator dev            # :3001

# 2. The API — GitHub webhooks, run registry, preview-URL resolution
PORT=3002 AFTERSHOCK_PROJECTS="$(cat project.json)" \
  pnpm --filter @aftershock/api dev                   # :3002

# 3. The dashboard
AFTERSHOCK_API_URL=http://127.0.0.1:3002 pnpm dev     # :3000
```

`AFTERSHOCK_PROJECTS` tells the API how to test a given repo — which routes to
fall back to, how to reach a page that needs setup, and what the critical
journey is. It is per-repo because "add two items and read the subtotal" is not
a thing any model should have to guess:

```jsonc
{
  "owner/repo": {
    "baseUrl": "https://app.vercel.app",
    "fallbackRoutes": ["/", "/cart", "/checkout"],
    "routeSamples": { "slug": "wool-scarf" },
    "routeSetup": {
      "/checkout": ["Go to /products/wool-scarf", "Click add to cart", "Go to /checkout"]
    },
    "criticalJourney": {
      "description": "Add two items and read the cart subtotal, no coupon",
      "route": "/products/wool-scarf",
      "steps": ["Click add to cart", "Go to /products/ceramic-mug", "Click add to cart", "Go to /cart"]
    },
    "maxConcurrent": 3
  }
}
```

### Triggering a run

A `git push` is the intended trigger — point a GitHub webhook at
`POST /webhooks/github` with `GITHUB_WEBHOOK_SECRET` set. Signature
verification **fails closed**: an unsigned endpoint lets anyone spend your
browser hours.

Push and `pull_request` create the run; `deployment_status` starts it once
there is something to point a browser at. All three converge on one
`createRun()`, because two entry points means two pipelines and the one that
gets demoed is never the one that got tested.

Vercel emits **commit statuses**, not deployments, so the API resolves a
preview URL through four fallbacks in order: the webhook payload, the commit
status, the Vercel API, and finally the deterministic
`app-git-<branch>-<team>.vercel.app` pattern with a reachability probe.

Or skip the webhook entirely:

```bash
curl -X POST localhost:3001/api/runs/from-commit \
  -H 'content-type: application/json' \
  -d '{"repo":"owner/repo","base":"main","head":"a3f9c21",
       "previewUrl":"https://app-git-feat.vercel.app",
       "baseUrl":"https://app.vercel.app",
       "fallbackRoutes":["/","/cart"]}'
```

Answers `202` with a run id; follow it on `/api/runs/:id/events/stream`.
`baseUrl: null` is legal — differential pairs are skipped and the run continues
on conformance alone.

### One-command judging rehearsal

With dependencies installed and the live repair environment configured:

```bash
pnpm live
```

This starts an isolated dashboard on port 3010, Director on 3011, and API on
3012, then prints a fresh run link. It reuses the original broken coupon commit
and its reachable preview. No branch reset or new feature PR is necessary:
leave the generated repair PR unmerged to keep the original bug available.

This is a manual trigger, not webhook detection. Each invocation may create
GitHub issues, Vercel previews, and a repair PR. Nothing is merged automatically.
The launcher refuses to run if the pinned baseline or coupon branch changed.

- `pnpm live --check`: read-only configuration, branch, URL and port checks.
- `pnpm live --serve-only`: starts servers and prints a clickable start link. Open
  it when judges are ready: it starts one run and redirects to its dashboard.
  Repeated clicks open the same run. No second terminal is needed.
- `DEMO_PORT=3020 pnpm live`: uses ports 3020–3022 instead.
- Leave the terminal open. Ctrl+C stops only these demo processes.
- Each launch stores logs, media and run metadata under `.aftershock/demos/`.
  Existing services and evidence are preserved.

### Enabling live repair

The repair chain (issue filing, diagnosis, patch generation, preview deployment,
verification, and PR publication) runs only when both variables are present:

```bash
GITHUB_TOKEN=                 # repo scope on the target repository
AFTERSHOCK_PREVIEW_COMMAND=   # JSON argv array, no shell evaluation
```

The preview command runs inside an isolated checkout of the patched code and
must print a **ready public HTTPS URL as its final stdout line** — that is the
whole contract. [`scripts/preview-deploy.sh`](scripts/preview-deploy.sh) is a
working Vercel implementation; anything that satisfies the contract works.

For Vercel, also set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
`VERCEL_PROJECT_ID`. Use an absolute script path on the machine running the
Director, since the command executes inside the temporary repair checkout:

```dotenv
AFTERSHOCK_PREVIEW_COMMAND='["bash","/absolute/path/to/aftershock/scripts/preview-deploy.sh"]'
AFTERSHOCK_REPAIR_BASE_BRANCH=feat/coupon-codes
AFTERSHOCK_PUBLISH_REPAIRS=true
```

Set `AFTERSHOCK_PUBLISH_REPAIRS=false` to retain generated patches and
verification results without creating a repair branch, committing files, opening
a PR, or posting commit status. This still files issues and deploys previews.
The default is publication enabled when repair services are configured.

The pipeline files up to three confirmed issues and repairs the highest-ranked
one per run. A verified cart repair does not mean a separate coupon failure was
fixed.

### Verified live rehearsal

A September 20 rehearsal completed the full pipeline in approximately three
minutes: [coupon PR #21](https://github.com/Nikhil-Doal/demo_site/pull/21) produced
two confirmed findings, and Aftershock generated a source patch, deployed it,
replayed the failed cart journey successfully, passed its differential regression
suite, and opened [repair PR #24](https://github.com/Nikhil-Doal/demo_site/pull/24).
The separate coupon-total finding remained open.

This rehearsal used a manual API trigger, not a GitHub webhook. To register a
manual run in the dashboard, send it through the API service, which forwards it
to the Director using the configured project journeys:

```bash
curl -X POST localhost:3002/runs \
  -H 'content-type: application/json' \
  -d '{"repo":"owner/repo","sha":"<commit-sha>","ref":"refs/heads/feature",
       "baseRef":"main","prNumber":123,
       "previewUrl":"https://preview.example.com",
       "baseUrl":"https://baseline.example.com"}'
```

Open `http://localhost:3000/runs/<runId>` using the returned ID. The earlier
direct Director endpoint also works, but bypasses the API service's in-memory
run registry.


> A bare `vercel deploy` does **not** satisfy it. It prints the URL to stderr
> and leaves `}` on stdout. That cost us a full run.

---

## Layout

```
apps/web                 the room — Next.js 15, Tailwind 4, SSE, hls.js
services/api             webhooks, run registry, preview-URL resolution
services/orchestrator    the Director — stage machine, semaphore, journal,
                         browser runtime, evidence and replay endpoints
packages/schema          Zod schemas — the vocabulary every service imports
packages/scout           diff → TestCharter
packages/browser         Stagehand harness, differential pairs, comparator
packages/critic          reproduction, confidence gates, issue authoring
packages/sleuth          failure trace → ranked file hypotheses
packages/understudy      patch writing, retry policy, branch and PR publishing
packages/curtain-call    replay the failing journey against the fix
design/                  the Claude Design source the UI is built from
```

Every service imports its types from `@aftershock/schema`; nothing defines its
own wire format. Evidence is JSONL event traces beside content-addressed
screenshots under `.aftershock/`, so a finished run is exactly as viewable as a
live one — and replayable at any speed.

**378 tests across 10 packages.** `pnpm check` runs typecheck and the full
suite.

---

## The differential oracle

The part with the least magic and the most leverage.

```
packages/browser/src/normalise.ts     noise rules, written before the comparator
packages/browser/src/comparator.ts    snapshot diff, four-way classification
packages/browser/src/differential.ts  paired sessions, plan once, replay both
```

**Planning happens exactly once.** If both sides asked a model what to click,
any difference between them could be model variance rather than a regression.
The preview side plans and produces a list of Actions; the base side replays
those Actions verbatim. A journey that already carries its Actions — a re-run,
or a Curtain Call verification — replays on both sides concurrently instead.

Every delta is classified, and every classification is explained:

| | |
| --- | --- |
| `match` | identical, or equal after normalisation. Never emitted. |
| `noise` | timestamps, uuids, node ids, cache-busters. Counted, never reported. |
| `claimed` | the diff said this would change. Expected. |
| `unclaimed` | nothing predicted it. **This is a regression.** |

The classification is deliberately **asymmetric**. A false `claimed` hides a
real regression forever; a false `unclaimed` only reaches the Critic, which has
three more gates to kill it. So `claimed` requires strong evidence and anything
ambiguous stays `unclaimed`.

Deltas that share a corrupt value are collapsed into one finding before they
reach the Critic. Three cart lines rendering `$NaN` is one bug, and filing it
three times pushes a genuine second finding off the per-run cap — which is
exactly what happened on the first live run.

### The noise canary

```bash
curl -X POST localhost:3001/api/demo/canary
```

One journey, run against the **same URL twice**. A page differs from itself on
every load, so a healthy run reports **zero** findings. If it reports any, the
normalisation rules have a hole and every differential finding in the product
is suspect.

It is not decoration. Its first run reported twelve findings against a static
page: Stagehand numbers accessibility-tree nodes per session, `[0-17]` on one
side and `[0-62]` on the other, so two captures of an identical page disagreed
on every single line. That rule now exists and is regression-tested.

Keep the canary target static. `AFTERSHOCK_CANARY_URL` defaults to
`example.com`; point it at a page whose content changes between loads and you
are measuring the internet, not the filter.

---

## What it does not do

- **Repair is single-threaded and single-issue.** One run diagnoses and patches
  the top-ranked finding only. The others are filed and left.
- **Two patch attempts, then it stops.** Attempt two gets the first attempt's
  failure as context. If it still fails verification, the PR opens as a draft
  labelled `aftershock:unverified` rather than silently claiming success.
  `RunSummary.verified` is set from `Verification.passed` and never inferred
  from a PR existing.
- **First-pass differential sessions run in sequence**, because the Actions
  have to exist before they can be replayed. Same browser-hours, twice the wall
  clock on a first run.
- **Runs are deduplicated per `(repo, sha)`** and held in memory. Re-pushing the
  same commit will not start a second run.
- **Persistence is JSONL on disk**, not Postgres. It replays and survives a
  restart; it does not survive a different machine.
- **Archetypes are `conformance | differential` only.** An `explorer` archetype
  is one line in `packages/schema/src/primitives.ts` plus an agent in the
  registry.

---

## Built at Hack the North 2026

Full specification: [prd.md](prd.md) · Design system: [design.md](design.md)

Browserbase and Stagehand for the browsers, OpenAI for the reasoning, Vercel
for the previews, Next.js for the room.

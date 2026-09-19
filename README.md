# Aftershock

**Autonomous QA and repair for every commit.** Your commit walks into a room full of testers, and walks out with a fix.

Full spec: [prd.md](prd.md) · Design system: [design.md](design.md)

---

## What is here

The dashboard end to end, the shared schema every service imports, and a
working browser runtime: real Browserbase sessions, real evidence, real
replays. The stage machine on top of it is still to come.

```
apps/web              the room — Next.js 15, Tailwind 4, SSE, hls.js
packages/schema       Zod schemas — the pipeline vocabulary, plus
                      @aftershock/schema/browser for agent telemetry
packages/browser      Stagehand harness — sessions, plan and replay modes,
                      screenshots, a11y snapshots, network and console evidence
services/api          webhook receiver, run API, GitHub integration   (stub)
services/orchestrator the Director — browser runtime and the observability API
                      today; stage machine, semaphore and dispatch still to come
design/               the Claude Design source the UI is built from
```

`apps/web` is the only frontend. The Vite control room that grew alongside the
browser runtime was scaffolding for it and has been removed; what it proved —
the HLS playback path and the observability client — lives here now.

## Run it

```bash
corepack enable pnpm
pnpm install
pnpm dev          # http://localhost:3000
```

**It works with no backend.** With `AFTERSHOCK_API_URL` unset the dashboard
serves a cached golden run from `apps/web/fixtures/golden-run.ts` and replays
it over SSE at real pace. That is both the pre-backend development mode and
the demo-safety fallback the PRD asks for — if the network dies on stage, the
run still plays.

Copy `.env.example` to `.env` and fill in keys as services come online.
`apps/web/.env.local` needs only `BROWSERBASE_API_KEY` (for replay playback)
and, once it exists, `AFTERSHOCK_API_URL`.

---

## The room

A run is a thread every bot is in. Six bots in the rail:

| Bot | Stage | Job |
| --- | --- | --- |
| Diffany | Scout | turns the diff into claims |
| QAizen | Cast · conformance | checks a claim start to finish |
| Doppler | Cast · differential | runs your branch against main |
| Gavel | Critic | the only one allowed to file |
| Clueso | Sleuth | reads the log, then the code |
| Patchouli | Understudy | writes the smallest patch |

**Maestro** (the Director) has no rail row — it is deterministic code, so it
speaks as the room's centred system lines. **Curtain Call** has no bot either:
the PRD gives its model as "reuses the Cast", so QAizen and Doppler replay
their own Actions against the fix preview and report the result themselves. The Claude Design source draws
eleven bots; Havoc, Wanda and Nitpick were cut in the PRD's own pre-agreed cut
order. See [design.md](design.md#the-cast).

One view. The rail shows who is working and on what; the thread carries the
conversation, the browsers, and the issue when Gavel files it. There is no
right-hand panel and no separate Browsers page — the recordings sit inline in
16:10 boxes that reserve their height before the video loads.

---

## How the frontend gets its data

**The frontend is built around the flow; the flow is not built around the frontend.**

The backend emits exactly what the PRD specifies. Nothing in it knows the
dashboard renders a conversation. The transcript is a *pure projection* of
pipeline artefacts, computed client-side in
[`apps/web/lib/room.ts`](apps/web/lib/room.ts):

```
TestCharter          -> Diffany's message + the assertion list
Assignment.trace     -> what QAizen and Doppler say, verbatim
Assignment.steps     -> the recording card, the screenshot strip, the diff panes
Finding + modifiers  -> Gavel's verdict and the discarded-finding ledger
Diagnosis            -> Clueso's message and the suspect-file rail card
Patch / Verification -> Patchouli's diff, the Cast re-run's before-and-after
```

So: **give an agent a good reasoning trace and it speaks well.** The PRD already
requires every agent to emit one ("Every agent emits a reasoning trace. Stored
as structured steps, streamed to the frontend after each stage completes") —
the room just renders it. Add a stage and it gets a seat; change how a stage
talks and nothing else moves.

To see how a run will read without opening the UI:

```bash
curl -s localhost:3000/api/runs/run_8f2a/room | jq '.[] | {kind, bot, body}'
```

### What `api` needs to serve

`apps/web/lib/api.ts` is the only place the dashboard talks to a backend.

| Endpoint | Returns |
| --- | --- |
| `GET /runs` | `RunSummary[]` |
| `GET /runs/:id` | `RunDetail` |
| `GET /runs/:id/events` | `text/event-stream` of `RunEvent` |
| `POST /runs` `{repo, sha}` | `{ runId }` — manual trigger |
| `POST /runs/:id/ask` `{text}` | `{ accepted }` — "message the room" |

All types come from `@aftershock/schema`. The dashboard proxies each of these
through its own origin (`app/api/...`) so no key ever reaches the browser.

### The SSE contract

Progressive reveal, not live streaming. Each `*.complete` event carries a whole
stage payload, so the UI never renders a half-built charter. `agent.update` is
the exception — Cast cards flip individually so the grid fills.

```
run.snapshot → stage.start(scout) → scout.complete
             → cast.dispatch → agent.update× → cast.complete
             → critic.complete → issue.filed×
             → sleuth.complete → understudy.complete
             → curtaincall.complete → pr.opened → run.complete
```

Emit these from the Director as stages finish and the room fills itself. The
`?speed=` parameter replays a stored run at any pace; `speed=0` is instant.

### Browserbase replay

`GET /api/replays/:sessionId` and `/:sessionId/:pageId` are **live** — they call
`bb.sessions.replays.retrieve` / `retrievePage` with the server-side key and
forward the `.m3u8` unchanged. Segment URLs inside are pre-signed CDN links, so
video streams direct to the browser and we never proxy bytes. Click **Open
replay** on any recording card.

hls.js is tried before native playback, not after. Chromium answers
`canPlayType('application/vnd.apple.mpegurl')` with a non-empty "maybe" and then
fails the load with `MEDIA_ERR_SRC_NOT_SUPPORTED`, so asking the browser first
sends every non-Safari viewer down a path that cannot work.

### The browser runtime

The second data source, and the only one reading something that actually
happened. `services/orchestrator` runs assignments through Stagehand, persists
every `AgentEvent` as sequenced JSONL next to content-addressed screenshots, and
serves them back — history as JSON, the tail as SSE, so a finished run is as
viewable as a live one.

| Endpoint | Returns |
| --- | --- |
| `GET /api/runs` | `RunSummary[]` (browser runs) |
| `GET /api/runs/:id/events` | `AgentTraceEvent[]` — the full history |
| `GET /api/runs/:id/events/stream` | `text/event-stream` of `AgentTraceEvent` |
| `GET /api/evidence/screenshots/:id` | the PNG, content-addressed and immutable |
| `GET /api/sessions/:id/replay` | replay pages for a session |

`apps/web/lib/browserRuns.ts` and `lib/useBrowserRunStream.ts` are the client,
sitting alongside `lib/api.ts` the way the two vocabularies sit alongside each
other in the schema. It runs on its own origin, so set
`NEXT_PUBLIC_ORCHESTRATOR_URL`; `pnpm demo` starts it and the dashboard together.

---

## Placeholders

Everything still standing in for real data is marked. Before the freeze:

```bash
grep -rn "PLACEHOLDER" apps/web --include='*.ts' --include='*.tsx'
```

Each marker says what the real source is and, where it matters, which schema
field is missing. The two worth fixing first:

- **`lib/derive.ts`** — the sidebar infers "the Cast re-run verified it" from a PR
  existing. A draft PR marked `aftershock:unverified` would read as verified,
  which is the one claim this product cannot get wrong. Needs
  `RunSummary.verified`.
- **`fixtures/golden-run.ts`** — delete the fixture path once `api` serves
  real runs, but move the golden run into the database rather than losing it.
  It is the DEMO_MODE replay source, and a dead network on stage should cost
  nothing.

## Running a real commit

```bash
curl -X POST localhost:3001/api/runs/from-commit \
  -H 'content-type: application/json' \
  -d '{
    "repo": "owner/repo",
    "base": "main",
    "head": "a3f9c21",
    "prNumber": 142,
    "previewUrl": "https://app-git-feat.vercel.app",
    "baseUrl": "https://app.vercel.app",
    "fallbackRoutes": ["/", "/cart"],
    "criticalJourney": {
      "description": "Buy something without using the new feature",
      "steps": ["Open the first product", "Add it to the cart", "Check out"]
    }
  }'
```

Answers `202` with a run id; follow it on `/api/runs/:id/events/stream`.

What happens: Scout reads the diff and writes a charter, the charter becomes
assignments, and the Director dispatches them against a semaphore —
differential pairs first, because they hold two slots and are worth the most.
`baseUrl: null` is allowed; differential pairs are then skipped and the run
continues on conformance alone.

Nothing is dropped silently. Anything that could not run comes back in
`skipped` with the stage that dropped it — `charter` means Scout could not
make it runnable, `dispatch` means there was no capacity, `run` means the
browser died. Those need different fixes, so they are distinguishable.

## Differential execution

The second oracle, and the only part of the pipeline that produces findings
today. It needs no charter, no GitHub and no LLM: the base branch defines
correct, so a difference nothing claimed is a regression by construction.

```bash
# a deployment against itself — must find nothing
curl -X POST localhost:3001/api/demo/canary
```

```
packages/browser/src/normalise.ts    noise rules, written before the comparator
packages/browser/src/comparator.ts   snapshot diff + four-way classification
packages/browser/src/differential.ts paired sessions, plan once, replay both
```

**Planning happens exactly once.** If each side asked a model what to click,
any difference could be model variance rather than a regression. The preview
side plans; the base side replays the Actions it produced. A journey that
already carries its Actions — a re-run, or verification against a fix —
replays on both sides concurrently instead.

**Every delta is classified and every classification is explained:**

| | |
| --- | --- |
| `match` | identical, or equal after normalisation. Not emitted. |
| `noise` | timestamps, uuids, node ids, cache-busters. Counted, never reported. |
| `claimed` | the diff said this would change. Expected. |
| `unclaimed` | nothing predicted it. **This is a regression.** |

Classification is deliberately asymmetric: a false `claimed` hides a real
regression forever, a false `unclaimed` only reaches the Critic, which has
three more gates to kill it. So `claimed` needs strong evidence and anything
ambiguous stays `unclaimed`.

### The noise canary

`POST /api/demo/canary` runs one journey against the **same URL twice**. A page
differs from itself on every load, so a healthy run reports **zero** findings.
If it reports any, the normalisation rules have a hole and every differential
finding in the product is suspect.

It is not decoration. Its first live run found twelve findings against a static
page: Stagehand numbers accessibility-tree nodes per session (`[0-17]` on one
side, `[0-62]` on the other), so two captures of an identical page disagreed on
every line. That rule now exists and is regression-tested.

Keep the canary target static — `AFTERSHOCK_CANARY_URL` defaults to
`example.com`. Point it at a site whose content changes between loads and you
are measuring the internet, not the filter.

### What it does not do yet

Sessions run in sequence on a first pass, because the Actions have to exist
before they can be replayed. Step-level lockstep — observe on preview, act on
both, compare, repeat — needs `runAssignment` restructured into a step driver.
Same browser-hours either way; twice the wall clock on a first run.

## Notes for the backend

- **`Step.digest`** is the PRD's typed visible-text digest — the thing the
  differential comparator already diffs. The dashboard reuses it to draw a
  faithful page render before screenshots upload, and to show preview and base
  side by side. Populate it from your `extract` schema.
- **`Finding.modifiers`** is shown to the user as arithmetic. Every adjustment
  needs a human-readable label; Gavel's credibility is that it shows its work.
- **`Assertion.derivedFrom`** is non-negotiable — it renders on the assertion
  list and in the issue.
- **Archetypes are `conformance | differential` only.** Adding `explorer` later
  is one line in `packages/schema/src/primitives.ts` plus a bot in the registry.

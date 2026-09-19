# Aftershock

**Autonomous QA and repair for every commit.** Your commit walks into a room full of testers, and walks out with a fix.

Full spec: [prd.md](prd.md) · Design system: [design.md](design.md)

---

## What is here

The dashboard, end to end, plus the shared schema every service will import.
The pipeline services are stubs with their contracts written down.

```
apps/web              the room — Next.js 15, Tailwind 4, SSE, hls.js
packages/schema       Zod schemas shared by every service
services/api          webhook receiver, run API, GitHub integration   (stub)
services/orchestrator the Director — stage machine, semaphore, dispatch (stub)
design/               the Claude Design source the UI is built from
```

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

A run is a thread every bot is in. Eight bots, one per pipeline stage:

| Bot | Stage | Job |
| --- | --- | --- |
| Maestro | Director | runs the room, writes to GitHub |
| Diffany | Scout | turns the diff into claims |
| QAizen | Cast · conformance | checks a claim start to finish |
| Doppler | Cast · differential | runs your branch against main |
| Gavel | Critic | the only one allowed to file |
| Clueso | Sleuth | reads the log, then the code |
| Patchouli | Understudy | writes the smallest patch |
| Encore | Curtain Call | re-runs the same browsers |

The Claude Design source draws eleven. Havoc (adversary), Wanda (explorer) and
Nitpick were cut in the PRD's own pre-agreed cut order — see [design.md](design.md#the-cast).

Two views, toggled by the monitor icon in the run header:

- **Room** — the thread, with evidence posted as attachments.
- **Browsers** — every session at once. Failing agents stay expanded, passing
  agents collapse, differential pairs span two columns and show both sides.

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
Patch / Verification -> Patchouli's diff, Encore's before-and-after
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

---

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

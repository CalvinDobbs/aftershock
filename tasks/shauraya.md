# Shauraya — the stage and the surface

**Your half of the product: the thing being tested, the service that receives
commits, and the dashboard that has to be right.** Meridian does not exist yet
and it blocks every real rehearsal, so it is first and it is yours alone.

Board: <https://claude.ai/artifact/TkyxdAg4wZjtuFHKvgbVwe> · Spec: [prd.md](../prd.md) — the demo, triggers, frontend

---

## What you own

Nobody else edits these. Work freely.

```
meridian/                                     new repo — the demo target
services/api/                                 webhooks and the run API
services/orchestrator/src/*event-repository*  persistence only
apps/web/                                     the whole dashboard
packages/schema/src/run.ts                    Run, RunSummary, RunDetail inputs
```

**Do not edit:** `packages/schema/src/{finding,events,browser,primitives}.ts`,
`packages/browser/`, `packages/critic/` or `commit-run.ts` (Anirudh);
`packages/schema/src/repair.ts`, `packages/scout/src/github.ts` or the repair
packages (Calvin).

---

## The contracts

Agreed up front so three people can build at once. These are in all three task
files; if one changes, it changes in all three.

```ts
// Anirudh builds these.
judge(input: { runId, charter, conformance, differential }): Promise<Finding[]>
authorIssue(finding: Finding): Promise<IssueDraft> // unpublished; Director adds GitHub number/url

// Calvin builds these.
// Built, on branch calvin/repair-chain. Every stage takes (input, deps):
// deps is how the model and the browser stack get injected, and how the
// tests avoid needing either.

diagnose(input: { issue, intent, route?, evidence?, hypothesesLimit? },
         deps:  { model }): Promise<Diagnosis>

// One call drives the whole repair chain, including the PRD's retry policy.
// This is the one the stage machine wants.
repair(input: { issue, diagnosis, intent, workingDirectory, runId, maxAttempts? },
       deps:  { codex, verify, readDiff? }): Promise<RepairOutcome>

// Pushes the branch and opens the PR — draft and labelled unverified when
// repair() could not verify it. Returns { pullRequest: null, reason } when no
// attempt produced a diff, so an empty PR is never opened.
publishPatch(input: { outcome, issue, repo, baseBranch, headSha, workingDirectory, runId },
             deps:  { github, readFiles? }): Promise<{ pullRequest, commitSha } | { pullRequest: null, reason }>

// Underneath repair(), if a stage ever needs them on their own:
writePatch(input: { ...repair's, attempt, resumeThreadId?, previousFailure? },
           deps:  { codex, readDiff? }): Promise<Patch>
verify(input: { patch, issue, failed, fixUrl, baseUrl, route, runId, regressionSuite? },
       deps:  { runAssignment, runDifferential, screenshotUrlFor? }): Promise<Verification>
```

Your `services/api` converges every trigger on one `createRun()`, which hands
off to Anirudh's `runFromCommit`. That is the only seam between you.

---

## 1. Build Meridian and plant the bugs — **start here**

The demo target **does not exist** — not in this repo and not referenced
anywhere in it. Nothing downstream can be rehearsed end to end until it does,
which makes it the longest pole on the board.

A small, realistic storefront on Next.js and Vercel: product listing, product
detail, cart, checkout, order confirmation. Six to eight screens, seeded data,
no login. Real-looking copy and photography — **it must not look like a
hackathon toy**, because a judge's confidence in the QA tool is bounded by their
confidence in the thing it is testing.

### The two planted bugs

**The headline bug** — a dependency-array miss in a `useMemo` on the coupon
feature. Three properties, all required:

1. *Plausible.* Every React developer has shipped this.
2. *Invisible to CI.* It typecheck-passes, lint-passes, build-passes.
3. *Only findable by using the app.* No static analysis catches it — you have to
   click Apply and read the total.

The commit message honestly describes the intended feature. That is what Scout
reads, and the gap between the claim and the behaviour is the whole product.

**The second bug** — smaller, on an unrelated route: a shared `formatPrice`
change that breaks the cart subtotal. This one exists so the **differential**
agent catches something conformance cannot, and it is the finding worth pausing
on during the demo.

**Done when** a preview and a base deployment are both live, and the second bug
is caught by a differential pair rather than by an assertion.

---

## 2. Build `services/api`

Twenty lines that log *"not implemented yet"*. It needs the five endpoints the
dashboard already calls — the contract is written at the top of
`services/api/src/index.ts` and `apps/web/lib/api.ts` is the only consumer:

```
GET  /runs                 -> RunSummary[]
GET  /runs/:id             -> RunDetail
GET  /runs/:id/events      -> text/event-stream of RunEvent
POST /runs   {repo, sha}   -> { runId }
POST /runs/:id/ask {text}  -> { accepted }
```

Plus `POST /webhooks/github` handling `push`, `pull_request` and
`deployment_status`, **all converging on one `createRun()`**. Register as a
GitHub App, not a personal token — Calvin is registering one for the write path,
so take the app id and private key from him rather than making a second.

Base URL resolution matters: `baseUrl: null` is legal and skips differential
pairs rather than failing the run.

**Done when** a `git push` to the demo repo starts a run with no curl involved.
That push is the demo's opening shot.

---

## 3. Move persistence off the filesystem

Runs are JSONL files beside content-addressed screenshots. It works and it is
genuinely replayable, but the PRD's data model assumes Postgres and the golden
run needs to live in the database rather than in a TypeScript fixture.

`EventRepository` is already an interface in `event-stream.ts`, so this is
additive: write `PostgresEventRepository` alongside `JsonlEventRepository`, do
not modify the JSONL one.

> **The one overlap on the board.** The repository is constructed in
> `runtime.ts`, which Anirudh owns. Ask him to make it injectable first — one
> line — then you never touch that file.

**Done when** a finished run survives a restart on a different machine and
replays at any speed.

---

## 4. Move the golden run into the database

Delete the fixture path once `api` serves real runs — but **keep the golden
run.** It is the `DEMO_MODE` replay source and the PRD's demo-safety fallback: a
dead network on stage should cost nothing.

**Done when** `DEMO_MODE` replays it from the database with the network
unplugged.

---

## 5. Add `RunSummary.verified`

The sidebar infers *"the Cast re-ran and verified it"* from **a PR simply
existing**. A draft PR labelled `aftershock:unverified` — which the PRD's own
retry policy opens after two failed patch attempts — would render as verified.

This is the one claim the product cannot get wrong, and Calvin's Understudy will
start producing exactly those drafts.

Add the field to `run.ts` (yours), set it from Curtain Call's result, and delete
the `PLACEHOLDER` in `apps/web/lib/derive.ts`.

**Done when** an unverified draft PR renders as unverified.

---

## 6. Test the transcript projection

`apps/web` has **no test script at all.** `lib/room.ts` is 496 lines turning
pipeline artefacts into the conversation every judge will read — the highest
leverage untested file in the repo. If the projection is wrong, the demo is
wrong in the most visible possible way.

Cover three shapes: a run with findings, a run with none, and a run that failed
mid-stage.

Separately, every package `tsconfig.json` carries `"exclude": ["src/**/*.test.ts"]`,
so **test files are never typechecked** anywhere in the workspace. Worth fixing
while you are in here.

> Note for whoever runs `pnpm check` next: `packages/scout/node_modules` was
> empty on my pass and three suites failed to resolve their imports. `pnpm
> install` fixed it and the lockfile did not change — but if checks fail
> strangely, run install before debugging.

**Done when** `pnpm --filter @aftershock/web test` exists and passes.

---

## Also yours

**Record the backup video** — a full successful run, by hour 30. The PRD calls
it non-negotiable insurance and it is the cheapest item on the whole board. You
own it because you own the demo surface.

---

## If you fall behind

Cut **Postgres** and stay on JSONL. It already persists, already replays, and
already survives a restart on the same machine; the golden run can stay a
fixture. Nothing in the demo script depends on the database being Postgres.

Do not cut Meridian, `services/api`, or `verified`. Meridian is the demo,
`services/api` is the opening shot, and `verified` is the one thing that would
make the product lie on stage.

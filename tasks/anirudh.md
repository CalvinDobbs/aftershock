# Anirudh — judgment and the Director

## Working checklist and handoff

**Latest status:** Anirudh implementation is ready for integration. All 441 tests
and typechecks pass. Final live acceptance `run-1789850852902-0` confirms both main
Meridian bugs and the real dashboard renders them. Live GitHub issue/repair/PR
publication has NOT been exercised; it remains opt-in deployment configuration.
See the final handoff at the end of this file for exact commands and team seams.

Branch: `codex/anirudh-critic-director` (started from `5e68795`). Never push to main.
Update this section after each major implementation change. This file is the
handoff source for the next agent; the original brief remains below.

- [x] Read the repo, PRD, design, tests, and all three ownership briefs.
- [x] Create the dedicated branch and correct Anirudh's spelling in task docs.
- [x] Fix the default canary journey and run it three times against Browserbase.
- [x] Implement initial Critic clustering, confidence gates, reproduction, and issue authoring.
      Live differential verified; conformance evaluation/base-check integration remains below.
- [x] Emit pipeline events from the Director and expose an injectable event sink
      for Shauraya's API/persistence work.
- [x] Wire Calvin's real repair functions, retry/verification, publication and runtime configuration.
      Live writes require the publishing environment described below.
- [x] Run focused tests, `pnpm check`, and real demo tests; record commands/results.
- [x] Grade conformance assertions and connect real base checks to pre-existing rejection.
- [x] Resolve evidence-backed route confidence and rerun the two main demo bugs.

Scope: comparator/canary, Critic, and Director. Leave sidebar, budget tuning,
session reapers, web/API implementation, and repair packages to their owners.
Calvin/Shauraya task docs changed only for spelling and the agreed issue-draft return contract.

Starting state: Scout + browser execution exist; the product room is a fixture.
Conformance currently captures evidence without evaluating assertions. The runtime
uses browser telemetry, not pipeline `RunEvent`. The GitHub write path and repair
packages do not exist yet. Do not claim the complete repair loop works.

Baseline: `pnpm check` passed on `5e68795` (147 tests). Node 22.23.2,
pnpm 10.17.1. Browserbase key is in ignored local env files; never copy it here.
Demo target supplied: `Nikhil-Doal/demo_site`, production
`https://demo-site-hazel-beta.vercel.app/`, buggy branch `feat/coupon-codes`
(head `38c987c`). Discover its exact preview via Vercel deployments; do not
compare production against itself and call that a bug test. Vercel/OpenAI keys
are configured in ignored `.env`. Demo repo read-only clone:
`/private/tmp/aftershock-meridian-review`. The current coupon bug is unlifted
state (CouponInput callback not connected), NOT a missing useMemo dependency.

### Implementation checkpoint 1

- Default canary now uses `Open /`, staying on example.com instead of navigating
  to IANA. No role-equivalence rule added; role changes remain detectable.
- Added `noise-canary.ts`, unit tests, and `canary-smoke.ts` under orchestrator.
- Live command: `node --env-file=.env --import tsx services/orchestrator/src/canary-smoke.ts`.
  All THREE runs passed, zero findings, two completed sessions with captured steps
  each. Run IDs: `canary-smoke-1789846266507-1`, `canary-smoke-1789846274987-2`,
  `canary-smoke-1789846282919-3`. Evidence: `.aftershock/traces` + screenshots.

### Implementation checkpoint 2 (tested)

- New `@aftershock/critic`: `judge`, `selectIssues`, `authorIssue`.
- Unit tests cover confidence, reproduction, flakes, pre-existing failures,
  third-run band, grouping, route context, and unpublished issue drafts.
- `authorIssue` returns `IssueDraft` (no fake GitHub number/url). The Director
  must turn that into `Issue` after Calvin's write function returns. This refines
  the original aspirational contract below; no GitHub writes exist yet.
- Differential results now optionally carry a complete `recordedAssignment`
  and `completed` so Critic can replay without planning or treating a failed
  browser as a successful clean reproduction.
- Director integration emits Scout/Cast/Critic stage events through optional
  `emitPipelineEvent`. Runtime accepts `eventRepository`,
  `emitPipelineEvent(runId, event)`, and `onCommitRunComplete(runId, outcome)`.
  Shauraya can wire these without editing runtime. Full run snapshots and cast
  assignment projections are now implemented (see Director checkpoint below);
  repair integration remains pending.
- Integration tests and live differential reproduction passed. Full lane completion
  still requires conformance evaluation, the room bridge, filing, and repair wiring.

---

**Your half of the product: deciding what is real, and driving the stages.**
The Critic is the answer to the question every judge asks — *what stops this
filing five bogus issues per PR?* — and the stage machine is what makes the
dashboard show a real run instead of a fixture.

Board: <https://claude.ai/artifact/TkyxdAg4wZjtuFHKvgbVwe> · Spec: [prd.md](../prd.md) stage 3 + the confidence model

---

## What you own

Nobody else edits these. Work freely.

```
packages/critic/                              new
packages/browser/                             normalise, comparator, differential
packages/schema/src/finding.ts                Finding, FindingClass, Delta, modifiers
packages/schema/src/events.ts                 RunEvent, RunDetail
packages/schema/src/browser.ts                RawFinding, AgentEvent
packages/schema/src/primitives.ts             Stage, Archetype, Severity
services/orchestrator/src/commit-run.ts       the stage machine
services/orchestrator/src/index.ts
services/orchestrator/src/runtime.ts
```

**Do not edit:** `packages/schema/src/repair.ts`, `packages/scout/src/github.ts`
or the three new repair packages (Calvin); `apps/web/`, `services/api/`,
`packages/schema/src/run.ts` or the event repositories (Shauraya).

---

## The contracts

Agreed up front so three people can build at once. These are in all three task
files; if one changes, it changes in all three.

```ts
// You build these. Calvin and Shauraya consume them.
judge(input: { runId, charter, conformance, differential }): Promise<Finding[]>
authorIssue(finding: Finding): Promise<IssueDraft> // unpublished; Director adds GitHub number/url

// Calvin builds these. You call them from the stage machine.
diagnose(input: { issue, intent, hypothesesLimit? }): Promise<Diagnosis>
writePatch(input: { issue, diagnosis, intent, attempt, resumeThreadId? }): Promise<Patch>
verify(input: { patch, issue, failedAssignments, baseUrl }): Promise<Verification>
```

You own the wiring in `commit-run.ts`. Calvin never edits that file — he exports
the three functions above and you call them.

---

## 1. Close the hole the noise canary found — **do this first**

`POST /api/demo/canary` raises **2 findings against a page compared with
itself**, deterministically, on both runs I tried. Your own README says this
makes every differential finding suspect — and differential is currently the
only oracle producing findings at all, so this quietly invalidates the second
oracle the whole pitch rests on.

What is happening: the node-id rule works fine — 60 of 63 deltas are correctly
filtered as noise. But Chromium exposes one node as `LayoutTableRow` in one
capture and `listitem` in the other. That single role flip misaligns the tree
diff and cascades into 3 unclaimed deltas:

```
base "LayoutTableRow"  preview "listitem"
base "listitem"        preview "—"
base "—"               preview "LayoutTableRow"
```

The default canary step clicks "More information" and navigates off
`example.com` onto `iana.org/help/example-domains`, whose footer is a
table-ish layout — so you are measuring a page you do not control.

**Two candidate fixes, and they are not equivalent.** Pinning the canary to a
static page you control is the safe one. Adding a role-equivalence rule to
`normalise.ts` is the risky one — over-normalising erases real regressions, and
the comparator's asymmetry exists precisely because a false `claimed` hides a
bug forever. Prefer the first; if you add a rule, make it narrow and named.

**Done when** the canary reports zero findings on three consecutive runs and the
fix is covered in `normalise.test.ts`.

---

## 2. Bridge the two vocabularies

**Nothing in the backend ever emits a pipeline `RunEvent`.** The orchestrator
emits `AgentEvent` (browser telemetry); the dashboard's run view consumes
`RunEvent` (pipeline). The only producer today is `apps/web/lib/replay.ts`,
paging the fixture.

This is the structural gap on the board: you could finish all four remaining
stages and the dashboard would still show fixtures. It is also half of the
Critic's job — turning a `RawFinding` into a `Finding` is exactly what Gate 1
does — so build the two together rather than as separate pieces.

`RawFinding` carries `class`, `severity`, `signature`, `summary`, `stepIndex`,
`evidence`. `Finding` needs all of that plus `runId`, `assignmentIds`, `status`,
`title`, `route`, `expected`, `expectedSource`, `actual`, `baseConfidence`,
`confidence`, `modifiers`, `reproCount`, `reproAttempts`, `repro`, `filed`.
Everything in that second list is something the Critic computes.

**Done when** a live commit run drives the room with `AFTERSHOCK_API_URL` set,
and the fixture path is only a fallback.

---

## 3. Stage 3 — the Critic

The only agent allowed to declare something is a bug, and the only one whose
output reaches GitHub. Seven steps: **collect, normalise, cluster, score, rank,
author, file.**

Cluster by route plus normalised failure signature — one issue per root
behaviour, not per failing assertion. `packages/browser/src/normalise.ts` is
already the right tool for the signature stripping.

### Gate 1 — classification

| Class | Base | Reproduction |
| --- | --- | --- |
| `hard_failure` | 0.90 | not required |
| `unclaimed_delta` | 0.75 | required |
| `assertion_violation` | 0.65 | required |

### Gate 2 — reproduction

Re-run in a fresh Browserbase session with the **same deterministic `Action`
sequence** — reuse `withRecordedActions` and `isReplayable` rather than
re-planning, or you are testing a different thing than the one that failed.

- reproduces → `×1.15`
- fails to reproduce → `×0.30`, marked `flaky`, never filed
- reproduces with a different failure mode → `×0.60`, flagged for human review

A third run fires only when confidence lands in `0.55–0.70` after two, since
that is where the extra browser minute buys the most information.

### Gate 3 — corroboration and threshold

- multiple agents independently hit it → `+0.10` each, capped `+0.20`
- Scout's route confidence is low → `−0.15`
- finding is on a route the diff never touched → `−0.20`
- **same behaviour present on base → killed outright.** Not a regression.

**Threshold 0.70.** Below it the finding shows in the dashboard as
`low_confidence` and nothing is written to GitHub. **Maximum three issues per
run**; if more survive, file the three highest-severity and summarise the rest
in one comment.

Every modifier applied must carry a human-readable label — the dashboard renders
`Finding.modifiers` as visible arithmetic, and Gavel's entire credibility is
that it shows its work.

**Done when** the two planted Meridian bugs survive all three gates with their
arithmetic shown, and a deliberately flaky finding is discarded as
`low_confidence`.

> Filing needs `createIssue` from Calvin's GitHub write path. He is doing it
> first for exactly this reason — until it lands, have `authorIssue` return the
> rendered body and let the Director do the write.

---

## 4. Wire the stage machine

`runFromCommit` stops after the Cast. Your own module comment in
`services/orchestrator/src/index.ts` already admits it: the stage machine and
the per-stage `RunEvent` emission are "still to land".

Wire stages 3–6 in order, emitting one event per stage completion so the
dashboard's progressive reveal is real rather than replayed:

```
run.snapshot → stage.start(scout) → scout.complete
             → cast.dispatch → agent.update× → cast.complete
             → critic.complete → issue.filed×
             → sleuth.complete → understudy.complete
             → curtaincall.complete → pr.opened → run.complete
```

Keep the existing degradation discipline: nothing is dropped silently, and
`skipped` keeps naming the stage that dropped the work, because a charter
problem, a capacity problem and a dead browser need different fixes.

**Done when** one commit produces that full sequence live.

> Calvin's Understudy runs a full Codex agent loop — minutes, not seconds. Do
> not block the run on it, and make sure the stage emits `stage.start` before it
> begins or the room will look frozen.

---

## Known overlap

Shauraya's Postgres work swaps the repository constructed in `runtime.ts` —
one line, in a file you own. Easiest fix: make the repository injectable early,
tell him the signature, and he never touches the file.

## Live Meridian investigation

Preview verified through Vercel: `https://demo-site-36dnpbk4c-doalnikhilgmailcoms-projects.vercel.app`
(commit `38c987cc2b85f8e7571f6465769658dfeff6ecae`, PR #2). Production
`https://demo-site-hazel-beta.vercel.app` maps to main `6cff32d`. Both are public.
Manually confirmed preview cart `$NaN` and SAVE20 success with unchanged `$84.00`.

First live baseline-only shopping run (`meridian-smoke-1789846923328`) found
nine false changes: fuzzy matching paired option 2 with option 10 when node IDs
changed. Fix: reserve exact normalized tree-line matches before fuzzy matching,
and exclude node IDs from similarity scoring. New tests retain detection of
missing options and real `$84.00` → `$NaN` changes. No blanket number/role filter.
Rerunning `node --env-file=.env --import tsx services/orchestrator/src/meridian-smoke.ts`.
This script tests clean shopping, buggy shopping, and Critic reproduction; saves
JSON findings and draft issue bodies under `.aftershock/<runId>/`.

## Verified handoff — 2026-09-19

Current implementation is a tested FIRST CHECKPOINT, not the complete repair loop.

### Commands and results

- `pnpm check`: all package typechecks and 176 tests pass. Critic's own test
  files are also included in its typecheck. Existing other-package test
  exclusion conventions were not changed.
- `node --env-file=.env --import tsx services/orchestrator/src/canary-smoke.ts`:
  three live same-page comparisons passed (six actual Browserbase sessions).
- `node --env-file=.env --import tsx services/orchestrator/src/meridian-smoke.ts`:
  final run `meridian-smoke-1789847220772` passed. Clean shopping compared with
  itself: zero findings. Buggy branch: exactly one confirmed finding, cart
  `$84.00` → `$NaN`, confidence `0.8625`, reproduced 2/2 completed attempts.
  This script uses an explicit test charter to exercise the comparator/Critic;
  it does NOT prove Scout or the room works end to end.
- Full findings and rendered unpublished issue:
  `.aftershock/meridian-smoke-1789847220772/`.
  Raw traces are hashed filenames in `.aftershock/traces/`; screenshots in
  `.aftershock/screenshots/`. These are ignored artifacts, not committed files.
- The live test also caught an anonymous-image false positive: node IDs had
  prevented the existing anonymous-node rule matching. Fixed and regression-tested;
  named images still count as differences. Vercel toolbar frame warnings can
  appear in Stagehand logs while captures and sessions complete successfully.

### Integration contracts for the other agents

- `@aftershock/critic` exports `judge(input, options?)`, `selectIssues(findings)`,
  `authorIssue(finding)`, and `IssueDraft`. Judge input keeps the agreed four
  fields (`runId`, `charter`, `conformance`, `differential`), with optional resolved
  `assignments`. The optional `reproduce` callback returns observed raw findings;
  errors/unavailable replay leave the finding unconfirmed. Different actual
  failure summaries must NOT count as reproducing the same failure.
- `runFromCommit` invokes Critic using recorded Actions. It returns `findings`
  and up to three `issueDrafts` alongside its original outcome fields.
- No issues/PRs are published. `filed` remains false. Calvin's GitHub adapter
  must supply the real issue number and URL before constructing `Issue` and
  emitting `issue.filed`. `IssueDraft` intentionally cannot claim publication.
- Shauraya can pass `eventRepository`, `emitPipelineEvent(runId, event)`, and
  `onCommitRunComplete(runId, outcome)` into `createObservabilityRuntime`.
  `runFromCommit` takes `emitPipelineEvent(event)` directly. No web/API or
  event-repository implementation files were edited.
- Product events now include `run.snapshot`, `cast.dispatch`, `agent.update`,
  `run.complete`, Scout/Cast/Critic stages, explicit repair-stage skips, and
  `run.failed`. Outcomes include validated `detail: RunDetail`. Browser telemetry
  carries explicit base/preview side so concurrent evidence is paired correctly.
  The existing dashboard still uses its fixture; Shauraya must connect callbacks
  to persistence/SSE. No competing API or persistence layer was added.
- `DifferentialResult` now optionally includes `recordedAssignment` (only a
  complete captured journey) and `completed`. Old records still parse. `Finding`
  optionally retains raw `evidence` strings for issue authoring.

### Next steps, in order

1. Connect the completed product projection callbacks with Shauraya's run API.
   `onCommitRunComplete` receives `outcome.detail`; `emitPipelineEvent` receives
   validated room events. `runFromCommit` optionally accepts `commitMetadata`
   and `screenshotUrl`; unknown authors stay explicitly unknown.
2. Implement conformance assertion evaluation in the browser package. The user
   confirmed the coupon bug manually, but the harness still captures without
   grading it. Then wire actual base observations into the Critic's pre-existing
   kill path (currently supported/tested through the reproduction callback).
3. Connect Calvin's real GitHub filing + diagnose/writePatch/verify exports when
   they exist. No fake stubs that claim success; finish the seven-stage flow.
4. Re-run both Meridian planted bugs through the real commit-run endpoint, then
   verify they appear in the room once Shauraya's API is connected.

User preferences: practical implementation, test real behavior on the demo,
keep this handoff current after major changes, all work on separate branches,
no direct main pushes. Do not spend this lane on sidebar or budget/reaper work.

Unrelated untracked `Meridian prd.md` appeared during this session; it belongs
 to the user's work and is intentionally excluded from the checkpoint commit.


### Director projection checkpoint (September 19)

- Added `pipeline-projection.ts` and five focused tests; Director now returns
  schema-valid room details with real sessions, action timings, paired screenshots,
  network/console evidence, terminal assignment states, and stage timestamps.
- Queued events are cloned so later updates cannot rewrite dispatch history.
- Conformance capture without an evaluator is `skipped`, never `passed`.
  Missing base/incomplete comparisons remain visible coverage gaps. Unconnected
  repair stages explicitly skip; no issue numbers, repairs, or success are invented.
- `pnpm check` passed all typechecks and 182 tests before the final missing-base
  event cleanup. Focused checks will be repeated for that cleanup.
- New `director-smoke.ts` exercises the actual HTTP commit-run endpoint, GitHub
  Scout, Browserbase, Critic, and product projections. The first live run completed
  the pipeline but the script expected the wrong response envelope (`runId` instead
  of `run.runId`); corrected and rerunning. Artifacts are ignored under `.aftershock`.
- Final live endpoint test passed: `run-1789848634511-0`, 23 product events,
  actual paired evidence in `detail.json` and `pipeline-events.json` under
  `.aftershock/run-1789848634511-0/`. Cart `$84.00` -> `$NaN` reproduced 2/2.
  The real Scout run classifies it LOW CONFIDENCE (0.5125): route confidence
  penalty -0.15 and fallback/not-traced penalty -0.20. Do not lower thresholds
  or claim a confirmed end-to-end result; improve evidence-backed route mapping.
- A1/A2 completed browser journeys but remain skipped without assertion grading.
  A3/A4 errored because their generated journeys request a nonexistent Remove
  coupon button. Keep this distinction visible when implementing conformance.
- Focused final orchestrator typecheck and all 54 tests passed after missing-base
  cleanup. No main pushes, external issue filing, or demo repo changes.
- Next implementation priorities: conformance evaluator and evidence-backed route
  mapping; dashboard persistence/SSE remains Shauraya's integration seam.


### Handoff readiness

Implementation commits `d57ee56` and `675c780` are on
`codex/anirudh-critic-director`. Calvin and Shauraya can integrate the exported
contracts now. Remaining Anirudh work: conformance/base grading, route-evidence
confidence, Director wiring to Calvin's real filing/repair exports, then a full
live run through Shauraya's room. Core Critic/comparator/events are tested;
the full demo-to-repair loop is not complete. Local ignored artifacts and secrets
are not included in Git; teammates must configure their own environment.

### Final implementation pass

Merged teammates main work; implementing conformance grading, import evidence, real repair wiring and the Director product API consumed by Shauraya. Final checks/live run pending.

### Final pass implementation checkpoint

- Merged main at `e745c68` into this feature branch, preserving teammate code.
- Added evidence-cited conformance grading, baseline checks during reproduction,
  exact input targeting and read-only journey captures. Live testing exposed
  wrapper clicks that never typed coupon codes; input actions now resolve one
  editable control and deliver native input/change events.
- Added source-backed import tracing (including declared tsconfig aliases) from
  changed shared modules to untouched pages. Live cart finding now confirms at
  0.8625 without weakening confidence gates.
- Director calls Calvin's real diagnose/repair/verify/publish exports. Deployment
  and isolated checkout are supplied through `RepairServices`; missing adapters
  remain explicit skips. Tests exercise success, two-failure draft, missing
  baseline, and unconfigured services without writing external issues.
- Product events are durable in `.aftershock/pipeline`; Director serves room
  read endpoints `/runs`, `/runs/:id`, `/runs/:id/events` and product events on
  `/api/runs/:id/events/stream` for Shauraya's proxy. Browser telemetry remains
  available for legacy demos/canaries. No teammate implementation files edited.
- Final live conformance and room checks still in progress.


## Final implementation handoff — September 19

### Verified

- `pnpm check`: all typechecks, **441 tests** pass (70 orchestrator tests).
- `AFTERSHOCK_EVIDENCE_ORIGIN=http://127.0.0.1:3003 node --env-file=.env --import tsx services/orchestrator/src/director-smoke.ts`
  passed for **run-1789850852902-0**. This uses the actual HTTP trigger, Git commit
  read, Scout model, remote Browserbase sessions, conformance grader, differential
  comparator, Critic reproduction, durable product detail and replayable SSE.
- Exactly two confirmed findings: cart `$84.00` -> `$NaN` at **0.8625**, coupon
  summary/total not reflecting SAVE20 at **0.7475**, both observed 2/2.
- Browser UI verified using an isolated unchanged copy of `apps/web` with
  `AFTERSHOCK_API_URL=http://127.0.0.1:3003`. Room:
  `http://localhost:3004/runs/run-1789850852902-0`. Screenshot fallback images load.
  Servers currently retained: Director 3003; isolated dashboard 3004. Existing
  user app on 3000 was not replaced. Temporary dashboard: `/tmp/aftershock-room-preview`.
- Evidence and detail: `.aftershock/run-1789850852902-0/`; durable events:
  `.aftershock/pipeline/`. These are ignored local artifacts, not Git contents.
- Some additional Scout assertions remain inconclusive; partial coverage is
  recorded, not silently promoted to passed. The two required demo findings pass.

### What changed in this pass

- Real conformance grading cites validated numbered lines in captured browser
  evidence; model outages/invalid evidence return inconclusive. Read/check steps
  capture without clicking. Input actions resolve one editable control and type
  the requested value rather than accidentally clicking its parent wrapper.
- Reproduction uses recorded Actions and compares observed failure evidence.
  The baseline is actually exercised for conformance pre-existing rejection.
- Shared-module import tracing uses captured source and configured aliases;
  confidence gates are unchanged. REST failures fall back to read-only Git
  transport for both commit intent and source. The fallback uses the merge-base
  diff and real commit messages; it does not invent unavailable PR body text.
- Calvin's actual diagnose/repair/verify/publish functions are connected. One
  highest-ranked filed issue is repaired because RunDetail represents one repair;
  up to three confirmed issues can be filed. Two failures produce an unverified
  draft. Missing baseline, incomplete replay, and inconclusive grading cannot verify.
- Isolated repair checkout creation and preview-command execution are built into
  `repairServicesFromEnv`. No teammate-owned implementation files were modified.

### Enabling live publication (configuration, not yet live-tested)

`start.ts` enables repair only with BOTH `GITHUB_TOKEN` and
`AFTERSHOCK_PREVIEW_COMMAND`. The command is a JSON argv array, runs in the actual
patched checkout, must deploy those files, wait for readiness, and print its
public HTTPS URL on its last stdout line. Existing env (including deployment
credentials) is inherited. The command receives `AFTERSHOCK_PATCH_BRANCH`,
`AFTERSHOCK_PATCH_ATTEMPT`, and `AFTERSHOCK_SOURCE_SHA`. The checkout is separate
from this repo and is pinned to the tested commit. Set
`AFTERSHOCK_REPAIR_BASE_BRANCH` for SHA-based triggers so the fix PR targets the
actual feature branch. Never substitute the production baseline as the fix URL.

Alternatively inject `RepairServices` into `createObservabilityRuntime` for the
team's hosting adapter. The chain is tested using the real Calvin functions with
controlled external dependencies, including retries and draft publication.
No external demo issues or PRs were filed during these tests. Credentials stay in
ignored env files; teammates need their own environment configuration.

### Shauraya integration notes

- Product reads: Director `GET /runs`, `/runs/:id` (validated RunDetail),
  `/runs/:id/events`; alias `/api/runs/:id/detail`.
- His existing event proxy to `/api/runs/:id/events/stream` now receives actual
  RunEvents for commit runs. Legacy canary/demo streams keep AgentTraceEvents.
- His `/runs/:id` route still returns the API RunRecord, not RunDetail. Proxy it
  to the Director using `orchestratorRunId`, and materialize summaries if keeping
  the API service as the dashboard origin. Direct Director reads already work.
- UI issues observed in existing web code: confirmed count is labelled “filed”
  despite `issues=[]`, and skipped assignments render as queued. The backend
  accurately reports `filed:false`, skipped status and the reason. Do not use the
  UI wording as proof of GitHub publication. Closed-session video was unavailable
  in this keyless isolated frontend; real screenshot fallback evidence worked.

Unrelated `Meridian prd.md` remains untracked and excluded. All implementation is
on `codex/anirudh-critic-director`; never push main.

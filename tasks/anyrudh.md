# Anyrudh — judgment and the Director

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
authorIssue(finding: Finding): Promise<Issue>

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

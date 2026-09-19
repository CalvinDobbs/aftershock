# Calvin — the repair chain

**Your half of the product: everything that happens after a bug is confirmed.**
Sleuth localises it, Understudy patches it with Codex, Curtain Call proves the
patch works. Plus the GitHub write path, because both you and Anyrudh need it
and it sits in a file nobody else is touching.

Board: <https://claude.ai/artifact/TkyxdAg4wZjtuFHKvgbVwe> · Spec: [prd.md](../prd.md) stages 4–6

> **Status: all four built on `calvin/repair-chain`.** 86 new tests across the
> three new packages plus the GitHub write path. What is *not* done is a live
> run: no stage has met a real Codex process, a real browser or a real repo,
> because each one is reached through an injected dependency that the tests
> substitute. The wiring in `commit-run.ts` is Anyrudh's.

---

## What you own

Nobody else edits these. Work freely.

```
packages/sleuth/                    new
packages/understudy/                new
packages/curtain-call/              new
packages/scout/src/github.ts        the write path
packages/schema/src/repair.ts       Diagnosis, Patch, Verification, PullRequest
```

**Do not edit:** `packages/schema/src/{finding,events,browser,primitives}.ts` or
anything under `services/orchestrator/` (Anyrudh), `apps/web/` or
`services/api/` (Shauraya).

---

## The contracts

Agreed up front so three people can build at once. These are in all three task
files; if one changes, it changes in all three.

```ts
// Anyrudh builds these. You consume them.
judge(input: { runId, charter, conformance, differential }): Promise<Finding[]>
authorIssue(finding: Finding): Promise<Issue>

// You build these. Anyrudh calls them from the stage machine.
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

Export each from the package index. Anyrudh wires them into `commit-run.ts` —
you never edit that file.

---

## 1. GitHub write path

`GitHubClient` can only `readIntent` today: compare commits, read a PR body.
There is **no create-issue, create-branch, commit or open-PR call anywhere in
the repo.** This blocks Anyrudh's Critic as well as your PR, so do it first —
it is the cheapest unblock on the board.

Add, keeping the existing hand-rolled `fetch` + Zod style rather than pulling in
Octokit:

- `createIssue({ repo, title, body, labels })`
- `createBranch({ repo, from, name })`
- `commitFiles({ repo, branch, message, files })`
- `openPullRequest({ repo, head, base, title, body, labels, draft })`
- `setCommitStatus({ repo, sha, state, description })`

Register the GitHub App rather than using a personal token — PRD
[Triggers](../prd.md). Shauraya needs the same app for webhooks, so agree the
app id and private key in `.env.example` with him once and move on.

**Done when** a real issue exists on the demo repo, rendered from the PRD's
template, with screenshots, reproduction steps, the confidence line and the
`derivedFrom` citation back to the PR description.

---

## 2. Stage 4 — Sleuth

Turns a behavioural report into a code location. Separate from Understudy on
purpose: diagnosis and repair are different skills, and merging them produces
patches that fix the symptom.

**The prime suspect heuristic.** The diff is a ranked prior, not just context.
Search in this order and stop as soon as a hypothesis explains the behaviour:

1. Lines added or modified in this commit on the affected route
2. Modules those lines import
3. Modules that import the changed files — the regression surface
4. The wider repository

**Reason from evidence to code, not code outward.** The network capture is often
decisive on its own: in the worked example `POST /api/coupon/validate` returns
200 with a valid discount and no recalculation request follows, which localises
the bug to client state before any file is read. `packages/browser/src/instrument.ts`
already collects network and console — use it.

`Diagnosis.inconclusive` already exists in the schema. Use it. Reporting "I
cannot find this" is a feature; inventing a plausible file is the failure mode
that makes the whole stage untrustworthy.

**Done when** it localises the planted `useMemo` bug to the right file and line
range, and returns `inconclusive: true` on a bug it cannot explain.

---

## 3. Stage 5 — Understudy, on the Codex SDK

Wrap Codex; do not reimplement a coding agent. **Codex as a runtime component of
the product** — not just a build-time assistant — is the OpenAI track story, so
this is worth building even thin.

```bash
pnpm --filter @aftershock/understudy add @openai/codex-sdk   # 0.155.1
```

```ts
import { Codex } from "@openai/codex-sdk";

const codex  = new Codex({ env: { OPENAI_API_KEY: key } });
const thread = codex.startThread({ workingDirectory: checkout, outputSchema });
const result = await thread.run(brief);   // { items, finalResponse, usage, threadId }
```

`startThread` takes `workingDirectory`, `skipGitRepoCheck` and `outputSchema`;
the constructor takes `env`, `config`, `configOverrides`, `baseUrl`.

### Four things that decide whether this works

**It drives a local CLI, not an API.** `@openai/codex-sdk` depends on
`@openai/codex` and runs the agent against a real working tree. Understudy needs
an actual checkout on disk — clone the head SHA into a temp dir per attempt.
This is why the orchestrator is a worker and not a serverless function.

**Do not ask Codex for the diff. Ask git.** Let it edit files, then read
`git diff`. A model-emitted unified diff has to apply cleanly and sometimes
doesn't; a real edit always does. Use `outputSchema` for the *rationale* —
which hypothesis it used, which files it touched, why — and fill `Patch.diff`
from git. A patch is then real or it does not exist, with no parsing step
between.

**Make the constraints a gate, not a prompt.** The brief carries the PRD's four
hard constraints — minimum files, no test edits, no adjacent refactors, no new
dependencies — but prompt constraints are advisory. Check them afterwards from
`git diff --name-only` and the `package.json` diff, and reject on violation.
The model proposes, deterministic code disposes; same philosophy as the Critic's
gates. This is the cheapest defence against an agent reformatting a file and
burying the fix.

**Retry with `resumeThread`, not a fresh prompt.** The PRD's policy is one more
attempt with the verification failure appended — that is `thread.run(failureText)`
on the same thread, so Codex keeps why it made the first attempt. Persist
`threadId` on `Patch` (add the field; `repair.ts` is yours) so attempt two
resumes rather than restarts.

### The brief

Issue body verbatim · Sleuth's ranked hypotheses with evidence · the commit diff ·
the fix checklist as acceptance criteria · the four constraints.

### Convention

```
branch:  aftershock/fix-143-cart-total-memo
commit:  fix: recompute cart total when a coupon is applied

         The useCartTotal memo omitted appliedCoupon from its
         dependency array, so the displayed total never updated.

         Closes #143
         Found and verified by Aftershock run 8f2a
```

After two failures the PR opens as a **draft** labelled `aftershock:unverified`
with both attempts described in the body. Never silently give up; never claim a
fix you could not verify.

**Done when** a branch is pushed with a small diff and a commit message closing
the issue, and a deliberately impossible bug produces an honest unverified draft
rather than a confident wrong patch.

> Codex runs a full agent loop — budget minutes, not seconds. Tell Anyrudh so
> the stage machine does not block on it. It also defaults to ChatGPT login; in
> a headless worker force the API-key path through `env`, using the
> `OPENAI_API_KEY` Scout already requires.

---

## 4. Stage 6 — Curtain Call

Three gates against the patch preview, **all** of which must pass:

1. The exact failing assignments, **replayed** with their persisted `Action`
   sequences. These must now pass.
2. The issue's fix checklist, as fresh conformance assertions.
3. The full differential suite against the original base — the patch must not
   trade one regression for another. A fix agent that breaks something else is
   worse than no fix agent.

**Replay, do not re-plan.** The original run's `Action` objects are persisted.
Replaying them means it is the same test, so a pass means something — and it
costs no inference. `packages/browser/src/replay.ts` and `withRecordedActions`
already do this; you are composing, not writing a runner.

Any failure sends the run back to Understudy with the failure appended; after
two attempts it opens the unverified draft.

**Done when** the before/after pair renders in the room with both Browserbase
recordings and the `$84.00 → $67.20` step values.

---

## Also yours

**Select the sponsor prizes.** Browserbase, OpenAI, Warp and the main track.
Closes **Saturday 2:00 PM EDT** — roughly hour 14, long before the product is
finished. The PRD calls this the single most common way good hackathon projects
lose prizes. Put an alarm on it.

---

## If you fall behind

Cut **Curtain Call** — it is the PRD's designated last cut, and the demo still
ends on an opened PR with the line *"and it re-runs the fleet to verify the fix,
which we have working but not wired to the UI."* Honest, and still complete.

Do not cut Understudy. It is the one stage you can build and test before
Anyrudh's Critic exists — hand it a hand-written issue, hypothesis and diff and
it produces a patch you can inspect. That independence is why it is yours, and
it is also the OpenAI track.

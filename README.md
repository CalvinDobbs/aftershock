# AfterShock

[![CI](https://github.com/CalvinDobbs/aftershock/actions/workflows/ci.yml/badge.svg)](https://github.com/CalvinDobbs/aftershock/actions/workflows/ci.yml)
[![Devpost](https://img.shields.io/badge/Devpost-Hack%20the%20North%202026-003E54?logo=devpost&logoColor=white)](https://devpost.com/software/aftershock-ucj2nb)

**Autonomous browser QA and repair for every commit.** AfterShock turns a code
change into browser tests, compares preview and baseline behavior, independently
reproduces regressions, and can publish a source patch only after replaying the
failed journey against it.

[![Watch the AfterShock demo](https://img.youtube.com/vi/DnoKaYwHxjQ/maxresdefault.jpg)](https://www.youtube.com/watch?v=DnoKaYwHxjQ)

**[Watch the demo](https://www.youtube.com/watch?v=DnoKaYwHxjQ)** ·
**[Read the Devpost submission](https://devpost.com/software/aftershock-ucj2nb)** ·
**[See the verified repair PR](https://github.com/Nikhil-Doal/demo_site/pull/24)**

## Public end-to-end evidence

We tested AfterShock against Meridian, a storefront with two deliberately
planted regressions. The feature commit added coupon codes at checkout and also
changed a shared price-formatting helper.

| Stage | Recorded result |
| --- | --- |
| Scout | Turned the feature PR's intent into browser assignments |
| Conformance | Filed [issue #23](https://github.com/Nikhil-Doal/demo_site/issues/23) for a coupon that reported success without changing the total |
| Differential | Filed [issue #22](https://github.com/Nikhil-Doal/demo_site/issues/22) for an unrelated cart regression found by comparing preview with `main` |
| Critic | Reproduced both failures in two completed attempts before filing |
| Diagnosis | Localized the cart failure to `lib/money.ts` |
| Repair | Generated a focused source patch and opened [PR #24](https://github.com/Nikhil-Doal/demo_site/pull/24) against the feature branch |

The recorded run produced two confirmed bugs and one source repair. The coupon
failure remained open because AfterShock currently repairs one finding per run.
PR #24 includes the generated patch and deterministic validation results; its
execution note also records that browser replay was unavailable in that repair
workspace because the target application's dependencies were absent.

```diff
-  const net = cents * (1 - discountPct! / 100);
+  const net = discountPct === undefined ? cents : cents * (1 - discountPct / 100);
```

[Original feature PR](https://github.com/Nikhil-Doal/demo_site/pull/21) ·
[Verified repair PR](https://github.com/Nikhil-Doal/demo_site/pull/24)

## Why the findings are credible

AfterShock does not trust one model judgment.

- **Conformance** checks whether the change does what its author claimed.
- **Differential testing** plans a journey once, replays the same actions on the
  preview and base deployments, and treats unclaimed behavior changes as
  possible regressions.
- **The Critic** independently reproduces findings, checks that they are absent
  on the base deployment, and applies a confidence threshold before filing.
- **Curtain Call** verifies a patch by replaying the original failed actions,
  rather than planning a new test that might accidentally pass.

The comparator also has a noise canary: it runs the same journey against the
same page twice and requires zero meaningful findings. This catches unstable
accessibility-node IDs, timestamps, cache-busters, and other browser noise
without filtering away evidence such as `$84.00` versus `$67.20`.

[Read the architecture and verification model](docs/architecture.md).

## Architecture

```text
GitHub change
    │
    ▼
Scout ──► browser assignments ──► Conformance + Differential
                                         │
                                         ▼
                                      Critic
                                         │
                                         ▼
                         issue ──► Diagnosis ──► Repair
                                                   │
                                                   ▼
                                      deploy ──► Verification
                                                   │
                                                   ▼
                                          verified GitHub PR
```

The backend emits typed pipeline events. The dashboard is a projection of those
events, so a completed run is rendered from the same artifacts as a live one:
traces, screenshots, browser recordings, findings, patches, and verification
results.

## Run the dashboard

The fastest path needs no API keys or backend. It replays a recorded golden run
over server-sent events.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. Add `?speed=0` to replay the run instantly.

For live browser execution and repair:

```bash
cp .env.example .env
cp project.example.json project.json
```

Then configure the required credentials and start the web, API, and Director
services. See the [operations guide](docs/operations.md) for the complete setup,
webhook flow, repair publishing controls, and judging launcher.

## Quality and scope

`pnpm check` runs TypeScript checks and **378 tests across 10 packages**. CI runs
the same command for pushes and pull requests.

AfterShock is deliberately honest about its current boundary:

- It repairs the highest-ranked confirmed finding per run.
- It makes at most two patch attempts, then publishes an unverified draft.
- First-pass differential sessions run sequentially because the preview must
  produce actions before the base can replay them.
- Run deduplication is in memory, and evidence persistence is JSONL on disk.
- The implemented browser archetypes are conformance and differential.

See [Architecture: current limitations](docs/architecture.md#current-limitations)
for the full details.

## Repository layout

```text
apps/web                 Next.js dashboard and replay UI
services/api             GitHub triggers and run registry
services/orchestrator    stage machine, browser runtime, evidence, replay
packages/schema          shared event and domain contracts
packages/scout           commit intent to test charter
packages/browser         Stagehand execution and differential comparator
packages/critic          reproduction and confidence gates
packages/sleuth          evidence to code hypotheses
packages/understudy      Codex repair and GitHub publication
packages/curtain-call    deterministic re-verification
```

## Built at Hack the North 2026

Built with TypeScript, Next.js, Stagehand, Browserbase, OpenAI, the Codex SDK,
GitHub, and Vercel by Anirudh Chhabra, Shauraya Mohan, Nikhil Doal, and Calvin
Dobbs.

[Devpost submission](https://devpost.com/software/aftershock-ucj2nb) ·
[Product specification](prd.md) · [Design system](design.md)

# Architecture and verification model

AfterShock is an autonomous browser QA and repair pipeline. Its central design
choice is to separate intent, execution, judgment, repair, and verification so
that no single model response is treated as proof.

## Pipeline

| Agent | Stage | Responsibility |
| --- | --- | --- |
| Diffany | Scout | Turns a commit diff and message into claims and browser assignments |
| QAizen | Conformance | Checks whether the change does what it claims |
| Doppler | Differential | Replays preview actions against the base deployment |
| Gavel | Critic | Reproduces and scores findings before filing |
| Clueso | Diagnosis | Maps behavioral evidence to source hypotheses |
| Patchouli | Repair | Uses Codex to produce a constrained source change |

Maestro, the Director, is deterministic orchestration rather than an agent. It
owns stage transitions, concurrency, journaling, and event emission. Curtain
Call is also deterministic: it replays the actions that originally failed and
runs the regression suite against the patched deployment.

## Conformance

Scout reads the commit message and diff before any browser opens. Each claim
becomes an assertion with a `derivedFrom` pointer to the code or text that
justified it. A browser assignment then tests that claim against the preview
deployment.

This oracle answers: **did the change do what its author said it would do?**

## Differential testing

The preview side plans a journey once and records typed browser actions. The
base side replays those exact actions. Asking two agents independently what to
click would make model variance indistinguishable from application variance.

Each observed delta is classified as:

| Classification | Meaning |
| --- | --- |
| `match` | Identical, or equal after narrow normalization |
| `noise` | Known nondeterminism such as timestamps, UUIDs, or cache-busters |
| `claimed` | A change predicted by the commit intent |
| `unclaimed` | A possible regression outside the stated change |

Classification is intentionally asymmetric. A false `claimed` result can hide
a regression; a false `unclaimed` result still has to survive the Critic.

## Critic

The Critic reproduces every candidate in a fresh session, confirms that the
behavior is absent on the base deployment, and scores confidence against a
threshold. Findings that survive can be filed as GitHub issues; the rest remain
in the discarded-finding ledger.

Correlated deltas are grouped before judgment. Three cart lines displaying the
same invalid value are one bug, not three issues.

## Repair and verification

Sleuth ranks source hypotheses from the browser evidence and the changed-code
surface. Understudy gives Codex an isolated checkout and verifies the resulting
git diff against deterministic constraints. The pipeline then deploys the patch.

Curtain Call applies three gates:

1. Replay the exact assignments that originally failed.
2. Check the issue's repair criteria.
3. Run the differential regression suite against the original base.

A patch is marked verified only if all gates pass. Attempt two receives the
first attempt's verification failure as context. If both attempts fail, the
result is published as an explicitly unverified draft rather than a successful
repair.

## Evidence and replay

Services share types from `@aftershock/schema`; they do not define independent
wire formats. The Director stores JSONL event traces with content-addressed
screenshots. The dashboard projects the same typed artifacts for live and
completed runs, including:

- test charters and assignment traces;
- browser steps, screenshots, and recordings;
- findings and confidence modifiers;
- diagnosis hypotheses and source locations;
- patches, verification results, and publication state.

## Noise canary

The canary runs one journey against the same static page twice. A healthy run
reports zero findings. Its first implementation exposed session-specific
accessibility-node identifiers that made identical pages appear different.

Normalization remains narrow by design. Removing every number would hide the
very evidence that distinguishes `$84.00` from `$67.20`.

## Current limitations

- One run repairs the highest-ranked confirmed finding only.
- Patch generation is single-threaded and makes at most two attempts.
- First-pass differential sessions are sequential because replay depends on
  actions produced by the preview side.
- Runs are deduplicated by `(repo, sha)` in memory.
- Evidence persists on disk as JSONL and does not move between machines.
- Browser archetypes are currently `conformance` and `differential`.

These constraints are surfaced in the product and README so a successful repair
is never presented as proof that every behavior in the application is correct.

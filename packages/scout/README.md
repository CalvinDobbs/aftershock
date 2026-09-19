# @aftershock/scout

**Stage 1. A diff becomes a testable specification.**

Scout is the first agent in the pipeline and the only one that reads code. It
turns a commit into a Test Charter: what the author claims is now true, which
URLs the change can reach, and a list of assertions a browser can check.

Everything downstream depends on the quality of what comes out of here.

## Why it exists

An agent exploring a freshly shipped feature cannot tell a bug from the
feature — the whole point of a commit is that behaviour changed on purpose.
That is the oracle problem, and Scout is half the answer to it: the developer
already stated their intent in the commit message, the PR body and the diff,
and nobody machine-reads it. Convert that into explicit assertions and a
finding becomes *"this contradicts what you said you built"* rather than
*"an AI thought this looked wrong."*

The other half is the differential oracle in `@aftershock/browser`, which
needs no intent at all. That matters here: **Scout is allowed to fail.** A
commit with a useless message produces a weak charter, and the run still tests
the critical path against the base branch.

## Shape

```
CommitIntent          github.ts      what the author wrote and touched
  -> Surface[]        routes.ts      which URLs the change can reach
  -> TestCharter      charter.ts     intent, claims, assertions (one model call)
  -> Assignment[]     assignments.ts work the Cast can actually run
```

```ts
const intent = await new GitHubClient({ token }).readIntent({
  repo: "owner/repo", base: "main", head: sha, prNumber: 142,
});
const surfaces = mapRoutes(intent.files, { fallbackRoutes: ["/", "/cart"] });
const charter = await inferCharter(
  { runId, intent, surfaces, criticalJourney },
  { model: openAiModel() },
);
const { assignments, skipped } = toAssignments(charter, { runId });
```

`services/orchestrator/src/commit-run.ts` composes all four and dispatches the
result. Scout has no Browserbase dependency and never opens a browser.

## Rules that are load-bearing

**Every assertion cites its source.** `derivedFrom` is not decoration — it is
rendered in the issue and in the room, and it is the difference between a tool
that asserts and one that argues. The prompt tells the model not to write an
assertion it cannot source.

**Every run gets a differential assertion**, whether or not the diff appears
to touch the critical path. `withCriticalPath` adds it rather than trusting
the model, because a model asked to test a coupon feature will not think to
re-check checkout — and that is exactly where an unnoticed regression does the
most damage.

**Degrade, never abort.** A model error, a rate limit or an unparseable
response falls back to `smokeCharter`, which has no claims but still covers
the critical path. A charter that throws is a run that does not happen.

**Never guess a URL.** `resolveRoute` returns null for a dynamic segment with
no sample value rather than inventing one — a guessed URL 404s, and a finding
about a 404 we caused is noise. The assertion is skipped with a reason.

## Configuration

| | |
| --- | --- |
| `OPENAI_API_KEY` | required for `openAiModel()` |
| `SCOUT_MODEL` | defaults to `gpt-4.1`; Scout gates everything, so this is worth a reasoning model |
| `GITHUB_TOKEN` | optional. Public repos work unauthenticated, which is enough until the GitHub App exists |

`criticalJourney` and `fallbackRoutes` are per-project and should be
configured. The defaults are deliberately generic and marked `PLACEHOLDER`.

## This is not an e-commerce tool

Nothing in the pipeline assumes a domain. The demo app is a storefront because
commerce has the clearest broken/working signal, but the contracts are shaped
for any app a browser can open.

The one place that used to assume one was `VisibleDigest`, which modelled a
receipt — a brand, line items and a total. It is now four app-agnostic
buckets: `fields` (labelled values), `notices` (what the app is telling the
user), `controls` (what can be interacted with, and its state) and `primary`
(the one value the assertion is about). A dashboard KPI, a validation
message, a settings toggle and an order total all fit.

Scout's prompt says the same thing out loud, and it changes behaviour. On a
README-only commit it used to invent an assertion about clicking a button on
GitHub; it now returns none and scores the risk at 0.05. On a data-grid
library it produces assertions about feed status, sample-rate sliders and row
counts, with no commerce vocabulary anywhere.

Two things remain framework-shaped rather than domain-shaped, and that is
deliberate: route mapping knows Next.js conventions (`app/`, `pages/`), and
falls back to configured primary journeys for anything else.

## Known gaps

- **No import graph.** The PRD's second route strategy walks importers of a
  changed module up to the nearest page, which is what turns
  `components/CartSummary.tsx` into `/cart` instead of a fallback. It needs
  repository contents, not just the compare response, so it lands with the
  GitHub App. Shared changes currently raise the primary journeys at 0.4
  confidence — honest, but blunt.
- **Assertion quality is unmeasured.** A README-only commit produced an
  assertion about clicking a button on GitHub: sourced correctly, scored
  honestly at 0.3 confidence, and useless to a browser. Scout does not yet
  know which routes its own app actually serves.
- **No reproduction of the model call in tests.** Charter logic is tested
  against a fake `CharterModel`; the live path has been exercised by hand
  against real commits but is not in CI, because it costs a model call.

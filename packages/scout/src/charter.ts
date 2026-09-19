import { TestCharter, type Assertion, type Surface } from "@aftershock/schema";

import { renderDiff, type CommitIntent } from "./github.js";
import type { CharterModel } from "./model.js";

/**
 * Stage 1. A diff becomes a testable specification.
 *
 * This is the oracle that makes a finding an argument rather than an opinion:
 * the developer said what they were building, so behaviour that contradicts
 * it is a bug by their own account, not by ours. Everything downstream — the
 * assertions, the issue body, the "what should happen" paragraph — is only as
 * good as what comes out of here.
 */

const SYSTEM = `You are Scout, the first stage of an automated QA system.

You read a commit and decide what a browser should check. You never write code
and you never run anything; you produce a specification other agents execute.

The app could be anything a browser can open — a dashboard, an admin console,
a booking flow, a document editor, a storefront, a settings page. Take the
domain from the diff in front of you and do not assume one.

Rules you must follow:

- Every assertion cites the exact diff line, file:line, or sentence of the PR
  body that produced it. An assertion you cannot source is one you must not
  write. This citation is shown to the developer, so it must be real.
- Write assertions a person could check by looking at the running app.
  Checkable: "submitting an empty form shows a validation message", "the
  filter reduces the row count", "the export button downloads a file".
  Not checkable: "the code is correct", "performance is improved", "the
  refactor is clean".
- Only assert about pages this app serves. A change to a README, a CI config,
  a script or documentation usually has nothing a browser can verify — in
  that case return no assertions and a low confidence rather than inventing
  something to click. Never write an assertion about a third-party site.
- The agent arrives with a completely empty application: no items in a cart,
  no saved form, no prior selection, nothing logged in. If the assertion
  needs state to exist, the steps that create it come first. An assertion
  about a summary page that begins on that summary page will find an empty
  state and fail for the wrong reason — which reads as a bug in the app when
  it is a bug in the journey.
- The browser is already on the route when step one runs, so never begin with
  "go to <route>". To move to a different page mid-journey, write exactly
  "Go to /some-path" with a leading slash — that is performed as a real
  navigation and is the only way to change page. Route the journey through
  whatever pages the setup requires.
- Every other step is a single thing a person can do to the page in front of
  them: click one control, type into one field, read one value. "Add enough
  items until the subtotal is $84" is three steps, not one. "Locate the input
  and enter a code" is two. An agent acts on one element per step.
- Never ask for something a browser cannot do. Simulating a network failure,
  editing storage, or inspecting source are not steps; drop the assertion
  instead of writing a step that cannot run.
- Claims are what the author says is now true. Keep them in the author's terms,
  not yours, because they are quoted back to them.
- Prefer few strong assertions over many weak ones. Three that matter beat
  eight that restate the diff.
- If the commit message is uninformative, say so with a low intent confidence
  rather than inventing intent. A differential agent needs no intent at all,
  so a weak charter is survivable and a fabricated one is not.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims", "confidence", "assertions", "blastRadius", "riskScore"],
  properties: {
    summary: { type: "string", description: "One sentence: what this commit sets out to do." },
    claims: {
      type: "array",
      description: "What the author asserts is now true, in their terms.",
      items: { type: "string" },
    },
    confidence: {
      type: "number",
      description: "0-1. How clearly the commit states its intent. Low is fine and honest.",
    },
    assertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "route", "statement", "steps", "severity", "derivedFrom"],
        properties: {
          id: { type: "string", description: "A1, A2, ..." },
          route: { type: "string" },
          statement: { type: "string" },
          steps: {
            type: "array",
            description:
              "One plain instruction per step. The browser already starts on the route, so do not begin with 'go to'. Use 'Go to /path' only to move to a different page. Every other step is a single interaction: click one control, fill one field, read one value.",
            items: { type: "string" },
          },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          derivedFrom: {
            type: "string",
            description: "The diff line, file:line or PR sentence this came from.",
          },
        },
      },
    },
    blastRadius: {
      type: "array",
      description: "Areas of the product this change can reach.",
      items: { type: "string" },
    },
    riskScore: { type: "number", description: "0-1. Drives how many browsers this run gets." },
  },
};

export interface InferCharterInput {
  runId: string;
  intent: CommitIntent;
  surfaces: Surface[];
  /**
   * The app's critical path. Scout must cover it with a differential
   * assertion on every run, whether or not the diff appears to touch it —
   * that is exactly when a regression goes unnoticed.
   */
  criticalJourney?: CriticalJourney;
}

/**
 * The app's primary end-to-end journey, configured per project.
 *
 * It has to be configured rather than inferred: a model asked to test a
 * feature will not think to re-exercise the journey around it, and that is
 * precisely where an unnoticed regression does the most damage.
 */
export interface CriticalJourney {
  description: string;
  steps: string[];
  /**
   * Where the journey starts.
   *
   * Without this the differential anchors on the diff's highest-confidence
   * surface, which is exactly backwards: the critical path is the journey
   * that matters whether or not the commit touched it. A change to checkout
   * would have started the cart journey on /checkout, and the regression on
   * /cart would never have been looked at.
   */
  route?: string;
}

export interface InferCharterDeps {
  model: CharterModel;
}

/**
 * PLACEHOLDER — a generic stand-in for a project's real critical path.
 *
 * One vague instruction is a weak journey. Every project should pass its own
 * `criticalJourney`; this exists so a run without one still compares
 * something against the base branch instead of skipping the oracle entirely.
 */
const DEFAULT_CRITICAL_JOURNEY: CriticalJourney = {
  description: "Complete the primary end-to-end journey without using the new feature",
  steps: ["Complete the primary journey on this page without using the new feature"],
};

/**
 * Where the critical-path differential runs.
 *
 * It has to be a route a browser can actually visit. The highest-confidence
 * surface is often dynamic (`/products/[slug]`), and anchoring there meant
 * `resolveRoute` dropped the assignment and the run lost its differential
 * oracle entirely — the one that works without any intent at all.
 */
function primaryRoute(surfaces: Surface[]): string {
  const concrete = surfaces.find((s) => !s.route.includes("["));
  return concrete?.route ?? "/";
}

/** Keeps the guaranteed differential from colliding with a model-emitted id. */
function freeId(assertions: readonly Assertion[], preferred: string): string {
  if (!assertions.some((a) => a.id === preferred)) return preferred;
  for (let n = 2; ; n += 1) {
    const candidate = `${preferred}${n}`;
    if (!assertions.some((a) => a.id === candidate)) return candidate;
  }
}

/**
 * Guarantees the differential assertion the PRD requires on every run.
 *
 * The conformance oracle can only check what the author thought to mention.
 * This one needs no intent at all, which is why it is added here rather than
 * left to the model's judgement — a model asked to test one feature will not
 * think to re-exercise the journey around it, and that is the finding that
 * matters.
 */
export function withCriticalPath(
  assertions: Assertion[],
  surfaces: Surface[],
  journey: CriticalJourney,
): Assertion[] {
  if (assertions.some((a) => a.type === "differential")) return assertions;
  return [
    ...assertions,
    {
      id: freeId(assertions, "D1"),
      type: "differential",
      route: journey.route ?? primaryRoute(surfaces),
      journey: journey.description,
      steps: journey.steps,
      severity: "critical",
      rationale: "Core journey, not claimed to change. Compared against the base branch.",
    },
  ];
}

/** Everything the model is shown, in the order a person would read it. */
export function buildPrompt(input: InferCharterInput): string {
  const { intent, surfaces } = input;
  return [
    `Repository: ${intent.repo}`,
    `Comparing ${intent.baseSha.slice(0, 7)}...${intent.headSha.slice(0, 7)}`,
    "",
    "Commit messages:",
    ...intent.messages.map((m) => `  ${m.split("\n")[0]}`),
    "",
    intent.prTitle ? `Pull request #${intent.prNumber}: ${intent.prTitle}` : "No pull request.",
    intent.prBody ? `\n${intent.prBody}\n` : "",
    "Routes this change can reach:",
    ...surfaces.map((s) => `  ${s.route}  (confidence ${s.confidence.toFixed(2)} — ${s.reason})`),
    "",
    "Diff:",
    renderDiff(intent.files),
  ].join("\n");
}

/**
 * A charter with no intent in it.
 *
 * Used when the model call fails or returns something unusable. It is
 * deliberately not empty: the differential oracle needs no claims, so a run
 * that loses Scout entirely still tests the critical path against the base
 * branch. Degrade, do not abort.
 */
export function smokeCharter(input: InferCharterInput): TestCharter {
  const journey = input.criticalJourney ?? DEFAULT_CRITICAL_JOURNEY;
  return TestCharter.parse({
    runId: input.runId,
    intent: {
      summary: "Intent could not be inferred; testing the critical path against the base branch.",
      claims: [],
      confidence: 0,
    },
    surfaces: input.surfaces,
    assertions: withCriticalPath([], input.surfaces, journey),
    blastRadius: [],
    riskScore: 0.5,
  });
}

export async function inferCharter(
  input: InferCharterInput,
  deps: InferCharterDeps,
): Promise<TestCharter> {
  const journey = input.criticalJourney ?? DEFAULT_CRITICAL_JOURNEY;

  let raw: unknown;
  try {
    raw = await deps.model.complete({
      system: SYSTEM,
      user: buildPrompt(input),
      schemaName: "test_charter",
      schema: SCHEMA,
    });
  } catch {
    return smokeCharter(input);
  }

  const parsed = ModelCharter.safeParse(raw);
  if (!parsed.success) return smokeCharter(input);

  const conformance: Assertion[] = parsed.data.assertions.map((a, i) => ({
    id: a.id || `A${i + 1}`,
    type: "conformance" as const,
    route: a.route,
    statement: a.statement,
    steps: a.steps.filter((step) => step.trim().length > 0),
    severity: a.severity,
    derivedFrom: a.derivedFrom,
  }));

  return TestCharter.parse({
    runId: input.runId,
    intent: {
      summary: parsed.data.summary,
      claims: parsed.data.claims,
      confidence: clamp(parsed.data.confidence),
    },
    surfaces: input.surfaces,
    assertions: withCriticalPath(conformance, input.surfaces, journey),
    blastRadius: parsed.data.blastRadius,
    riskScore: clamp(parsed.data.riskScore),
  });
}

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

// Validated separately from TestCharter: the model returns a flatter shape and
// a bad response should fall back, not throw.
import { z } from "zod";
const ModelCharter = z.object({
  summary: z.string().min(1),
  claims: z.array(z.string()),
  confidence: z.number(),
  assertions: z.array(
    z.object({
      id: z.string(),
      route: z.string(),
      statement: z.string().min(1),
      steps: z.array(z.string()),
      severity: z.enum(["critical", "high", "medium", "low"]),
      derivedFrom: z.string().min(1),
    }),
  ),
  blastRadius: z.array(z.string()),
  riskScore: z.number(),
});

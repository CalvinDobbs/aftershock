import type { Assertion, TestCharter } from "@aftershock/schema";
import { AssignmentSchema, type Assignment } from "@aftershock/schema/browser";

/**
 * The charter becomes work the Cast can run.
 *
 * This is the seam between the two vocabularies: a pipeline assertion is a
 * claim with a severity and a citation, a browser assignment is a route and a
 * list of instructions. Keeping the translation in one place is what lets
 * either side change without the other noticing.
 */

/** Concrete routes only. A browser cannot visit `/products/[slug]`. */
export function resolveRoute(route: string, samples: Record<string, string> = {}): string | null {
  if (!route.startsWith("/")) return null;
  const segments = route.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const segment of segments) {
    const dynamic = segment.match(/^\[\.{0,3}(.+?)\]$/);
    if (!dynamic) {
      resolved.push(segment);
      continue;
    }
    const sample = samples[dynamic[1]!];
    // No sample value means we would be guessing at a URL that may not exist,
    // and a 404 is a finding about nothing.
    if (!sample) return null;
    resolved.push(sample);
  }

  return `/${resolved.join("/")}`;
}

export interface ToAssignmentsOptions {
  runId: string;
  /** Values for dynamic segments, e.g. `{ slug: "wool-scarf" }`. */
  routeSamples?: Record<string, string>;
  /**
   * Steps prepended to every assignment on a route, to put the app in the
   * state that route needs before anything is asserted.
   *
   * This is project knowledge, not something a model should infer from a
   * diff. A checkout page with an empty cart renders "nothing in your cart",
   * so an agent sent straight there finds no coupon field and reports a
   * missing feature — a bug in the journey that reads as a bug in the app.
   * Scout can be told to seed state and mostly will; configuring it is
   * deterministic, and the demo cannot afford mostly.
   *
   * Keyed by route. `{ "/checkout": ["Go to /products/x", "Click add to
   * cart", "Go to /checkout"] }`.
   */
  routeSetup?: Record<string, string[]>;
}

function journeyFor(assertion: Assertion): string[] {
  const steps = (assertion.steps ?? [])
    .filter((s) => s.trim().length > 0)
    // Scout is told the browser already starts on the route, but a model
    // will still open with "go to /checkout" now and then. Harmless when
    // setup steps precede it, redundant otherwise, so it is dropped.
    .filter((s, i) => !(i === 0 && new RegExp(`^(?:go|navigate)\\s+to\\s+(?:the\\s+)?${assertion.route}/?$`, "i").test(s.trim())));
  if (steps.length > 0) return steps;
  // A statement is a poor instruction, but it is better than dropping the
  // assertion — Stagehand can often act on it, and a skipped assertion is a
  // silent gap in coverage.
  const fallback = assertion.statement ?? assertion.journey;
  return fallback ? [fallback] : [];
}

export function toAssignments(
  charter: TestCharter,
  options: ToAssignmentsOptions,
): { assignments: Assignment[]; skipped: { assertionId: string; reason: string }[] } {
  const assignments: Assignment[] = [];
  const skipped: { assertionId: string; reason: string }[] = [];

  for (const assertion of charter.assertions) {
    const route = resolveRoute(assertion.route, options.routeSamples);
    if (!route) {
      skipped.push({
        assertionId: assertion.id,
        reason: `no sample value for a dynamic segment in ${assertion.route}`,
      });
      continue;
    }

    const setup = options.routeSetup?.[assertion.route] ?? [];
    const journey = [...setup, ...journeyFor(assertion)];
    if (journey.length === 0) {
      skipped.push({ assertionId: assertion.id, reason: "no steps and no statement to act on" });
      continue;
    }

    assignments.push(
      AssignmentSchema.parse({
        id: assertion.id,
        runId: options.runId,
        archetype: assertion.type,
        assertionId: assertion.id,
        route,
        objective: assertion.statement ?? assertion.journey ?? assertion.id,
        journey: journey.map((instruction) => ({ instruction })),
      }),
    );
  }

  return { assignments, skipped };
}

/**
 * How many browsers this run gets.
 *
 * Risk drives concurrency, per the PRD: a one-line CSS change does not
 * deserve the same fleet as a change to payment logic. Differential pairs
 * hold two slots each, so the count is in sessions rather than agents.
 */
export function sessionBudget(riskScore: number, max = 8): number {
  const floor = 3;
  return Math.max(floor, Math.min(max, Math.round(floor + riskScore * (max - floor))));
}

/** Differential pairs first: they need two slots and are the most valuable. */
export function dispatchOrder(assignments: readonly Assignment[]): Assignment[] {
  const weight = (a: Assignment) => (a.archetype === "differential" ? 0 : 1);
  return [...assignments].sort((a, b) => weight(a) - weight(b));
}

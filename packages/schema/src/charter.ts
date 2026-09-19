import { z } from 'zod';
import { Archetype, Confidence, Severity } from './primitives.js';

/** Stage 1 output. Everything the Cast does derives from this document. */

export const Intent = z.object({
  summary: z.string(),
  claims: z.array(z.string()),
  confidence: Confidence,
});
export type Intent = z.infer<typeof Intent>;

export const Surface = z.object({
  route: z.string(),
  confidence: Confidence,
  /** "direct: app/checkout/page.tsx changed" | "import graph: ..." | "fallback: ..." */
  reason: z.string(),
});
export type Surface = z.infer<typeof Surface>;

export const Assertion = z.object({
  id: z.string(),
  type: Archetype,
  route: z.string(),
  /** Conformance: the checkable statement. Differential: left undefined. */
  statement: z.string().optional(),
  /** Differential: the journey replayed in lockstep against preview and base. */
  journey: z.string().optional(),
  severity: Severity,
  /**
   * Non-negotiable. Every assertion cites the diff line or PR sentence that
   * produced it. This is what makes a finding an argument rather than a claim.
   */
  derivedFrom: z.string().optional(),
  rationale: z.string().optional(),
});
export type Assertion = z.infer<typeof Assertion>;

export const TestCharter = z.object({
  runId: z.string(),
  intent: Intent,
  surfaces: z.array(Surface),
  assertions: z.array(Assertion),
  blastRadius: z.array(z.string()),
  /** Drives concurrency allocation: a CSS tweak gets three agents, payments gets eight. */
  riskScore: Confidence,
});
export type TestCharter = z.infer<typeof TestCharter>;

import { z } from 'zod';
import { Confidence, Severity } from './primitives.js';

/** Gate 1. Class determines base confidence and whether reproduction is required. */
export const FindingClass = z.enum([
  'hard_failure', // 0.90, no reproduction required
  'unclaimed_delta', // 0.75, reproduction required
  'assertion_violation', // 0.65, reproduction required
]);
export type FindingClass = z.infer<typeof FindingClass>;

export const FindingStatus = z.enum([
  'confirmed', // cleared 0.70, filed
  'low_confidence', // visible in the dashboard, never written to GitHub
  'flaky', // failed to reproduce
  'pre_existing', // present on base too — killed outright, never a regression
]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Gate 3. Every modifier applied is shown, so the score can be audited. */
export const ConfidenceModifier = z.object({
  label: z.string(),
  delta: z.number(),
});
export type ConfidenceModifier = z.infer<typeof ConfidenceModifier>;

/** Differential only: one observable that differs between preview and base. */
export const Delta = z.object({
  field: z.string(),
  preview: z.string(),
  base: z.string(),
  classification: z.enum(['match', 'claimed', 'unclaimed', 'noise']),
});
export type Delta = z.infer<typeof Delta>;

export const Finding = z.object({
  id: z.string(),
  runId: z.string(),
  assignmentIds: z.array(z.string()),
  class: FindingClass,
  status: FindingStatus,
  severity: Severity,
  title: z.string(),
  route: z.string(),
  /** Volatile data stripped, so the same bug seen by two agents clusters as one. */
  signature: z.string(),
  expected: z.string(),
  /** Cites the diff line or PR sentence the expectation came from. */
  expectedSource: z.string(),
  actual: z.string(),
  baseConfidence: Confidence,
  confidence: Confidence,
  modifiers: z.array(ConfidenceModifier),
  reproCount: z.number(),
  reproAttempts: z.number(),
  repro: z.array(z.string()),
  deltas: z.array(Delta).optional(),
  filed: z.boolean(),
});
export type Finding = z.infer<typeof Finding>;

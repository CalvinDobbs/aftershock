import { z } from 'zod';
import { Archetype } from './primitives.js';

export const AssignmentStatus = z.enum([
  'queued',
  'running',
  'passed',
  'failed',
  'errored',
  'skipped',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

/**
 * The typed visible-text digest captured after each action.
 *
 * This is the PRD's "visible text digest — `extract` with a fixed schema"
 * (Stage 2 > state snapshot). It is what the differential comparator diffs, so
 * it exists whether or not anyone renders it; the dashboard reuses it to draw
 * a faithful page render when a screenshot has not uploaded yet, and to show
 * preview and base side by side.
 */
export const VisibleDigest = z.object({
  route: z.string(),
  /** Store name / page heading. */
  brand: z.string().optional(),
  /** Small top-right note, e.g. "Cart · 1". */
  meta: z.string().optional(),
  lines: z.array(z.object({ label: z.string(), value: z.string() })),
  notice: z.object({ text: z.string(), tone: z.enum(['ok', 'error']) }).optional(),
  /** A single input the assertion cares about, e.g. the coupon field. */
  field: z.object({ label: z.string(), value: z.string() }).optional(),
  action: z.string().optional(),
  total: z.object({ label: z.string(), value: z.string() }).optional(),
  /** True when this frame is the one the finding is about. */
  flagged: z.boolean().default(false),
});
export type VisibleDigest = z.infer<typeof VisibleDigest>;

/** One captured action plus the evidence taken immediately after it. */
export const Step = z.object({
  idx: z.number(),
  /** The Stagehand Action object. Persisting it is what makes replay, minimisation,
   *  Curtain Call verification and Playwright export all fall out of one artefact. */
  action: z.object({
    method: z.string(),
    description: z.string(),
    selector: z.string().optional(),
    arguments: z.array(z.string()).optional(),
  }),
  label: z.string(),
  screenshotUrl: z.string().nullable(),
  digest: VisibleDigest.nullable().optional(),
  /** Differential only: the base-side capture for the same action. */
  baseScreenshotUrl: z.string().nullable().optional(),
  baseDigest: VisibleDigest.nullable().optional(),
  ms: z.number(),
  ok: z.boolean(),
});
export type Step = z.infer<typeof Step>;

export const NetworkEntry = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number(),
  ms: z.number(),
  note: z.string().optional(),
});
export type NetworkEntry = z.infer<typeof NetworkEntry>;

export const ConsoleEntry = z.object({
  level: z.enum(['log', 'warn', 'error']),
  text: z.string(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

/** A per-step reasoning trace. Stored structured, streamed to the UI per stage. */
export const TraceEntry = z.object({
  seq: z.number(),
  at: z.string(),
  content: z.string(),
});
export type TraceEntry = z.infer<typeof TraceEntry>;

/**
 * One Cast member. A differential assignment holds two Browserbase sessions
 * driven in lockstep: `sessionId` is preview, `baseSessionId` is base.
 */
export const Assignment = z.object({
  id: z.string(),
  runId: z.string(),
  archetype: Archetype,
  assertionId: z.string(),
  route: z.string(),
  /** Human-readable brief shown on the card. */
  brief: z.string(),
  status: AssignmentStatus,
  sessionId: z.string().nullable(),
  baseSessionId: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  steps: z.array(Step),
  network: z.array(NetworkEntry),
  console: z.array(ConsoleEntry),
  trace: z.array(TraceEntry),
});
export type Assignment = z.infer<typeof Assignment>;

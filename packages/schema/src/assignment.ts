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
 * (Stage 2 > state snapshot). It is what the differential comparator diffs,
 * so it exists whether or not anyone renders it; the dashboard reuses it to
 * draw a faithful page render when a screenshot has not uploaded yet.
 *
 * The shape is deliberately app-agnostic. An earlier version modelled a
 * receipt — brand, line items, a total — which described a checkout page and
 * nothing else. A dashboard has KPIs, a settings page has toggles, a login
 * form has validation messages, and none of them have a total. These four
 * buckets cover all of them:
 *
 *   fields    labelled values the page is displaying
 *   notices   anything the app is telling the user right now
 *   controls  what the user can interact with, and its current state
 *   primary   the one value this assertion is actually about
 *
 * `primary` is what a finding quotes ("read $84.00, expected $67.20" — or
 * "read 0 results, expected 12"), so it is worth pulling out of `fields`.
 */
export const DigestField = z.object({
  label: z.string(),
  value: z.string(),
});
export type DigestField = z.infer<typeof DigestField>;

export const DigestNotice = z.object({
  text: z.string(),
  tone: z.enum(['info', 'ok', 'error']),
});
export type DigestNotice = z.infer<typeof DigestNotice>;

export const DigestControl = z.object({
  kind: z.enum(['input', 'button', 'link', 'toggle', 'select']),
  label: z.string(),
  /** Current state: what is typed, whether a toggle is on, what is selected. */
  value: z.string().optional(),
});
export type DigestControl = z.infer<typeof DigestControl>;

export const VisibleDigest = z.object({
  route: z.string(),
  /** The page's own heading, however the app titles itself. */
  title: z.string().optional(),
  /** A short secondary line: a count, a status, a breadcrumb. */
  meta: z.string().optional(),
  fields: z.array(DigestField).default([]),
  notices: z.array(DigestNotice).default([]),
  controls: z.array(DigestControl).default([]),
  /** The single value the assertion concerns, if there is one. */
  primary: DigestField.optional(),
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

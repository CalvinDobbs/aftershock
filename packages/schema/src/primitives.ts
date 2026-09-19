import { z } from 'zod';

/**
 * The Cast archetypes Aftershock actually dispatches.
 *
 * The PRD defines four archetypes but fixes a cut order in advance
 * (Scope > The cut order): adversary is cut first, explorer third. P0 requires
 * conformance and differential only, and those are the two oracles the pitch
 * rests on, so those are the two the system ships with.
 *
 * Adding `explorer` later is a one-line change here plus a runner and a badge.
 */
export const Archetype = z.enum(['conformance', 'differential']);
export type Archetype = z.infer<typeof Archetype>;

export const Severity = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof Severity>;

/** The Director's stage machine. Director itself is deterministic code, not an agent. */
export const Stage = z.enum([
  'trigger',
  'scout',
  'cast',
  'critic',
  'sleuth',
  'understudy',
  'curtain_call',
]);
export type Stage = z.infer<typeof Stage>;

export const StageStatus = z.enum(['pending', 'running', 'complete', 'failed', 'skipped']);
export type StageStatus = z.infer<typeof StageStatus>;

/** Confidence is always 0..1 and is always shown to the user. */
export const Confidence = z.number().min(0).max(1);

import { z } from 'zod';
import { Confidence } from './primitives.js';

export const Issue = z.object({
  id: z.string(),
  runId: z.string(),
  findingId: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  /** Rendered in the dashboard exactly as it appears on GitHub. */
  body: z.string(),
  labels: z.array(z.string()),
  /** Doubles as Curtain Call's verification contract. */
  fixChecklist: z.array(z.string()),
});
export type Issue = z.infer<typeof Issue>;

export const Hypothesis = z.object({
  file: z.string(),
  lines: z.array(z.number()),
  confidence: Confidence,
  explanation: z.string(),
  evidence: z.array(z.string()),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

export const Diagnosis = z.object({
  issueId: z.string(),
  hypotheses: z.array(Hypothesis),
  recommendedApproach: z.string(),
  /** Sleuth reports when it cannot find a cause rather than inventing a file. */
  inconclusive: z.boolean().default(false),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

export const Patch = z.object({
  id: z.string(),
  issueId: z.string(),
  branch: z.string(),
  commitMessage: z.string(),
  /** Unified diff text. */
  diff: z.string(),
  attempt: z.number(),
  verified: z.boolean(),
  previewUrl: z.string().nullable(),
  /**
   * Codex thread this patch came from.
   *
   * Retry resumes the thread rather than re-prompting, so the second attempt
   * knows why the first one was written the way it was. Absent when the patch
   * did not come from Codex.
   */
  threadId: z.string().optional(),
  /**
   * Set when a patch was rejected before it was ever offered, e.g. it edited
   * tests or added a dependency. Kept so the reason reaches the PR body rather
   * than the run simply reporting one fewer attempt.
   */
  rejectedFor: z.string().optional(),
});
export type Patch = z.infer<typeof Patch>;

/** Stage 6. Replayed Action sequences — no inference, so a pass means something. */
export const VerificationRow = z.object({
  assignmentId: z.string(),
  label: z.string(),
  before: z.enum(['passed', 'failed']),
  after: z.enum(['passed', 'failed']),
  beforeSessionId: z.string().nullable(),
  afterSessionId: z.string().nullable(),
  beforeScreenshotUrl: z.string().nullable(),
  afterScreenshotUrl: z.string().nullable(),
  beforeValue: z.string().optional(),
  afterValue: z.string().optional(),
});
export type VerificationRow = z.infer<typeof VerificationRow>;

export const Verification = z.object({
  patchId: z.string(),
  rows: z.array(VerificationRow),
  checklist: z.array(z.object({ item: z.string(), passed: z.boolean() })),
  /** The full differential suite must also stay green: no second regression. */
  regressionSuitePassed: z.boolean(),
  passed: z.boolean(),
});
export type Verification = z.infer<typeof Verification>;

export const PullRequest = z.object({
  number: z.number(),
  url: z.string(),
  title: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  labels: z.array(z.string()),
  draft: z.boolean(),
  closesIssue: z.number(),
  body: z.string(),
});
export type PullRequest = z.infer<typeof PullRequest>;

import { z } from 'zod';
import { Confidence, Stage, StageStatus } from './primitives.js';

export const RunStatus = z.enum([
  'pending',
  'running',
  'complete',
  'failed',
  'no_findings',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const Commit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  branch: z.string(),
  prNumber: z.number().optional(),
  prTitle: z.string().optional(),
  filesChanged: z.number(),
  additions: z.number(),
  deletions: z.number(),
});
export type Commit = z.infer<typeof Commit>;

export const StageState = z.object({
  stage: Stage,
  status: StageStatus,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Shown verbatim when a stage degrades rather than fails, e.g. no base deploy. */
  note: z.string().optional(),
});
export type StageState = z.infer<typeof StageState>;

export const Run = z.object({
  id: z.string(),
  repo: z.string(),
  commit: Commit,
  previewUrl: z.string().nullable(),
  /** Null when base URL resolution failed; differential assignments are then skipped. */
  baseUrl: z.string().nullable(),
  /**
   * The branch `baseUrl` was resolved from — the PR's base, or the repo
   * default for a bare push. Labels the left pane of every differential pair,
   * so it must be what was actually compared against, not an assumption.
   */
  baseBranch: z.string().nullable(),
  status: RunStatus,
  riskScore: Confidence,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  stages: z.array(StageState),
});
export type Run = z.infer<typeof Run>;

/** Row shape for the runs list. */
export const RunSummary = z.object({
  id: z.string(),
  repo: z.string(),
  sha: z.string(),
  message: z.string(),
  branch: z.string(),
  author: z.string(),
  status: RunStatus,
  agentCount: z.number(),
  findingsConfirmed: z.number(),
  findingsRaised: z.number(),
  durationMs: z.number().nullable(),
  startedAt: z.string(),
  prNumber: z.number().nullable(),
  /**
   * Whether Curtain Call actually re-ran the failing work against the patch
   * and it came back green.
   *
   * Never infer this from a pull request existing. Understudy's retry policy
   * opens a draft labelled `aftershock:unverified` after two failed attempts,
   * and a run that renders that as verified is the product lying about the
   * one thing it exists to prove. Sourced from `Verification.passed`.
   */
  verified: z.boolean().default(false),
});
export type RunSummary = z.infer<typeof RunSummary>;

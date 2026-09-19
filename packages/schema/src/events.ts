import { z } from 'zod';
import { Assignment } from './assignment.js';
import { TestCharter } from './charter.js';
import { Finding } from './finding.js';
import { Diagnosis, Issue, Patch, PullRequest, Verification } from './repair.js';
import { Run } from './run.js';
import { Stage } from './primitives.js';

/**
 * The SSE contract between `api` and the dashboard.
 *
 * Progressive reveal, not live streaming: the backend emits `stage.complete`
 * with the whole payload for that stage and the frontend animates it in. The run
 * therefore feels live while staying replayable and demo-safe — a finished run
 * replays from the database at any speed.
 *
 * `agent.update` is the one exception. Cast cards flip queued -> running ->
 * passed/failed individually so the grid fills rather than appearing at once.
 */

export const RunEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.snapshot'), run: Run }),
  z.object({ type: z.literal('stage.start'), stage: Stage }),
  z.object({ type: z.literal('stage.skip'), stage: Stage, note: z.string() }),
  z.object({ type: z.literal('scout.complete'), charter: TestCharter }),
  z.object({ type: z.literal('cast.dispatch'), assignments: z.array(Assignment) }),
  z.object({ type: z.literal('agent.update'), assignment: Assignment }),
  z.object({ type: z.literal('cast.complete') }),
  z.object({ type: z.literal('critic.complete'), findings: z.array(Finding) }),
  z.object({ type: z.literal('issue.filed'), issue: Issue }),
  z.object({ type: z.literal('sleuth.complete'), diagnosis: Diagnosis }),
  z.object({ type: z.literal('understudy.complete'), patch: Patch }),
  z.object({ type: z.literal('curtaincall.complete'), verification: Verification }),
  z.object({ type: z.literal('pr.opened'), pullRequest: PullRequest }),
  z.object({ type: z.literal('run.complete'), run: Run }),
  z.object({ type: z.literal('run.failed'), reason: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

/** Full materialised run, served by GET /runs/:id and used as the replay source. */
export const RunDetail = z.object({
  run: Run,
  charter: TestCharter.nullable(),
  assignments: z.array(Assignment),
  findings: z.array(Finding),
  issues: z.array(Issue),
  diagnosis: Diagnosis.nullable(),
  patch: Patch.nullable(),
  verification: Verification.nullable(),
  pullRequest: PullRequest.nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;

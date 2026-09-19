import type { Assignment, RunDetail, RunEvent } from '@aftershock/schema';

/**
 * Turns a materialised run into the paced event stream the dashboard consumes.
 *
 * Progressive reveal, not live streaming (PRD > Frontend): each stage lands as
 * one complete payload. The only per-item events are `agent.update`, so the
 * Cast grid fills card by card rather than appearing all at once.
 *
 * The backend emits these events for real as stages finish. This module exists
 * so a *finished* run can be replayed at any speed from stored state — which is
 * both how we develop without a backend and the demo's network-died fallback.
 */

export type PacedEvent = { after: number; event: RunEvent };

function queued(a: Assignment): Assignment {
  return {
    ...a,
    status: 'queued',
    sessionId: null,
    baseSessionId: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    steps: [],
    network: [],
    console: [],
    trace: [],
  };
}

function running(a: Assignment): Assignment {
  return {
    ...a,
    status: 'running',
    finishedAt: null,
    durationMs: null,
    // Steps arrive as they complete, so a running card shows a partial strip.
    steps: a.steps.slice(0, Math.max(1, Math.floor(a.steps.length / 2))),
    trace: a.trace.slice(0, 1),
    network: [],
    console: [],
  };
}

export function buildReplay(detail: RunDetail): PacedEvent[] {
  const ev: PacedEvent[] = [];
  let t = 0;
  const push = (after: number, event: RunEvent) => {
    t += after;
    ev.push({ after: t, event });
  };

  push(0, { type: 'run.snapshot', run: { ...detail.run, status: 'running' } });

  push(400, { type: 'stage.start', stage: 'trigger' });

  push(900, { type: 'stage.start', stage: 'scout' });
  if (detail.charter) push(2600, { type: 'scout.complete', charter: detail.charter });

  push(700, { type: 'stage.start', stage: 'cast' });
  push(500, { type: 'cast.dispatch', assignments: detail.assignments.map(queued) });

  // Dispatch order mirrors the Director's priority queue: differential pairs
  // first (two slots, highest value), then conformance.
  const order = [...detail.assignments].sort((a, b) =>
    a.archetype === b.archetype ? 0 : a.archetype === 'differential' ? -1 : 1,
  );

  order.forEach((a, i) => push(i === 0 ? 350 : 300, { type: 'agent.update', assignment: running(a) }));

  // Completion order is by real duration, so the grid settles the way it did.
  const byDuration = [...detail.assignments].sort(
    (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0),
  );
  byDuration.forEach((a, i) => push(i === 0 ? 2200 : 1100, { type: 'agent.update', assignment: a }));

  push(500, { type: 'cast.complete' });

  push(700, { type: 'stage.start', stage: 'critic' });
  push(2400, { type: 'critic.complete', findings: detail.findings });
  detail.issues.forEach((issue, i) => push(i === 0 ? 900 : 700, { type: 'issue.filed', issue }));

  if (detail.diagnosis) {
    push(700, { type: 'stage.start', stage: 'sleuth' });
    push(2000, { type: 'sleuth.complete', diagnosis: detail.diagnosis });
  }

  if (detail.patch) {
    push(700, { type: 'stage.start', stage: 'understudy' });
    push(2600, { type: 'understudy.complete', patch: detail.patch });
  }

  if (detail.verification) {
    push(700, { type: 'stage.start', stage: 'curtain_call' });
    push(2600, { type: 'curtaincall.complete', verification: detail.verification });
  }

  if (detail.pullRequest) push(900, { type: 'pr.opened', pullRequest: detail.pullRequest });

  push(600, { type: 'run.complete', run: detail.run });

  return ev;
}

export const REPLAY_TOTAL_MS = (ev: PacedEvent[]) => ev.at(-1)?.after ?? 0;

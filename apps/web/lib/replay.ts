import type { Assignment, RunDetail, RunEvent } from '@aftershock/schema';

/**
 * Turns a materialised run into the paced event stream the dashboard consumes.
 *
 * Pacing is deliberate, not a loading simulation. The gap between a
 * `stage.start` and its `*.complete` is where the room shows who is working —
 * so those gaps are long enough to read the message that just landed and
 * notice the next bot start typing. A full run is about a minute at speed 1,
 * which is roughly how long the real pipeline takes anyway.
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

  push(700, { type: 'stage.start', stage: 'trigger' });

  push(1600, { type: 'stage.start', stage: 'scout' });
  if (detail.charter) push(6000, { type: 'scout.complete', charter: detail.charter });

  push(1800, { type: 'stage.start', stage: 'cast' });
  push(900, { type: 'cast.dispatch', assignments: detail.assignments.map(queued) });

  // Dispatch order mirrors the Director's priority queue: differential pairs
  // first (two slots, highest value), then conformance.
  const order = [...detail.assignments].sort((a, b) =>
    a.archetype === b.archetype ? 0 : a.archetype === 'differential' ? -1 : 1,
  );

  // Sessions open one at a time — the Director holds a semaphore, and seeing
  // the grid fill is the point.
  order.forEach((a, i) => push(i === 0 ? 900 : 800, { type: 'agent.update', assignment: running(a) }));

  // Completion order is by real duration, so the grid settles the way it did.
  const byDuration = [...detail.assignments].sort(
    (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0),
  );
  byDuration.forEach((a, i) => push(i === 0 ? 4200 : 2800, { type: 'agent.update', assignment: a }));

  push(1000, { type: 'cast.complete' });

  push(1500, { type: 'stage.start', stage: 'critic' });
  push(6500, { type: 'critic.complete', findings: detail.findings });
  detail.issues.forEach((issue, i) => push(i === 0 ? 1600 : 1200, { type: 'issue.filed', issue }));

  if (detail.diagnosis) {
    push(1500, { type: 'stage.start', stage: 'sleuth' });
    push(5500, { type: 'sleuth.complete', diagnosis: detail.diagnosis });
  }

  if (detail.patch) {
    push(1500, { type: 'stage.start', stage: 'understudy' });
    push(6500, { type: 'understudy.complete', patch: detail.patch });
  }

  if (detail.verification) {
    push(1500, { type: 'stage.start', stage: 'curtain_call' });
    push(6000, { type: 'curtaincall.complete', verification: detail.verification });
  }

  if (detail.pullRequest) push(1800, { type: 'pr.opened', pullRequest: detail.pullRequest });

  push(1400, { type: 'run.complete', run: detail.run });

  return ev;
}

export const REPLAY_TOTAL_MS = (ev: PacedEvent[]) => ev.at(-1)?.after ?? 0;

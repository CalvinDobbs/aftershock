'use client';

import { useEffect, useMemo, useReducer } from 'react';
import type { Issue, RunDetail, RunEvent, Stage } from '@aftershock/schema';
import { deriveRoom, type RunState } from './room';

export type StreamState = RunState & {
  issues: Issue[];
  /** Stage currently in flight, for the header and the roster. */
  active: Stage | null;
  done: Stage[];
  connected: boolean;
};

const empty = (seed?: RunDetail): StreamState => ({
  run: seed?.run ?? null,
  charter: null,
  assignments: [],
  findings: [],
  issues: [],
  diagnosis: null,
  patch: null,
  verification: null,
  pullRequest: null,
  active: null,
  done: [],
  connected: false,
});

function reduce(s: StreamState, e: RunEvent | { type: '@open' } | { type: '@close' }): StreamState {
  switch (e.type) {
    case '@open':
      return { ...s, connected: true };
    case '@close':
      return { ...s, connected: false };
    case 'run.snapshot':
      return { ...s, run: e.run };
    case 'stage.start':
      return { ...s, active: e.stage };
    case 'stage.skip':
      return { ...s, done: [...s.done, e.stage], active: null };
    case 'scout.complete':
      return { ...s, charter: e.charter, done: [...s.done, 'scout'] };
    case 'cast.dispatch':
      return { ...s, assignments: e.assignments };
    case 'agent.update':
      return {
        ...s,
        assignments: s.assignments.some((a) => a.id === e.assignment.id)
          ? s.assignments.map((a) => (a.id === e.assignment.id ? e.assignment : a))
          : [...s.assignments, e.assignment],
      };
    case 'cast.complete':
      return { ...s, done: [...s.done, 'cast'] };
    case 'critic.complete':
      return { ...s, findings: e.findings, done: [...s.done, 'critic'] };
    case 'issue.filed':
      return { ...s, issues: [...s.issues.filter((i) => i.id !== e.issue.id), e.issue] };
    case 'sleuth.complete':
      return { ...s, diagnosis: e.diagnosis, done: [...s.done, 'sleuth'] };
    case 'understudy.complete':
      return { ...s, patch: e.patch, done: [...s.done, 'understudy'] };
    case 'curtaincall.complete':
      return { ...s, verification: e.verification, done: [...s.done, 'curtain_call'] };
    case 'pr.opened':
      return { ...s, pullRequest: e.pullRequest };
    case 'run.complete':
      return { ...s, run: e.run, active: null };
    case 'run.failed':
      return { ...s, active: null };
    default:
      return s;
  }
}

/**
 * Subscribes to the run's stage events and accumulates them into one state.
 *
 * Progressive reveal: each `*.complete` event carries a whole stage payload, so
 * the UI never renders a half-built charter or a partial verdict. `agent.update`
 * is the exception — Cast cards flip individually so the room fills.
 */
export function useRunStream(runId: string, seed?: RunDetail, speed = 1) {
  const [state, dispatch] = useReducer(reduce, seed, empty);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/events?speed=${speed}`);
    es.onopen = () => dispatch({ type: '@open' });
    es.onmessage = (ev) => {
      try {
        dispatch(JSON.parse(ev.data) as RunEvent);
      } catch {
        /* a malformed frame should never take down the run view */
      }
    };
    es.onerror = () => {
      dispatch({ type: '@close' });
      es.close();
    };
    return () => es.close();
  }, [runId, speed]);

  const entries = useMemo(() => deriveRoom(state), [state]);
  return { state, entries };
}

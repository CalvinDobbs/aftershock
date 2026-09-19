'use client';

import { useEffect, useState } from 'react';

import type { AgentEvent, AgentTraceEvent } from '@aftershock/schema/browser';

import { browserRunStreamUrl, getBrowserRunTraces } from './browserRuns';

/**
 * Live browser telemetry for one run.
 *
 * History first, then the SSE tail, both keyed by `sequence` so the overlap a
 * reconnect produces collapses instead of duplicating. Unlike the pipeline's
 * progressive reveal, this really is live: events land as the agents act.
 */

export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting';

const EVENT_TYPES: AgentEvent['type'][] = [
  'session.opened',
  'step.planned',
  'step.executed',
  'step.captured',
  'finding.raised',
  'session.closed',
  'session.failed',
];

export function useBrowserRunStream(runId: string | undefined): {
  traces: AgentTraceEvent[];
  streamState: StreamState;
  error: string | undefined;
} {
  const [traces, setTraces] = useState<AgentTraceEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!runId) {
      setTraces([]);
      setStreamState('idle');
      setError(undefined);
      return;
    }

    const collected = new Map<number, AgentTraceEvent>();
    let stale = false;
    setTraces([]);
    setError(undefined);
    setStreamState('connecting');

    const commit = () =>
      setTraces([...collected.values()].sort((a, b) => a.sequence - b.sequence));

    getBrowserRunTraces(runId)
      .then((history) => {
        if (stale) return;
        for (const trace of history) collected.set(trace.sequence, trace);
        commit();
      })
      .catch((cause: unknown) => {
        if (stale) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    const source = new EventSource(browserRunStreamUrl(runId));
    const onEvent = (message: MessageEvent<string>) => {
      if (stale) return;
      try {
        const trace = JSON.parse(message.data) as AgentTraceEvent;
        collected.set(trace.sequence, trace);
        commit();
      } catch {
        setError('Failed to parse a streamed event');
      }
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    source.onopen = () => {
      if (!stale) setStreamState('live');
    };
    source.onerror = () => {
      if (!stale) setStreamState('reconnecting');
    };

    return () => {
      stale = true;
      source.close();
    };
  }, [runId]);

  return { traces, streamState, error };
}

import { useEffect, useState } from "react";

import type { AgentEvent, AgentTraceEvent } from "@aftershock/schema";

import { getRunTraces } from "./api";

export type StreamState = "idle" | "connecting" | "live" | "reconnecting";

const EVENT_TYPES: AgentEvent["type"][] = [
  "session.opened",
  "step.planned",
  "step.executed",
  "step.captured",
  "finding.raised",
  "session.closed",
  "session.failed",
];

export function useRunStream(runId: string | undefined): {
  traces: AgentTraceEvent[];
  streamState: StreamState;
  error: string | undefined;
} {
  const [traces, setTraces] = useState<AgentTraceEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!runId) {
      setTraces([]);
      setStreamState("idle");
      setError(undefined);
      return;
    }

    const collected = new Map<number, AgentTraceEvent>();
    let stale = false;
    setTraces([]);
    setError(undefined);
    setStreamState("connecting");

    getRunTraces(runId)
      .then((history) => {
        if (stale) return;
        for (const trace of history) collected.set(trace.sequence, trace);
        setTraces([...collected.values()].sort((a, b) => a.sequence - b.sequence));
      })
      .catch((cause: unknown) => {
        if (stale) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events/stream`);
    const onEvent = (message: MessageEvent<string>) => {
      if (stale) return;
      try {
        const trace = JSON.parse(message.data) as AgentTraceEvent;
        collected.set(trace.sequence, trace);
        setTraces([...collected.values()].sort((a, b) => a.sequence - b.sequence));
      } catch {
        setError("Failed to parse a streamed event");
      }
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    source.onopen = () => {
      if (!stale) setStreamState("live");
    };
    source.onerror = () => {
      if (!stale) setStreamState("reconnecting");
    };

    return () => {
      stale = true;
      source.close();
    };
  }, [runId]);

  return { traces, streamState, error };
}

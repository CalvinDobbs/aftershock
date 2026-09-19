import type { ReactNode } from "react";

import type { AgentEvent, AgentTraceEvent } from "@aftershock/schema";

interface EventTimelineProps {
  traces: AgentTraceEvent[];
}

const TITLES: Record<AgentEvent["type"], string> = {
  "session.opened": "Session opened",
  "step.planned": "Step planned",
  "step.executed": "Step executed",
  "step.captured": "Step captured",
  "finding.raised": "Finding raised",
  "session.closed": "Session closed",
  "session.failed": "Session failed",
};

function Chip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}

function formatUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}): string {
  return `${usage.inputTokens + usage.outputTokens + usage.reasoningTokens} tok`;
}

function Details({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case "session.opened":
      return (
        <>
          <Chip>side {event.side}</Chip>
          <Chip>session {event.sessionId.slice(0, 8)}</Chip>
        </>
      );
    case "step.planned":
      return (
        <>
          <Chip>{event.instruction}</Chip>
          <Chip>{event.action.description}</Chip>
          <Chip>cache {event.cacheStatus}</Chip>
          <Chip>{event.durationMs} ms</Chip>
          <Chip>{formatUsage(event.usage)}</Chip>
        </>
      );
    case "step.executed":
      return (
        <>
          <Chip>{event.action.description}</Chip>
          <Chip>{event.durationMs} ms</Chip>
        </>
      );
    case "step.captured":
      return (
        <>
          <Chip>{event.url}</Chip>
          <Chip>{event.network.requestCount} requests</Chip>
          <Chip>{event.consoleErrors.length} console errors</Chip>
        </>
      );
    case "finding.raised":
      return (
        <>
          <Chip>{event.finding.severity}</Chip>
          <Chip>{event.finding.summary}</Chip>
        </>
      );
    case "session.closed":
      return <Chip>{event.durationMs} ms</Chip>;
    case "session.failed":
      return <Chip>{event.message}</Chip>;
  }
}

export function EventTimeline({ traces }: EventTimelineProps) {
  if (traces.length === 0) {
    return <p className="empty-note">No events recorded yet.</p>;
  }
  return (
    <ol className="timeline">
      {traces.map((trace) => (
        <li
          key={trace.sequence}
          className={`timeline-item event-${trace.event.type.replace(".", "-")}`}
        >
          <div className="timeline-node" aria-hidden="true" />
          <div className="timeline-body">
            <div className="timeline-head">
              <span className="timeline-seq">#{trace.sequence}</span>
              <span className="timeline-title">{TITLES[trace.event.type]}</span>
              <span className="timeline-time">
                {new Date(trace.event.timestamp).toLocaleTimeString()}
              </span>
              <span className="timeline-assignment">{trace.event.assignmentId}</span>
            </div>
            <div className="timeline-details">
              <Details event={trace.event} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

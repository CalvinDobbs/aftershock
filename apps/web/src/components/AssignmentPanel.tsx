import type { AgentTraceEvent } from "@aftershock/schema";

import { browserbaseSessionUrl, screenshotUrl } from "../api";
import { EventTimeline } from "./EventTimeline";
import { ReplayPlayer } from "./ReplayPlayer";
import { StatusBadge } from "./StatusBadge";

interface AssignmentPanelProps {
  assignmentId: string;
  traces: AgentTraceEvent[];
}

function totalTokens(traces: AgentTraceEvent[]): number {
  return traces.reduce((sum, trace) => {
    const event = trace.event;
    if (event.type === "step.planned" || event.type === "step.executed") {
      return (
        sum +
        event.usage.inputTokens +
        event.usage.outputTokens +
        event.usage.reasoningTokens
      );
    }
    return sum;
  }, 0);
}

export function AssignmentPanel({ assignmentId, traces }: AssignmentPanelProps) {
  const events = traces.map((trace) => trace.event);
  const opened = events.find((event) => event.type === "session.opened");
  const closed = events.filter((event) => event.type === "session.closed");
  const failed = events.some((event) => event.type === "session.failed");
  const planned = events.filter((event) => event.type === "step.planned");
  const captured = events.filter((event) => event.type === "step.captured");

  const inferenceMs = events.reduce((sum, event) => {
    if (event.type === "step.planned" || event.type === "step.executed") {
      return sum + event.durationMs;
    }
    return sum;
  }, 0);
  const cacheHits = planned.filter(
    (event) => event.type === "step.planned" && event.cacheStatus === "HIT",
  ).length;
  const latestCaptured = captured[captured.length - 1];

  const status = failed ? "failed" : opened && closed.length > 0 ? "completed" : "running";

  const alerts: { kind: string; text: string }[] = [];
  for (const event of captured) {
    if (event.type !== "step.captured") continue;
    for (const failedRequest of event.network.failedRequests) {
      alerts.push({
        kind: "network",
        text: `${failedRequest.method} ${failedRequest.url}${failedRequest.status ? ` → ${failedRequest.status}` : ""}${failedRequest.errorText ? ` (${failedRequest.errorText})` : ""}`,
      });
    }
    for (const entry of event.consoleErrors) {
      alerts.push({ kind: "console", text: entry.text });
    }
  }

  const openedSession = opened?.type === "session.opened" ? opened.sessionId : undefined;
  const closedSession =
    closed[0]?.type === "session.closed" ? closed[0].sessionId : undefined;
  const sessionId = openedSession ?? closedSession;
  const liveViewUrl = opened?.type === "session.opened" ? opened.liveViewUrl : undefined;
  const isClosed = closed.length > 0;

  return (
    <section className="assignment">
      <header className="assignment-head">
        <div>
          <span className="label">Assignment</span>
          <h2 className="mono">{assignmentId}</h2>
        </div>
        <div className="assignment-meta">
          {opened?.type === "session.opened" && <span className="chip">side {opened.side}</span>}
          <StatusBadge status={status} />
          {sessionId && (
            <a href={browserbaseSessionUrl(sessionId)} target="_blank" rel="noreferrer">
              Browserbase session
            </a>
          )}
        </div>
      </header>

      <div className="metric-grid">
        <div className="metric">
          <span className="metric-value mono">{totalTokens(traces)}</span>
          <span className="metric-label">Total tokens</span>
        </div>
        <div className="metric">
          <span className="metric-value mono">{inferenceMs} ms</span>
          <span className="metric-label">Inference latency</span>
        </div>
        <div className="metric">
          <span className="metric-value mono">
            {cacheHits}/{planned.length}
          </span>
          <span className="metric-label">Cache hits</span>
        </div>
        <div className="metric">
          <span className="metric-value mono">
            {latestCaptured?.type === "step.captured"
              ? `${latestCaptured.network.requestCount} req / ${latestCaptured.consoleErrors.length} err`
              : "—"}
          </span>
          <span className="metric-label">Requests / errors</span>
        </div>
      </div>

      {!isClosed && liveViewUrl && (
        <div className="live-view">
          <div className="section-head">
            <h3>Live view</h3>
            <a href={liveViewUrl} target="_blank" rel="noreferrer">
              Open Live View
            </a>
          </div>
          <iframe
            src={liveViewUrl}
            title={`Live view for ${assignmentId}`}
            className="live-frame"
          />
        </div>
      )}

      {captured.some((event) => event.type === "step.captured" && event.screenshotId) && (
        <div className="shots">
          <h3>Screenshots</h3>
          <div className="shot-grid">
            {captured.map((event) =>
              event.type === "step.captured" && event.screenshotId ? (
                <figure key={event.index}>
                  <img
                    src={screenshotUrl(event.screenshotId)}
                    alt={`Step ${event.index} screenshot`}
                    loading="lazy"
                  />
                  <figcaption>
                    <span className="mono">Step {event.index}</span> {event.url}
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="evidence">
        <h3>Evidence</h3>
        {alerts.length === 0 ? (
          <p className="empty-note">No failed requests or console errors captured.</p>
        ) : (
          <ul className="alert-list">
            {alerts.map((alert, index) => (
              <li key={index} className={`alert-item alert-${alert.kind}`}>
                <span className="chip">{alert.kind}</span> {alert.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {sessionId && <ReplayPlayer sessionId={sessionId} ready={isClosed} />}

      <EventTimeline traces={traces} />
    </section>
  );
}

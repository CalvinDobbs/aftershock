import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentTraceEvent, RunStatus, RunSummary } from "@aftershock/schema";

import { launchDemoRun, listRuns } from "./api";
import { AssignmentPanel } from "./components/AssignmentPanel";
import { StatusBadge } from "./components/StatusBadge";
import { useRunStream } from "./use-run-stream";

const POLL_MS = 2500;

function shorten(id: string): string {
  return id.length > 18 ? `${id.slice(0, 14)}…${id.slice(-4)}` : id;
}

function statusFromTraces(traces: AgentTraceEvent[]): RunStatus {
  const events = traces.map((trace) => trace.event);
  if (events.some((event) => event.type === "session.failed")) return "failed";
  const opened = events.filter((event) => event.type === "session.opened").length;
  const closed = events.filter((event) => event.type === "session.closed").length;
  return opened > 0 && closed >= opened ? "completed" : "running";
}

function Alert({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="alert" role="alert">
      <span>{message}</span>
      <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export default function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [launchError, setLaunchError] = useState<string | undefined>(undefined);
  const [launching, setLaunching] = useState(false);
  const [streamErrorDismissed, setStreamErrorDismissed] = useState(false);
  const { traces, streamState, error: streamError } = useRunStream(selectedRunId);

  useEffect(() => setStreamErrorDismissed(false), [streamError, selectedRunId]);

  const refreshRuns = useCallback(async () => {
    try {
      const list = await listRuns();
      setRuns(list);
      setListError(undefined);
      setSelectedRunId((current) => current ?? list[0]?.runId);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
    const timer = setInterval(() => void refreshRuns(), POLL_MS);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  const launch = async () => {
    setLaunching(true);
    try {
      const run = await launchDemoRun();
      setLaunchError(undefined);
      setSelectedRunId(run.runId);
      void refreshRuns();
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunching(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, AgentTraceEvent[]>();
    for (const trace of traces) {
      const list = map.get(trace.event.assignmentId) ?? [];
      list.push(trace);
      map.set(trace.event.assignmentId, list);
    }
    return [...map.entries()];
  }, [traces]);

  const summary = runs.find((run) => run.runId === selectedRunId);
  const status: RunStatus = summary?.status ?? statusFromTraces(traces);
  const assignmentCount = summary?.assignmentCount ?? grouped.length;
  const startedAt = summary?.startedAt ?? traces[0]?.event.timestamp;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="seismic" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>AFTERSHOCK</h1>
            <p>Browser QA control room</p>
          </div>
        </div>
        <div className="topbar-controls">
          <span className={`conn conn-${streamState}`}>
            <span className="status-dot" aria-hidden="true" />
            {streamState}
          </span>
          <button
            type="button"
            className="primary"
            aria-label={launching ? "Launching Browserbase run" : "Launch Browserbase run"}
            onClick={() => void launch()}
            disabled={launching}
          >
            {launching ? (
              "Launching…"
            ) : (
              <>
                <span className="launch-label-full">Launch Browserbase Run</span>
                <span className="launch-label-compact">Launch Run</span>
              </>
            )}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="rail">
          <div className="rail-head">
            <span className="label">RUN ARCHIVE</span>
            <span className="rail-count mono">{runs.length}</span>
          </div>
          {runs.length === 0 && <p className="empty-note">No runs recorded yet.</p>}
          <ul className="run-list">
            {runs.map((run) => (
              <li key={run.runId}>
                <button
                  type="button"
                  className={`run-card${run.runId === selectedRunId ? " selected" : ""}`}
                  onClick={() => setSelectedRunId(run.runId)}
                  title={run.runId}
                >
                  <div className="run-card-top">
                    <StatusBadge status={run.status} />
                    <span className="mono run-id">{shorten(run.runId)}</span>
                  </div>
                  <div className="run-card-meta">
                    <span>{new Date(run.updatedAt).toLocaleString()}</span>
                    <span>
                      {run.assignmentCount} assignments · {run.eventCount} events
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="detail">
          {listError && <Alert message={listError} onClose={() => setListError(undefined)} />}
          {streamError && !streamErrorDismissed && (
            <Alert message={streamError} onClose={() => setStreamErrorDismissed(true)} />
          )}
          {launchError && (
            <Alert message={launchError} onClose={() => setLaunchError(undefined)} />
          )}

          {!selectedRunId ? (
            <div className="empty-state">
              <h2>No run selected</h2>
              <p>
                Launch a live Browserbase assignment to watch planning, execution, capture, and
                replay events stream in.
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => void launch()}
                disabled={launching}
              >
                {launching ? "Launching…" : "Launch Browserbase Run"}
              </button>
            </div>
          ) : (
            <>
              <div className="hero">
                <div>
                  <span className="label">Run</span>
                  <h2 className="mono">{selectedRunId}</h2>
                </div>
                <div className="hero-meta">
                  <StatusBadge status={status} />
                  {startedAt && (
                    <span className="chip">
                      started {new Date(startedAt).toLocaleTimeString()}
                    </span>
                  )}
                  <span className="chip">{traces.length} events</span>
                  <span className="chip">{assignmentCount} assignments</span>
                  <span className={`chip conn-${streamState}`}>
                    {streamState === "live" ? "live stream" : `${streamState} (persisted)`}
                  </span>
                </div>
              </div>

              {grouped.length === 0 && (
                <p className="empty-note">Waiting for the first events of this run…</p>
              )}
              {grouped.map(([assignmentId, assignmentTraces]) => (
                <AssignmentPanel
                  key={assignmentId}
                  assignmentId={assignmentId}
                  traces={assignmentTraces}
                />
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

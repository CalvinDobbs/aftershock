import { describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "@aftershock/schema/browser";

import { InMemoryEventRepository, RunEventStream } from "./event-stream.js";

function event(assignmentId: string): AgentEvent {
  return {
    type: "session.opened",
    runId: "run-1",
    assignmentId,
    timestamp: "2026-09-19T12:00:00.000Z",
    side: "preview",
    sessionId: `session-${assignmentId}`,
  };
}

describe("RunEventStream", () => {
  it("serializes concurrent agent events into one run timeline", async () => {
    const repository = new InMemoryEventRepository();
    const stream = new RunEventStream(repository);
    const observed: number[] = [];
    stream.subscribe("run-1", (trace) => observed.push(trace.sequence));

    const traces = await Promise.all([
      stream.publish(event("assignment-1")),
      stream.publish(event("assignment-2")),
      stream.publish(event("assignment-3")),
    ]);

    expect(traces.map((trace) => trace.sequence)).toEqual([0, 1, 2]);
    expect(observed).toEqual([0, 1, 2]);
    expect(repository.traces).toHaveLength(3);
  });

  it("replays persisted events in sequence order", async () => {
    const repository = new InMemoryEventRepository();
    repository.traces.push(
      { sequence: 1, event: event("assignment-2") },
      { sequence: 0, event: event("assignment-1") },
    );
    const stream = new RunEventStream(repository);
    const listener = vi.fn();

    await stream.replay("run-1", listener);

    expect(listener.mock.calls.map(([trace]) => trace.sequence)).toEqual([0, 1]);
  });

  it("discovers unique run ids", async () => {
    const stream = new RunEventStream(new InMemoryEventRepository());
    await stream.publish(event("assignment-1"));
    await stream.publish({ ...event("assignment-2"), runId: "run-2" });
    await stream.publish({ ...event("assignment-3"), runId: "run-1" });

    const runIds = (await stream.runs()).map((run) => run.runId).sort();
    expect(runIds).toEqual(["run-1", "run-2"]);
  });

  it("summarizes running, completed, and failed runs newest-first", async () => {
    const stream = new RunEventStream(new InMemoryEventRepository());
    const closed = {
      ...event("assignment-1"),
      runId: "run-done",
      type: "session.closed",
      sessionId: "session-1",
      durationMs: 100,
    } as AgentEvent;
    const failed = {
      ...event("assignment-2"),
      runId: "run-failed",
      type: "session.failed",
      message: "boom",
    } as AgentEvent;

    await stream.publish({ ...event("assignment-1"), runId: "run-open" });
    await stream.publish({ ...event("assignment-1"), runId: "run-done" });
    await stream.publish({ ...closed, timestamp: "2026-09-19T12:01:00.000Z" });
    await stream.publish({ ...event("assignment-2"), runId: "run-failed", timestamp: "2026-09-19T12:02:00.000Z" });
    await stream.publish({ ...failed, timestamp: "2026-09-19T12:03:00.000Z" });

    const runs = await stream.runs();
    const byId = new Map(runs.map((run) => [run.runId, run]));

    expect(byId.get("run-open")?.status).toBe("running");
    expect(byId.get("run-done")?.status).toBe("completed");
    expect(byId.get("run-failed")?.status).toBe("failed");
    expect(byId.get("run-done")?.assignmentCount).toBe(1);
    expect(byId.get("run-done")?.eventCount).toBe(2);
    expect(runs[0]?.runId).toBe("run-failed");
  });

  it("isolates disconnected frontend listeners from the run", async () => {
    const stream = new RunEventStream(new InMemoryEventRepository());
    stream.subscribe("run-1", () => {
      throw new Error("client disconnected");
    });

    await expect(stream.publish(event("assignment-1"))).resolves.toMatchObject({ sequence: 0 });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "@aftershock/schema";

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

  it("isolates disconnected frontend listeners from the run", async () => {
    const stream = new RunEventStream(new InMemoryEventRepository());
    stream.subscribe("run-1", () => {
      throw new Error("client disconnected");
    });

    await expect(stream.publish(event("assignment-1"))).resolves.toMatchObject({ sequence: 0 });
  });
});

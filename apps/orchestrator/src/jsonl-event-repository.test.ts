import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentEvent } from "@aftershock/schema";

import { RunEventStream } from "./event-stream.js";
import { JsonlEventRepository } from "./jsonl-event-repository.js";

function event(runId: string, assignmentId: string): AgentEvent {
  return {
    type: "session.opened",
    runId,
    assignmentId,
    timestamp: "2026-09-19T12:00:00.000Z",
    side: "preview",
    sessionId: `session-${assignmentId}`,
  };
}

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aftershock-events-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("JsonlEventRepository", () => {
  it("persists traces across repository instances with per-run isolation", async () => {
    const stream = new RunEventStream(new JsonlEventRepository(directory));
    await stream.publish(event("run-1", "assignment-1"));
    await stream.publish(event("run-1", "assignment-2"));
    await stream.publish(event("run-2", "assignment-3"));

    const reloaded = new JsonlEventRepository(directory);
    expect((await reloaded.list("run-1")).map((trace) => trace.sequence)).toEqual([0, 1]);
    expect((await reloaded.list("run-2")).map((trace) => trace.sequence)).toEqual([0]);
    expect(await reloaded.list("run-3")).toEqual([]);
    expect(await reloaded.listRunIds()).toEqual(expect.arrayContaining(["run-1", "run-2"]));
  });

  it("returns no run ids for a missing root directory", async () => {
    const repository = new JsonlEventRepository(join(directory, "does-not-exist"));
    expect(await repository.listRunIds()).toEqual([]);
    expect(await repository.list("run-1")).toEqual([]);
  });

  it("serves sorted history through RunEventStream.history", async () => {
    const repository = new JsonlEventRepository(directory);
    await repository.append({ sequence: 5, event: event("run-4", "assignment-1") });
    await repository.append({ sequence: 4, event: event("run-4", "assignment-2") });

    const stream = new RunEventStream(repository);
    expect((await stream.history("run-4")).map((trace) => trace.sequence)).toEqual([4, 5]);
  });
});

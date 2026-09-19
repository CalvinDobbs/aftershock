import { describe, expect, it, vi } from "vitest";

import type { Assignment } from "@aftershock/schema/browser";

import { dispatch, type SkippedWork } from "./commit-run.js";

const make = (id: string, archetype: Assignment["archetype"]): Assignment => ({
  id,
  runId: "run-1",
  archetype,
  route: "/",
  objective: "o",
  journey: [{ instruction: "i" }],
});

/** Runs that resolve only when released, so overlap is observable. */
function controllable() {
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const run = vi.fn(async (a: Assignment) => {
    started.push(a.id);
    await new Promise<void>((resolve) => release.set(a.id, resolve));
  });
  return { started, release, run };
}

describe("dispatch", () => {
  it("never exceeds the slot budget, counting a pair as two", async () => {
    const { started, release, run } = controllable();
    const skipped: SkippedWork[] = [];

    const done = dispatch(
      [make("D1", "differential"), make("A1", "conformance"), make("A2", "conformance")],
      3,
      run,
      skipped,
    );

    await vi.waitFor(() => expect(started).toHaveLength(2));
    // D1 holds two of three slots, so only one conformance fits alongside it.
    expect(started).toEqual(["D1", "A1"]);

    release.get("D1")!();
    await vi.waitFor(() => expect(started).toContain("A2"));
    release.get("A1")!();
    release.get("A2")!();
    await done;
    expect(skipped).toHaveLength(0);
  });

  it("skips a pair that could never fit instead of deadlocking behind it", async () => {
    // A plan allowing one concurrent session can never run a differential.
    // Waiting for a second slot would hang the whole queue forever.
    const skipped: SkippedWork[] = [];
    const run = vi.fn(async () => undefined);

    await dispatch([make("D1", "differential"), make("A1", "conformance")], 1, run, skipped);

    expect(run).toHaveBeenCalledTimes(1);
    expect(skipped).toEqual([
      { id: "D1", stage: "dispatch", reason: "needs 2 concurrent sessions, MAX_CONCURRENT allows 1" },
    ]);
  });

  it("names where the budget came from in a skip reason", async () => {
    // "MAX_CONCURRENT is 1" is misleading when the number came from the
    // request body or the risk score. A capacity problem should point at its
    // own cause.
    const skipped: SkippedWork[] = [];
    await dispatch([make("D1", "differential")], 1, async () => undefined, skipped, "the request");
    expect(skipped[0]!.reason).toContain("the request allows 1");
  });

  it("keeps going when one agent dies", async () => {
    // Partial failure is normal with several browsers in flight.
    const skipped: SkippedWork[] = [];
    const run = vi.fn(async (a: Assignment) => {
      if (a.id === "A1") throw new Error("session died");
    });

    await dispatch([make("A1", "conformance"), make("A2", "conformance")], 2, run, skipped);

    expect(run).toHaveBeenCalledTimes(2);
    expect(skipped).toEqual([{ id: "A1", stage: "run", reason: "session died" }]);
  });

  it("drains a queue longer than the budget", async () => {
    const skipped: SkippedWork[] = [];
    const run = vi.fn(async () => undefined);
    const many = Array.from({ length: 9 }, (_, i) => make(`A${i}`, "conformance"));

    await dispatch(many, 2, run, skipped);

    expect(run).toHaveBeenCalledTimes(9);
    expect(skipped).toHaveLength(0);
  });

  it("treats a zero budget as one slot rather than hanging", async () => {
    const skipped: SkippedWork[] = [];
    const run = vi.fn(async () => undefined);
    await dispatch([make("A1", "conformance")], 0, run, skipped);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing with an empty queue", async () => {
    const run = vi.fn(async () => undefined);
    await dispatch([], 4, run, []);
    expect(run).not.toHaveBeenCalled();
  });
});

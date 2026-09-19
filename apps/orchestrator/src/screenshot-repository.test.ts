import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FileScreenshotRepository } from "./screenshot-repository.js";

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aftershock-screenshots-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("FileScreenshotRepository", () => {
  it("stores and loads bytes deterministically across instances", async () => {
    const first = new FileScreenshotRepository(directory);
    const capture = {
      runId: "run-1",
      assignmentId: "assignment-1",
      index: 0,
      body: Uint8Array.from([137, 80, 78, 71]),
    };

    const id = await first.put(capture);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(await first.put(capture)).toBe(id);

    const second = new FileScreenshotRepository(directory);
    expect(await second.get(id)).toEqual(capture.body);
  });

  it("produces different ids for different bodies at the same coordinates", async () => {
    const repository = new FileScreenshotRepository(directory);
    const base = { runId: "run-1", assignmentId: "assignment-1", index: 0 };
    const first = await repository.put({ ...base, body: Uint8Array.from([1]) });
    const second = await repository.put({ ...base, body: Uint8Array.from([2]) });
    expect(first).not.toBe(second);
  });

  it("produces different ids for different step indices", async () => {
    const repository = new FileScreenshotRepository(directory);
    const base = { runId: "run-1", assignmentId: "assignment-1", body: Uint8Array.from([1]) };
    const zero = await repository.put({ ...base, index: 0 });
    const one = await repository.put({ ...base, index: 1 });
    expect(zero).not.toBe(one);
  });

  it("returns undefined for missing and invalid ids", async () => {
    const repository = new FileScreenshotRepository(directory);
    expect(
      await repository.get("0".repeat(64)),
    ).toBeUndefined();
    expect(await repository.get("not-a-hash")).toBeUndefined();
    expect(await repository.get("../traces")).toBeUndefined();
  });
});

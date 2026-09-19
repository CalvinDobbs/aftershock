import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentEvent } from "@aftershock/schema/browser";
import type {
  RecordingDownload,
  ReplayPlaylist,
  SessionReplay,
  SessionReplayService,
} from "@aftershock/browser";

import { InMemoryEventRepository, RunEventStream } from "./event-stream.js";
import { createObservabilityServer } from "./observability-api.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

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

const replay: SessionReplay = {
  pageCount: 1,
  pages: [{ pageId: "0", startTimeMs: 0, endTimeMs: 1000, url: "https://example.com" }],
};

const playlist: ReplayPlaylist = {
  contentType: "application/vnd.apple.mpegurl",
  body: new TextEncoder().encode("#EXTM3U\n"),
};

const downloads: RecordingDownload[] = [
  { pageId: "0", status: "COMPLETED", completedAt: "2026-09-19T12:00:00.000Z", downloadUrl: "https://cdn.example.com/0.mp4" },
];

const replayService: SessionReplayService = {
  retrieve: async () => replay,
  retrievePlaylist: async () => playlist,
  requestDownloads: async () => downloads.map((d) => ({ ...d, status: "PENDING" })),
  listDownloads: async () => downloads,
};

const storedScreenshot = Uint8Array.from([137, 80, 78, 71]);
const screenshotRepository: ScreenshotRepository = {
  put: async () => "a".repeat(64),
  get: async (id) => (id === "a".repeat(64) ? storedScreenshot : undefined),
};

let demoRunResult: { runId: string; assignmentId: string } | undefined;
let canaryRunResult: { runId: string; assignmentId: string } | undefined;
let server: Server;
let noLauncherServer: Server;
let base: string;
let noLauncherBase: string;
const stream = new RunEventStream(new InMemoryEventRepository());

beforeAll(async () => {
  server = createObservabilityServer({
    eventStream: stream,
    replayService,
    screenshotRepository,
    demoRunLauncher: () => demoRunResult,
    noiseCanaryLauncher: () => canaryRunResult,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  noLauncherServer = createObservabilityServer({
    eventStream: stream,
    replayService,
    screenshotRepository,
  });
  await new Promise<void>((resolve) => noLauncherServer.listen(0, "127.0.0.1", resolve));
  noLauncherBase = `http://127.0.0.1:${(noLauncherServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    noLauncherServer.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("observability api", () => {
  it("returns run event history as JSON", async () => {
    await stream.publish(event("run-json", "assignment-1"));
    const response = await fetch(`${base}/api/runs/run-json/events`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.traces.map((trace: { sequence: number }) => trace.sequence)).toEqual([0]);
  });

  it("streams history then live events over SSE without duplicates", async () => {
    await stream.publish(event("run-sse", "assignment-1"));

    const response = await fetch(`${base}/api/runs/run-sse/events/stream`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil("id: 0\n");
    await stream.publish(event("run-sse", "assignment-2"));
    await readUntil("id: 1\n");
    await reader.cancel();

    expect(text).toContain("id: 0\nevent: session.opened\n");
    expect(text).toContain("id: 1\nevent: session.opened\n");
    expect((text.match(/id: 0\n/g) ?? []).length).toBe(1);
    expect((text.match(/id: 1\n/g) ?? []).length).toBe(1);
  });

  it("returns replay metadata", async () => {
    const response = await fetch(`${base}/api/sessions/session-1/replay`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(replay);
  });

  it("returns playlist bytes with content type", async () => {
    const response = await fetch(`${base}/api/sessions/session-1/replay/0/playlist`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("#EXTM3U\n");
  });

  it("requests downloads with 202 and lists downloads", async () => {
    const created = await fetch(`${base}/api/sessions/session-1/recording-downloads`, {
      method: "POST",
    });
    expect(created.status).toBe(202);
    expect((await created.json()).downloads[0].status).toBe("PENDING");

    const listed = await fetch(`${base}/api/sessions/session-1/recording-downloads`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ downloads });
  });

  it("lists run summaries", async () => {
    const response = await fetch(`${base}/api/runs`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.runs)).toBe(true);
    const run = body.runs.find((r: { runId: string }) => r.runId === "run-json");
    expect(run).toMatchObject({
      runId: "run-json",
      status: "running",
      assignmentCount: 1,
      eventCount: 1,
    });
  });

  it("launches demo runs with 202 and rejects concurrent runs with 409", async () => {
    demoRunResult = { runId: "demo-1", assignmentId: "smoke-stagehand" };
    const created = await fetch(`${base}/api/demo/runs`, { method: "POST" });
    expect(created.status).toBe(202);
    expect(await created.json()).toEqual({ run: demoRunResult });

    demoRunResult = undefined;
    const conflict = await fetch(`${base}/api/demo/runs`, { method: "POST" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "A demo run is already active" });
  });

  it("launches the noise canary with 202 and rejects a concurrent one with 409", async () => {
    canaryRunResult = { runId: "canary-1", assignmentId: "noise-canary" };
    const created = await fetch(`${base}/api/demo/canary`, { method: "POST" });
    expect(created.status).toBe(202);
    expect(await created.json()).toEqual({ run: canaryRunResult });

    canaryRunResult = undefined;
    const conflict = await fetch(`${base}/api/demo/canary`, { method: "POST" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "A canary run is already active" });
  });

  it("returns 404 for the canary when no launcher is configured", async () => {
    const response = await fetch(`${noLauncherBase}/api/demo/canary`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("returns 404 for demo runs when no launcher is configured", async () => {
    const response = await fetch(`${noLauncherBase}/api/demo/runs`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("serves stored screenshot bytes with immutable caching", async () => {
    const response = await fetch(`${base}/api/evidence/screenshots/${"a".repeat(64)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(storedScreenshot);
  });

  it("returns 404 for a missing screenshot", async () => {
    const response = await fetch(`${base}/api/evidence/screenshots/${"b".repeat(64)}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("returns 404 for unmatched routes", async () => {
    const response = await fetch(`${base}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});

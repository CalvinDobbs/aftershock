import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentEvent } from "@aftershock/schema";
import type {
  RecordingDownload,
  ReplayPlaylist,
  SessionReplay,
  SessionReplayService,
} from "@aftershock/browser";

import { InMemoryEventRepository, RunEventStream } from "./event-stream.js";
import { createObservabilityServer } from "./observability-api.js";

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

let server: Server;
let base: string;
const stream = new RunEventStream(new InMemoryEventRepository());

beforeAll(async () => {
  server = createObservabilityServer({ eventStream: stream, replayService });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
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

  it("returns 404 for unmatched routes", async () => {
    const response = await fetch(`${base}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});

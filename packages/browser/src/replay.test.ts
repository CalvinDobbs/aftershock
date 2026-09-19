import { describe, expect, it, vi } from "vitest";

import {
  createSessionReplayServiceWithClient,
  type SessionReplayClient,
} from "./replay.js";

function client(overrides?: Partial<SessionReplayClient["sessions"]>): {
  client: SessionReplayClient;
  replays: SessionReplayClient["sessions"]["replays"];
  downloads: SessionReplayClient["sessions"]["recording"]["downloads"];
} {
  const replays = {
    retrieve: vi.fn(async () => ({
      pageCount: 1,
      pages: [{ pageId: "0", startTimeMs: 1, endTimeMs: 2, url: "https://example.com" }],
    })),
    retrievePage: vi.fn(async () => new Response("playlist-bytes", {
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    })),
  };
  const downloads = {
    create: vi.fn(async () => ({
      downloads: [
        { pageId: "0", status: "PENDING" as const },
        {
          pageId: "1",
          status: "COMPLETED" as const,
          completedAt: "2026-09-19T12:00:00.000Z",
          downloadUrl: "https://cdn.example.com/1.mp4",
        },
      ],
    })),
    list: vi.fn(async () => ({
      downloads: [{ pageId: "0", status: "NOT_REQUESTED" as const }],
    })),
  };
  return {
    client: { sessions: { replays, recording: { downloads }, ...overrides } },
    replays,
    downloads,
  };
}

describe("createSessionReplayServiceWithClient", () => {
  it("maps replay pages", async () => {
    const { client: c, replays } = client();
    const service = createSessionReplayServiceWithClient(c);
    const result = await service.retrieve("session-1");
    expect(replays.retrieve).toHaveBeenCalledWith("session-1");
    expect(result).toEqual({
      pageCount: 1,
      pages: [{ pageId: "0", startTimeMs: 1, endTimeMs: 2, url: "https://example.com" }],
    });
  });

  it("returns playlist bytes and content type", async () => {
    const { client: c, replays } = client();
    const service = createSessionReplayServiceWithClient(c);
    const result = await service.retrievePlaylist("session-1", "0");
    expect(replays.retrievePage).toHaveBeenCalledWith("session-1", "0");
    expect(result.contentType).toBe("application/vnd.apple.mpegurl");
    expect(new TextDecoder().decode(result.body)).toBe("playlist-bytes");
  });

  it("falls back to the HLS content type when the header is absent", async () => {
    const { client: c, replays } = client();
    vi.mocked(replays.retrievePage).mockResolvedValueOnce(new Response(new Uint8Array([120])));
    const service = createSessionReplayServiceWithClient(c);
    const result = await service.retrievePlaylist("session-1", "0");
    expect(result.contentType).toBe("application/vnd.apple.mpegurl");
  });

  it("maps downloads and omits absent optional fields", async () => {
    const { client: c } = client();
    const service = createSessionReplayServiceWithClient(c);
    const created = await service.requestDownloads("session-1");
    expect(created[0]).toEqual({ pageId: "0", status: "PENDING" });
    expect("completedAt" in created[0]!).toBe(false);
    expect(created[1]).toEqual({
      pageId: "1",
      status: "COMPLETED",
      completedAt: "2026-09-19T12:00:00.000Z",
      downloadUrl: "https://cdn.example.com/1.mp4",
    });
    expect(await service.listDownloads("session-1")).toEqual([
      { pageId: "0", status: "NOT_REQUESTED" },
    ]);
  });
});

import { Browserbase } from "@browserbasehq/sdk";

export interface ReplayPage {
  pageId: string;
  startTimeMs: number;
  endTimeMs: number;
  url: string;
}

export interface SessionReplay {
  pageCount: number;
  pages: ReplayPage[];
}

export interface ReplayPlaylist {
  contentType: string;
  body: Uint8Array;
}

export interface RecordingDownload {
  pageId: string;
  status: "NOT_REQUESTED" | "PENDING" | "COMPLETED" | "FAILED";
  completedAt?: string;
  downloadUrl?: string;
}

export interface SessionReplayService {
  retrieve(sessionId: string): Promise<SessionReplay>;
  retrievePlaylist(sessionId: string, pageId: string): Promise<ReplayPlaylist>;
  requestDownloads(sessionId: string): Promise<RecordingDownload[]>;
  listDownloads(sessionId: string): Promise<RecordingDownload[]>;
}

export interface ReplayPageResponse {
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface SessionReplayClient {
  sessions: {
    replays: {
      retrieve(id: string): Promise<SessionReplay>;
      retrievePage(id: string, pageId: string): Promise<ReplayPageResponse>;
    };
    recording: {
      downloads: {
        create(id: string): Promise<{ downloads: RecordingDownload[] }>;
        list(id: string): Promise<{ downloads: RecordingDownload[] }>;
      };
    };
  };
}

function mapDownload(download: RecordingDownload): RecordingDownload {
  return {
    pageId: download.pageId,
    status: download.status,
    ...(download.completedAt !== undefined ? { completedAt: download.completedAt } : {}),
    ...(download.downloadUrl !== undefined ? { downloadUrl: download.downloadUrl } : {}),
  };
}

export function createSessionReplayServiceWithClient(
  client: SessionReplayClient,
): SessionReplayService {
  return {
    async retrieve(sessionId) {
      const replay = await client.sessions.replays.retrieve(sessionId);
      return {
        pageCount: replay.pageCount,
        pages: replay.pages.map((page) => ({
          pageId: page.pageId,
          startTimeMs: page.startTimeMs,
          endTimeMs: page.endTimeMs,
          url: page.url,
        })),
      };
    },
    async retrievePlaylist(sessionId, pageId) {
      const response = await client.sessions.replays.retrievePage(sessionId, pageId);
      const contentType =
        response.headers.get("content-type") ?? "application/vnd.apple.mpegurl";
      const body = new Uint8Array(await response.arrayBuffer());
      return { contentType, body };
    },
    async requestDownloads(sessionId) {
      const response = await client.sessions.recording.downloads.create(sessionId);
      return response.downloads.map(mapDownload);
    },
    async listDownloads(sessionId) {
      const response = await client.sessions.recording.downloads.list(sessionId);
      return response.downloads.map(mapDownload);
    },
  };
}

export function createSessionReplayService(browserbaseApiKey: string): SessionReplayService {
  return createSessionReplayServiceWithClient(new Browserbase({ apiKey: browserbaseApiKey }));
}

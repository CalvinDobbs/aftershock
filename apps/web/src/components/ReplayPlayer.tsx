import { useCallback, useEffect, useRef, useState } from "react";

import Hls from "hls.js";

interface ReplayPage {
  pageId: string;
  startTimeMs: number;
  endTimeMs: number;
  url: string;
}

interface SessionReplay {
  pageCount: number;
  pages: ReplayPage[];
}

interface RecordingDownload {
  pageId: string;
  status: "NOT_REQUESTED" | "PENDING" | "COMPLETED" | "FAILED";
  completedAt?: string;
  downloadUrl?: string;
}

interface ReplayPlayerProps {
  sessionId: string;
  ready: boolean;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: string }
      | undefined;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export function ReplayPlayer({ sessionId, ready }: ReplayPlayerProps) {
  const [replay, setReplay] = useState<SessionReplay | undefined>(undefined);
  const [replayError, setReplayError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [selectedPage, setSelectedPage] = useState<string | undefined>(undefined);
  const [downloads, setDownloads] = useState<RecordingDownload[]>([]);
  const [downloadsError, setDownloadsError] = useState<string | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const loadReplay = useCallback(async () => {
    setLoading(true);
    setReplayError(undefined);
    try {
      const data = await fetchJson<SessionReplay>(
        `/api/sessions/${encodeURIComponent(sessionId)}/replay`,
      );
      setReplay(data);
      setSelectedPage((current) => current ?? data.pages[0]?.pageId);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadDownloads = useCallback(async () => {
    try {
      const data = await fetchJson<{ downloads: RecordingDownload[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/recording-downloads`,
      );
      setDownloads(data.downloads);
      setDownloadsError(undefined);
    } catch (error) {
      setDownloadsError(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId]);

  useEffect(() => {
    setReplay(undefined);
    setReplayError(undefined);
    setSelectedPage(undefined);
    setDownloads([]);
    setDownloadsError(undefined);
    setPreparing(false);
  }, [sessionId]);

  useEffect(() => {
    if (!ready) return;
    void loadReplay();
    void loadDownloads();
  }, [ready, loadReplay, loadDownloads]);

  useEffect(() => {
    if (!ready || !downloads.some((download) => download.status === "PENDING")) return;
    const interval = setInterval(() => void loadDownloads(), 3000);
    return () => clearInterval(interval);
  }, [ready, downloads, loadDownloads]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedPage) return;
    const src = `/api/sessions/${encodeURIComponent(sessionId)}/replay/${encodeURIComponent(selectedPage)}/playlist`;
    let hls: Hls | undefined;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    }
    return () => {
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [sessionId, selectedPage]);

  const prepareDownloads = async () => {
    setPreparing(true);
    try {
      const data = await fetchJson<{ downloads: RecordingDownload[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/recording-downloads`,
        { method: "POST" },
      );
      setDownloads(data.downloads);
      setDownloadsError(undefined);
    } catch (error) {
      setDownloadsError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreparing(false);
    }
  };

  if (!ready) {
    return <p className="empty-note">Replay available after session closes</p>;
  }

  return (
    <section className="replay">
      <div className="section-head">
        <h3>Session replay</h3>
      </div>
      {loading && <p className="empty-note">Loading replay…</p>}
      {replayError && (
        <div className="alert">
          <span>Replay is still processing. {replayError}</span>
          <button type="button" onClick={() => void loadReplay()}>
            Retry
          </button>
        </div>
      )}
      {replay && (
        <>
          <div className="page-tabs" role="tablist">
            {replay.pages.map((page) => (
              <button
                key={page.pageId}
                type="button"
                role="tab"
                aria-selected={page.pageId === selectedPage}
                className={page.pageId === selectedPage ? "tab active" : "tab"}
                onClick={() => setSelectedPage(page.pageId)}
                title={page.url}
              >
                Page {page.pageId}
              </button>
            ))}
          </div>
          <video
            ref={videoRef}
            className="replay-video"
            controls
            title={`Replay of session ${sessionId}`}
          />
        </>
      )}
      <div className="mp4-section">
        <div className="section-head">
          <h4>MP4 downloads</h4>
          <div className="mp4-actions">
            <button type="button" onClick={() => void prepareDownloads()} disabled={preparing}>
              {preparing ? "Preparing…" : "Prepare MP4"}
            </button>
            <button type="button" onClick={() => void loadDownloads()} disabled={preparing}>
              Refresh
            </button>
          </div>
        </div>
        {downloadsError && <p className="alert">{downloadsError}</p>}
        {downloads.length === 0 && !downloadsError && (
          <p className="empty-note">No page downloads yet.</p>
        )}
        <ul className="download-list">
          {downloads.map((download) => (
            <li key={download.pageId}>
              <span className="mono">Page {download.pageId}</span>
              <span className={`dl-status dl-${download.status.toLowerCase()}`}>
                {download.status}
              </span>
              {download.status === "COMPLETED" && download.downloadUrl && (
                <a href={download.downloadUrl} target="_blank" rel="noreferrer">
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

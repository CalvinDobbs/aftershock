'use client';

import { useEffect, useRef, useState } from 'react';

type Meta = { pageCount: number; pages: { pageId: string; startTimeMs: number; endTimeMs: number; url: string }[] };

/**
 * Browserbase session replay, streamed as HLS.
 *
 * Both calls go through our own origin: the playlist needs `x-bb-api-key`, so
 * fetching it from the browser would hand the key to every viewer. Our route
 * forwards the `.m3u8` unchanged and the segment URLs inside it are pre-signed
 * CDN links, so video bytes never touch our server.
 *
 * Our agents are single-tab, so we take pages[0].
 */
export function ReplayModal({
  sessionId,
  title,
  onClose,
}: {
  sessionId: string;
  title: string;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let hls: import('hls.js').default | null = null;
    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/replays/${sessionId}`);
      if (!res.ok) {
        setError(
          res.status === 501
            ? 'BROWSERBASE_API_KEY is not set on the web app, so replays cannot be fetched yet.'
            : `Could not load replay metadata (${res.status}).`,
        );
        return;
      }
      const m = (await res.json()) as Meta;
      if (cancelled) return;
      setMeta(m);

      const page = m.pages[0];
      if (!page) {
        setError('This session has no recorded pages.');
        return;
      }

      const src = `/api/replays/${sessionId}/${page.pageId}`;
      const el = video.current;
      if (!el) return;

      // hls.js first, native second. Chromium answers canPlayType() for
      // `application/vnd.apple.mpegurl` with a non-empty "maybe" and then fails
      // the load with MEDIA_ERR_SRC_NOT_SUPPORTED, so asking the browser first
      // sends every non-Safari viewer down a path that cannot work.
      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError(`Playback failed: ${data.details}`);
        });
        return;
      }
      if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = src;
        return;
      }
      setError('This browser cannot play HLS.');
    })().catch((e: unknown) => setError((e as Error).message));

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [sessionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[980px] overflow-hidden rounded-[16px] bg-stage"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-edge px-5 py-3.5">
          <span className="text-[14px]/[1.3] font-medium text-ink-1">{title}</span>
          <span className="mono text-[11.5px]/[1] text-ink-6">{sessionId}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-chip px-3 py-1.5 text-[11.5px]/[1] text-ink-5 hover:text-ink-2"
          >
            Close
          </button>
        </div>

        <div className="bg-shot">
          {error ? (
            <div className="px-6 py-16 text-center">
              <div className="text-[13.5px]/[1.6] text-ink-6">{error}</div>
              <div className="mono mt-2 text-[11.5px]/[1.6] text-ink-8">
                Recordings are retained for 31 days; segment URLs expire after 6 hours.
              </div>
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video ref={video} controls autoPlay playsInline className="block max-h-[62vh] w-full" />
          )}
        </div>

        {meta && (
          <div className="mono px-5 py-3 text-[11px]/[1.5] text-ink-8">
            {meta.pageCount} page{meta.pageCount === 1 ? '' : 's'} recorded · streaming pages[0]
          </div>
        )}
      </div>
    </div>
  );
}

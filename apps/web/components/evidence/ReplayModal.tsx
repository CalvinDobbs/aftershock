'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

type Meta = {
  pageCount: number;
  pages: { pageId: string; startTimeMs: number; endTimeMs: number; url: string }[];
};

/**
 * Browserbase session replay, full size.
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
  subtitle,
  onClose,
}: {
  sessionId: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ready, setReady] = useState(false);

  // Callers pass an inline arrow for onClose, so it changes every render.
  // Holding it in a ref keeps the mount effect from re-running on every SSE
  // tick — which would drag focus back to Close mid-playback and turn Space
  // into "dismiss" instead of "pause".
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = useCallback(() => close.current(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll under an open replay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let hls: import('hls.js').default | null = null;
    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/replays/${sessionId}`);
      if (cancelled) return;
      if (!res.ok) {
        setError(
          res.status === 501
            ? 'No Browserbase key is configured on the dashboard, so recordings cannot be fetched.'
            : `Could not load this recording (${res.status}).`,
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

      const el = video.current;
      if (!el) return;
      el.addEventListener('loadeddata', () => !cancelled && setReady(true), { once: true });

      const src = `/api/replays/${sessionId}/${page.pageId}`;
      const Hls = (await import('hls.js')).default;
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError(`Playback failed: ${data.details}`);
        });
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = src;
      } else {
        setError('This browser cannot play HLS.');
      }
    })().catch((e: unknown) => setError((e as Error).message));

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [sessionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-[10px] sm:p-10"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="land relative flex w-full max-w-[1180px] flex-col overflow-hidden rounded-[18px] bg-stage shadow-[0_40px_120px_-24px_rgba(0,0,0,.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]/[1.3] font-medium text-ink">{title}</div>
            <div className="mono mt-1 truncate text-[11.5px]/[1.3] text-ink-7">
              {subtitle ? `${subtitle} · ` : ''}
              {sessionId}
            </div>
          </div>

          <button
            ref={closeButton}
            type="button"
            onClick={dismiss}
            aria-label="Close recording"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chip text-ink-5 transition-colors hover:bg-[#3a3a3a] hover:text-ink focus-visible:ring-2 focus-visible:ring-amber focus-visible:outline-none"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* 16:10 to match the feed it was opened from, so the frame you clicked
            is the frame you get — just larger. */}
        <div className="relative mx-4 overflow-hidden rounded-[12px] bg-shot" style={{ aspectRatio: '16 / 10' }}>
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
              <div className="text-[13.5px]/[1.6] text-ink-5">{error}</div>
              <div className="mono text-[11.5px]/[1.6] text-ink-8">
                Recordings are kept 31 days; segment links expire after 6 hours.
              </div>
            </div>
          ) : (
            <>
              {!ready && (
                <div className="breathe absolute inset-0 flex items-center justify-center">
                  <span className="mono text-[11.5px]/[1] text-ink-8">loading the recording</span>
                </div>
              )}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={video}
                controls
                autoPlay
                playsInline
                className={clsx(
                  'absolute inset-0 size-full object-contain',
                  ready ? 'reveal' : 'opacity-0',
                )}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-3.5">
          <span className="mono text-[11px]/[1.5] text-ink-8">
            {meta ? `${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'} recorded` : ' '}
          </span>
          <span className="flex-1" />
          <span className="mono text-[11px]/[1.5] text-ink-8">esc to close</span>
        </div>
      </div>
    </div>
  );
}

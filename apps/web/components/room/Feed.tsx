'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Step } from '@aftershock/schema';
import { PageShot } from '@/components/ui/PageShot';
import { Spinner } from '@/components/ui/atoms';

export type FeedState = 'queued' | 'running' | 'passed' | 'failed' | 'errored';

/**
 * One browser, in the thread.
 *
 * The box is a fixed 16:10 and the media is positioned absolutely inside it,
 * so the card is exactly as tall before a recording loads as after. Sizing the
 * frame by the video's own dimensions is what made a row of feeds go ragged as
 * each one arrived at a different moment.
 *
 * A running session shows Browserbase Live View; once it closes there is a
 * recording, so it switches to HLS. Before either exists it draws the step's
 * visible-text digest, which means a feed is never an empty grey rectangle.
 */
export function Feed({
  sessionId,
  state,
  label,
  caption,
  step,
  url,
  onOpen,
}: {
  sessionId: string | null;
  state: FeedState;
  /** Assignment id and progress, e.g. "A1 · 4/7". */
  label: string;
  /** What the browser is doing right now. */
  caption: string;
  step?: Step;
  url?: string;
  onOpen?: () => void;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState<string | null>(null);
  const [playable, setPlayable] = useState(false);

  // Live View while the session is open. Dropping `live` when the session
  // closes is what lets the recording take over — a debugger iframe for a
  // dead session renders, it just shows nothing.
  useEffect(() => {
    if (state !== 'running' || !sessionId) {
      setLive(null);
      setPlayable(false);
      return;
    }
    let ok = true;
    fetch(`/api/sessions/${sessionId}/live`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string } | null) => ok && d?.url && setLive(d.url))
      .catch(() => undefined);
    return () => {
      ok = false;
    };
  }, [state, sessionId]);

  // The recording, once there is one.
  useEffect(() => {
    if (state === 'running' || !sessionId) return;
    let hls: import('hls.js').default | null = null;
    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/replays/${sessionId}`);
      if (!res.ok || cancelled) return;
      const meta = (await res.json()) as { pages: { pageId: string }[] };
      const page = meta.pages[0];
      const el = media.current;
      if (!page || !el || cancelled) return;

      const src = `/api/replays/${sessionId}/${page.pageId}`;
      // Reveal on the first decoded frame, not on attach. Attaching only means
      // the request went out; showing the element then gives a black flash
      // before anything decodes.
      el.addEventListener('loadeddata', () => !cancelled && setPlayable(true), { once: true });

      // Chromium answers canPlayType() for HLS with a non-empty "maybe" and
      // then fails the load, so hls.js is tried first and native is the
      // fallback rather than the other way round.
      const Hls = (await import('hls.js')).default;
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(src);
        hls.attachMedia(el);
      } else {
        el.src = src;
      }
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [state, sessionId]);

  const flagged = state === 'failed' || state === 'errored';
  const pending = state === 'queued';

  return (
    <figure className="m-0 min-w-0">
      <div
        className={clsx(
          'relative w-full overflow-hidden rounded-[9px] bg-shot',
          pending && 'opacity-45',
          onOpen && 'cursor-pointer',
        )}
        style={{ aspectRatio: '16 / 10', outline: flagged ? '1.5px solid var(--color-flare)' : undefined }}
        onClick={onOpen}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onKeyDown={(e) => onOpen && (e.key === 'Enter' || e.key === ' ') && onOpen()}
      >
        {live ? (
          <iframe
            src={live}
            title={`${label} live view`}
            onLoad={() => setPlayable(true)}
            className={clsx(
              'absolute inset-0 size-full border-0',
              playable ? 'reveal' : 'opacity-0',
            )}
            sandbox="allow-same-origin allow-scripts"
          />
        ) : (
          <>
            {/* Always mounted so the box never reflows when playback begins. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={media}
              muted
              autoPlay
              loop
              playsInline
              className={clsx(
                'absolute inset-0 size-full object-cover',
                playable ? 'reveal' : 'opacity-0',
              )}
            />
            {/* Stays mounted under the video and fades out as it arrives, so
                there is never an empty frame between the two. */}
            <div
              className={clsx(
                'absolute inset-0 overflow-hidden transition-opacity duration-500',
                playable ? 'opacity-0' : 'breathe opacity-100',
              )}
            >
              <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="md" />
            </div>
          </>
        )}

        {url && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/70 to-transparent px-2.5 py-1.5">
            <span className="mono truncate text-[9px]/[1.4] text-white/70">{url}</span>
            {state === 'running' && (
              <>
                <span className="flex-1" />
                <span className="blink size-[5px] shrink-0 rounded-full bg-flare" />
                <span className="mono text-[9px]/[1] text-white/70">REC</span>
              </>
            )}
          </div>
        )}
      </div>

      <figcaption className="mt-2 flex items-baseline gap-2">
        {state === 'running' ? <Spinner size={9} /> : null}
        <span
          className={clsx(
            'mono shrink-0 text-[10.5px]/[1]',
            flagged
              ? 'text-alarm'
              : state === 'running'
                ? 'text-amber'
                : pending
                  ? 'text-ink-8'
                  : 'text-ink-7',
          )}
        >
          {label}
        </span>
        <span className="truncate text-[11.5px]/[1.4] text-ink-8">{caption}</span>
      </figcaption>
    </figure>
  );
}

/** Up to three browsers abreast. Parallelism has to be visible at a glance. */
export function FeedGrid({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div
      className="mt-2.5 grid gap-2.5"
      style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, count))}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

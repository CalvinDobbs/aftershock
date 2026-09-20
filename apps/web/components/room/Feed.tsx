'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Step } from '@aftershock/schema';
import { PageShot } from '@/components/ui/PageShot';
import { Developing } from '@/components/ui/Developing';
import { Spinner } from '@/components/ui/atoms';
import { useHlsVideo, useNearViewport } from '@/lib/useHlsVideo';

export type FeedState = 'queued' | 'running' | 'passed' | 'failed' | 'errored' | 'skipped';

/**
 * One browser, in the thread.
 *
 * The box is a fixed 16:10 and the media is positioned absolutely inside it,
 * so the card is exactly as tall before a recording loads as after. Sizing the
 * frame by the video's own dimensions is what made a row of feeds go ragged as
 * each one arrived at a different moment.
 *
 * A running session shows Browserbase Live View; once it closes there is a
 * recording, so it switches to buffered HLS. Before either exists it draws the
 * step's visible-text digest, which means a feed is never an empty rectangle.
 *
 * **Recordings load only once the card is near the viewport.** A run has seven
 * of them and fetching all seven at once made the whole room stutter while
 * they competed for bandwidth — the cost of the ones you had not scrolled to
 * yet was paid by the one you were looking at.
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
  const { ref: box, near, visible } = useNearViewport<HTMLDivElement>();
  const [live, setLive] = useState<string | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);

  const recorded = state !== 'running' && !!sessionId;
  const { ref: media, painted, progress, error } = useHlsVideo(recorded ? sessionId : null, near, {
    loop: true,
  });

  // A recording that never starts arriving must not leave the frame blurred
  // forever. Recordings expire after 31 days and their segment links after
  // six hours, so "no clip" is a normal end state, not an exception — and the
  // screenshot underneath is still perfectly good evidence.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    setGaveUp(false);
    if (!recorded || !near) return;
    const t = setTimeout(() => setGaveUp(true), 9000);
    return () => clearTimeout(t);
  }, [recorded, near, sessionId]);
  // Progress resets the clock: something is arriving, so keep waiting.
  useEffect(() => {
    if (progress > 0) setGaveUp(false);
  }, [progress]);

  const developing = recorded && near && !error && !gaveUp;

  // Live View while the session is open. Dropping `live` when the session
  // closes is what lets the recording take over — a debugger iframe for a
  // dead session renders, it just shows nothing.
  useEffect(() => {
    if (state !== 'running' || !sessionId) {
      setLive(null);
      setLiveLoaded(false);
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

  // The hook starts playback itself, hidden, so the clip is past its blank
  // opening frames before anyone sees it. All that is left here is not
  // leaving six decoders running for nobody once it is off screen.
  useEffect(() => {
    const el = media.current;
    if (!el || !painted) return;
    if (visible) void el.play().catch(() => undefined);
    else el.pause();
  }, [painted, visible, media]);

  const flagged = state === 'failed' || state === 'errored';
  // Queued and skipped both dim: one has not run, the other ran and was
  // never graded. The caption tells them apart; the frame should not pretend.
  const pending = state === 'queued' || state === 'skipped';

  return (
    <figure className="m-0 min-w-0">
      <div
        ref={box}
        className={clsx(
          'group relative w-full overflow-hidden rounded-[9px] bg-shot',
          pending && 'opacity-45',
          onOpen && 'cursor-zoom-in',
        )}
        style={{ aspectRatio: '16 / 10', outline: flagged ? '1.5px solid var(--color-flare)' : undefined }}
        onClick={onOpen}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? `Expand ${label}` : undefined}
        onKeyDown={(e) => onOpen && (e.key === 'Enter' || e.key === ' ') && onOpen()}
      >
        {live ? (
          <iframe
            src={live}
            title={`${label} live view`}
            onLoad={() => setLiveLoaded(true)}
            className={clsx('absolute inset-0 size-full border-0', liveLoaded ? 'reveal' : 'opacity-0')}
            sandbox="allow-same-origin allow-scripts"
          />
        ) : (
          <>
            {/* Always mounted so the box never reflows when playback begins. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={media}
              muted
              playsInline
              preload="auto"
              className={clsx(
                'absolute inset-0 size-full object-cover',
                painted ? 'reveal' : 'opacity-0',
              )}
            />
            {/* The captured frame. It develops while a clip is on its way and
                otherwise just sits there sharp — a frame nobody is waiting on
                should not look like one that is loading. */}
            {!painted &&
              (developing ? (
                <Developing progress={progress} compact>
                  <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="md" />
                </Developing>
              ) : (
                <div className="absolute inset-0 overflow-hidden">
                  <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="md" />
                </div>
              ))}
          </>
        )}

        {onOpen && (
          <span className="pointer-events-none absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white/80 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {url && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/70 to-transparent px-2.5 py-1.5">
            <span className="mono truncate text-[10px]/[1.4] text-white/75">{url}</span>
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

      <figcaption className="mt-2.5 flex items-baseline gap-2">
        {state === 'running' ? <Spinner size={9} /> : null}
        <span
          className={clsx(
            'mono shrink-0 text-[11.5px]/[1]',
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
        <span className="truncate text-[12.5px]/[1.4] text-ink-8">{caption}</span>
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

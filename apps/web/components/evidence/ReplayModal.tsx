'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Step } from '@aftershock/schema';
import { Lightbox } from '@/components/ui/Lightbox';
import { Developing } from '@/components/ui/Developing';
import { PageShot } from '@/components/ui/PageShot';
import { useHlsVideo } from '@/lib/useHlsVideo';

/**
 * A Browserbase session recording, full size.
 *
 * The clip buffers before it is shown — see `useHlsVideo` — so opening one
 * never gives you a stuttering first two seconds. Until it is ready the frame
 * the agent captured develops in place, which means the box is never empty and
 * never changes size.
 */
export function ReplayModal({
  sessionId,
  title,
  subtitle,
  step,
  onClose,
}: {
  sessionId: string;
  title: string;
  subtitle?: string;
  /** The frame to develop while the recording buffers. */
  step?: Step;
  onClose: () => void;
}) {
  const { ref, painted, progress, error } = useHlsVideo(sessionId, true);
  const [pages, setPages] = useState<number | null>(null);
  // As in the feed: a clip that never arrives leaves the captured frame sharp
  // rather than blurred behind a progress bar that will never fill.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 9000);
    return () => clearTimeout(t);
  }, [sessionId]);
  useEffect(() => {
    if (progress > 0) setGaveUp(false);
  }, [progress]);

  useEffect(() => {
    let ok = true;
    fetch(`/api/replays/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { pageCount?: number } | null) => ok && m && setPages(m.pageCount ?? null))
      .catch(() => undefined);
    return () => {
      ok = false;
    };
  }, [sessionId]);

  return (
    <Lightbox
      title={title}
      subtitle={`${subtitle ? `${subtitle} · ` : ''}${sessionId}`}
      onClose={onClose}
      footer={
        <span className="mono text-[11px]/[1.5] text-ink-8">
          {error ? 'recording unavailable' : pages ? `${pages} page${pages === 1 ? '' : 's'} recorded` : ' '}
        </span>
      }
    >
      {/* 16:10 to match the feed it was opened from, so the frame you clicked
          is the frame you get — just larger. */}
      {/* Fills whatever the shell gives it; the video letterboxes itself with
          object-contain. Deriving the box from an aspect ratio instead meant
          depending on a definite parent height, and inside a flex column that
          resolved to zero. */}
      <div className="group/media relative w-full flex-1 overflow-hidden rounded-[12px] bg-shot">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <div className="text-[13.5px]/[1.6] text-ink-5">{error}</div>
            <div className="mono text-[11.5px]/[1.6] text-ink-8">
              Recordings are kept 31 days; segment links expire after 6 hours.
            </div>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            {/* Muted so autoplay is permitted: these recordings have no audio,
                and a clip that opens paused on a blank first frame looks
                broken. */}
            <video
              ref={ref}
              controls
              muted
              playsInline
              preload="auto"
              className={clsx(
                'absolute inset-0 size-full object-contain',
                painted ? 'reveal' : 'opacity-0',
              )}
            />
            {painted && (
              <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/55 px-2.5 py-[5px] text-[10.5px]/[1] text-white/70 opacity-100 backdrop-blur-sm transition-opacity duration-300 group-hover/media:opacity-0">
                hover to scrub
              </span>
            )}
            {!painted &&
              (gaveUp ? (
                <div className="absolute inset-0 overflow-hidden">
                  <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="lg" />
                </div>
              ) : (
                <Developing progress={progress}>
                  <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="lg" />
                </Developing>
              ))}
          </>
        )}
      </div>
    </Lightbox>
  );
}

/**
 * A single captured frame, full size.
 *
 * Screenshots used to be the one piece of evidence you could not enlarge,
 * which made the small ones decorative. They open the same way recordings do,
 * from the same shell, so "click the evidence" is one rule rather than two.
 */
export function ShotModal({
  step,
  title,
  subtitle,
  onClose,
}: {
  step?: Step;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <Lightbox title={title} subtitle={subtitle} onClose={onClose}>
      <div className="relative w-full flex-1 overflow-hidden rounded-[12px] bg-shot">
        <div className="reveal absolute inset-0 overflow-auto">
          <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="lg" />
        </div>
      </div>
    </Lightbox>
  );
}

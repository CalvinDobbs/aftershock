'use client';

import { useEffect, useRef, useState } from 'react';

export type HlsState = {
  /** Attach to the <video>. */
  ref: React.RefObject<HTMLVideoElement | null>;
  /** True once enough is buffered to play through without stalling. */
  ready: boolean;
  /** 0–1, how much of the clip is buffered. Drives the developing animation. */
  progress: number;
  error: string | null;
};

/**
 * A Browserbase recording, buffered before it is ever shown.
 *
 * Playback used to begin on `loadeddata`, which fires as soon as one frame
 * exists. With seven recordings on screen that meant seven videos all starting
 * on their first frame and then stalling on every segment boundary — the
 * choppiness was the player racing its own download. Here nothing is revealed
 * until `canplaythrough`, so a clip that appears plays start to finish.
 *
 * `enabled` is how the room avoids paying for all of them at once: feeds pass
 * their own visibility, so only recordings actually on screen fetch anything.
 *
 * Both requests go through our origin — the playlist needs `x-bb-api-key`, and
 * fetching it from the browser would hand the key to every viewer. The segment
 * URLs inside the playlist are pre-signed CDN links, so video bytes stream
 * direct and never touch our server.
 */
export function useHlsVideo(sessionId: string | null, enabled: boolean): HlsState {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    let hls: import('hls.js').default | null = null;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const done = () => {
      if (cancelled) return;
      setProgress(1);
      setReady(true);
    };

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
      const meta = (await res.json()) as { pages?: { pageId: string }[] };
      if (cancelled) return;

      const page = meta.pages?.[0];
      if (!page) {
        setError('This session has no recorded pages.');
        return;
      }
      const el = ref.current;
      if (!el) return;

      // canplaythrough is the browser's own "I can finish this without
      // stalling". loadeddata would only mean one frame decoded.
      el.addEventListener('canplaythrough', done, { once: true });
      // Belt and braces: some builds never fire canplaythrough for a short
      // VOD playlist. A clip that is fully buffered is ready whatever the
      // event log says, and a visible recording beats a perfect state machine.
      poll = setInterval(() => {
        const v = ref.current;
        if (!v || cancelled) return;
        const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
        const total = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        if (total) {
          const frac = Math.min(1, end / total);
          setProgress(frac);
          if (frac > 0.985) done();
        } else if (end > 0) {
          // Duration unknown: show motion rather than a frozen bar.
          setProgress((p) => Math.min(0.9, p + 0.05));
        }
      }, 250);

      const src = `/api/replays/${sessionId}/${page.pageId}`;
      const Hls = (await import('hls.js')).default;
      if (cancelled) return;

      if (Hls.isSupported()) {
        // Buffer the whole clip up front. These recordings are seconds long,
        // so holding all of it costs little and removes every mid-clip stall.
        hls = new Hls({ enableWorker: true, maxBufferLength: 90, backBufferLength: 90 });
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal && !cancelled) setError(`Playback failed: ${data.details}`);
        });
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        // Chromium answers canPlayType() for HLS with a non-empty "maybe" and
        // then fails the load, so hls.js is tried first and native is the
        // fallback rather than the other way round.
        el.src = src;
      } else {
        setError('This browser cannot play HLS.');
      }
    })().catch((e: unknown) => !cancelled && setError((e as Error).message));

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      ref.current?.removeEventListener('canplaythrough', done);
      hls?.destroy();
    };
  }, [sessionId, enabled]);

  return { ref, ready, progress, error };
}

/**
 * Whether an element is close enough to the viewport to be worth loading.
 *
 * Latches on: once a recording has been fetched, scrolling past it should not
 * throw the buffer away and re-download it when you scroll back.
 */
export function useNearViewport<T extends HTMLElement>(margin = '300px') {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        // `near` latches: having paid to download a clip, scrolling past it
        // and back should not pay again. `visible` does not, because whether
        // something should be *playing* is a question about right now.
        if (on) setNear(true);
        setVisible(on);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);

  return { ref, near, visible };
}

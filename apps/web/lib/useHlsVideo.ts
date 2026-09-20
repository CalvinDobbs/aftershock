'use client';

import { useEffect, useRef, useState } from 'react';

export type HlsState = {
  /** Attach to the <video>. */
  ref: React.RefObject<HTMLVideoElement | null>;
  /** Buffered enough to play through without stalling. */
  ready: boolean;
  /**
   * A real frame of the page is on screen. This — not `ready` — is when the
   * video should be revealed. See below.
   */
  painted: boolean;
  /** 0–1, how much of the clip is buffered. Drives the developing animation. */
  progress: number;
  error: string | null;
};

/**
 * How much to cut off each end of a recording.
 *
 * A Browserbase session is recorded from the moment the browser exists, which
 * is before the first navigation resolves and after the last page is torn
 * down — so roughly half a second of genuine black sits at both ends of every
 * clip. There is nothing to buffer harder: the black *is* the recording.
 *
 * Proportional with a ceiling, so a three-second clip is not mostly trimmed.
 */
const TRIM = (duration: number) =>
  Math.min(0.55, (Number.isFinite(duration) && duration > 0 ? duration : 4) * 0.07);

/** The playable window of a clip, with both dead ends removed. */
export function trimmed(el: HTMLVideoElement): { from: number; to: number } {
  const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
  if (!d) return { from: 0, to: 0 };
  const t = TRIM(d);
  return { from: t, to: Math.max(t + 0.1, d - t) };
}

/**
 * A Browserbase recording, buffered *and* warmed before it is ever shown.
 *
 * Two separate problems produced the same symptom, and fixing only one left
 * the other:
 *
 * 1. Playback used to begin on `loadeddata`, which fires as soon as a single
 *    frame exists. Six clips then all started at once and stalled at every
 *    segment boundary — the choppiness was the player racing its own
 *    download. `canplaythrough` fixes that.
 *
 * 2. `canplaythrough` still means "ready to start", and a session recording
 *    *starts on a blank page*: the browser is up before the first navigation
 *    resolves, so frame zero is genuinely black. Revealing at `ready` showed
 *    that black frame. There is nothing to buffer harder — the frame is the
 *    recording.
 *
 * So the clip is played, muted and hidden, until a frame has actually been
 * presented past a small offset; only then is it revealed. The captured
 * screenshot stays on top for that whole time, which means the transition a
 * viewer sees is developed-frame → live page, and never a black rectangle.
 *
 * `enabled` gates the download: feeds pass their own visibility, so a run with
 * seven recordings does not fetch all seven before you have scrolled to them.
 *
 * Both requests go through our origin — the playlist needs `x-bb-api-key`, and
 * fetching it from the browser would hand the key to every viewer. The segment
 * URLs inside are pre-signed CDN links, so video bytes stream direct.
 */
export function useHlsVideo(
  sessionId: string | null,
  enabled: boolean,
  { loop = false }: { loop?: boolean } = {},
): HlsState {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [painted, setPainted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReady(false);
    setPainted(false);
    setProgress(0);
    setError(null);
    if (!sessionId || !enabled) return;

    let hls: import('hls.js').default | null = null;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let paintGuard: ReturnType<typeof setTimeout> | null = null;
    const cleanups: (() => void)[] = [];

    const reveal = () => {
      if (cancelled) return;
      setPainted(true);
    };

    /**
     * Seek past the dead opening, play hidden, and reveal on the first frame
     * actually presented. `loop` then keeps playback inside the trimmed
     * window, so the black tail is never reached either.
     */
    const warm = (el: HTMLVideoElement) => {
      const { from, to } = trimmed(el);
      if (from > 0 && el.currentTime < from) el.currentTime = from;
      el.muted = true;
      void el.play().catch(() => undefined);

      const onTime = () => {
        if (cancelled || !to) return;
        if (el.currentTime >= to) {
          if (loop) el.currentTime = from;
          else el.pause();
        }
      };
      el.addEventListener('timeupdate', onTime);
      cleanups.push(() => el.removeEventListener('timeupdate', onTime));

      type WithRvfc = HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      };
      const rvfc = (el as WithRvfc).requestVideoFrameCallback?.bind(el);

      if (rvfc) {
        // Fires per *presented* frame — the only real signal that something
        // has been painted rather than merely decoded.
        const tick = (_now: number, meta: { mediaTime: number }) => {
          if (cancelled) return;
          if (meta.mediaTime >= from) reveal();
          else rvfc(tick);
        };
        rvfc(tick);
      } else {
        const onPaint = () => {
          if (cancelled) return;
          if (el.currentTime >= from) {
            el.removeEventListener('timeupdate', onPaint);
            reveal();
          }
        };
        el.addEventListener('timeupdate', onPaint);
        cleanups.push(() => el.removeEventListener('timeupdate', onPaint));
      }

      // Autoplay can be refused, and a clip nobody will ever paint must still
      // appear. Showing a frame late beats showing nothing forever.
      paintGuard = setTimeout(reveal, 2600);
    };

    const buffered = () => {
      if (cancelled) return;
      setProgress(1);
      setReady(true);
      const el = ref.current;
      if (el) warm(el);
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

      el.addEventListener('canplaythrough', buffered, { once: true });
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
          setProgress((p) => (frac > p ? frac : p));
          if (frac > 0.985) buffered();
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
      if (paintGuard) clearTimeout(paintGuard);
      for (const off of cleanups) off();
      ref.current?.removeEventListener('canplaythrough', buffered);
      hls?.destroy();
    };
  }, [sessionId, enabled, loop]);

  return { ref, ready, painted, progress, error };
}

/**
 * Whether an element is near enough the viewport to load, and whether it is
 * on screen right now.
 *
 * `near` latches: having paid to download a clip, scrolling past it and back
 * should not pay again. `visible` does not, because whether something should
 * be *playing* is a question about right now.
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

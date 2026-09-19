'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './PrototypeReplay.module.css';

type ReplayMeta = {
  pageCount: number;
  pages: { pageId: string; startTimeMs: number; endTimeMs: number; url: string }[];
};

export type FeedStatus = 'running' | 'finding' | 'passed' | 'verified';

export function PrototypeReplay({
  sessionId,
  active,
  title,
  currentAction,
  progressLabel,
  status,
  className,
}: {
  sessionId: string;
  active: boolean;
  title: string;
  currentAction: string;
  progressLabel: string;
  status: FeedStatus;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) return;
    let hls: import('hls.js').default | null = null;
    let cancelled = false;

    const onEnded = () => {
      const el = video.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => undefined);
      }
    };

    (async () => {
      const res = await fetch(`/api/replays/${sessionId}`);
      if (!res.ok) {
        setError(`Replay unavailable (${res.status})`);
        return;
      }
      const meta = (await res.json()) as ReplayMeta;
      if (cancelled) return;
      const page = meta.pages[0];
      if (!page) {
        setError('No recorded pages');
        return;
      }
      const src = `/api/replays/${sessionId}/${page.pageId}`;
      const el = video.current;
      if (!el) return;
      el.addEventListener('ended', onEnded);

      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setReady(true);
          el.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError(`Playback failed: ${data.details}`);
        });
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = src;
        el.addEventListener(
          'loadedmetadata',
          () => {
            setReady(true);
            el.play().catch(() => undefined);
          },
          { once: true },
        );
      } else {
        setError('This browser cannot play HLS.');
      }
    })().catch((e: unknown) => {
      if (!cancelled) setError((e as Error).message);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
      const el = video.current;
      if (el) {
        el.removeEventListener('ended', onEnded);
        el.removeAttribute('src');
        el.load();
      }
    };
  }, [sessionId, active]);

  const statusLabel =
    status === 'running' ? 'FEED' : status === 'finding' ? 'FINDING' : status === 'passed' ? 'PASSED' : 'VERIFIED';

  return (
    <div className={`${styles.feed} ${className ?? ''}`}>
      <div className={styles.frame}>
        <div className={styles.chrome}>
          <span className={styles.dots} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className={styles.title}>{title}</span>
          <span className={styles.address}>saucedemo.com</span>
          <span className={`${styles.liveDot} ${status !== 'running' ? styles.liveDotDone : ''}`} aria-hidden />
          <span
            className={`${styles.chromeLabel} ${
              status === 'finding'
                ? styles.chromeAlarm
                : status === 'passed' || status === 'verified'
                  ? styles.chromeGood
                  : ''
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <div className={styles.viewport}>
          {!ready && !error && <div className={styles.status}>Connecting to session…</div>}
          {error && <div className={styles.error}>{error}</div>}
          <video ref={video} muted autoPlay loop playsInline title={`${title} replay`} />
          <div className={styles.overlay}>
            <span className={styles.overlayAction}>{currentAction}</span>
            <span className={styles.overlayStep}>{progressLabel}</span>
          </div>
        </div>
      </div>
      <div className={styles.foot}>
        <span>Recorded session</span>
        <a
          href={`https://www.browserbase.com/sessions/${sessionId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open evidence ↗
        </a>
      </div>
    </div>
  );
}

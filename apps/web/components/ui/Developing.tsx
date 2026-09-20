'use client';

/**
 * What sits in a media box while its recording buffers.
 *
 * The frame we already have — the step's screenshot or its visible-text
 * digest — is shown blurred, and sharpens from the top down as the clip
 * buffers, with a lit edge at the boundary. So the placeholder is the same
 * evidence the recording is about rather than a grey rectangle, and the
 * progress is the real buffered fraction rather than a spinner that means
 * nothing.
 *
 * It resolves downward at the pace of the download, which is why it reads as
 * something developing rather than something loading.
 */
export function Developing({
  progress,
  children,
  compact = false,
}: {
  /** 0–1, the buffered fraction. */
  progress: number;
  /** The frame to develop — a PageShot, usually. */
  children: React.ReactNode;
  /** Drop the caption in small boxes, where it would crowd the frame. */
  compact?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Unresolved: blurred, dimmed, and very slightly larger so the two
          layers never show a seam at the edges. */}
      <div
        className="absolute inset-0 scale-[1.04] opacity-70"
        style={{ filter: 'blur(9px) saturate(.55)' }}
        aria-hidden
      >
        {children}
      </div>

      {/* Resolved: the same frame, sharp, revealed top-down. */}
      <div
        className="absolute inset-0 transition-[clip-path] duration-500 ease-out"
        style={{ clipPath: `inset(0 0 ${100 - pct}% 0)` }}
        aria-hidden
      >
        {children}
      </div>

      {/* The lit edge where it is resolving. Hidden at the ends so a finished
          or unstarted clip has no stray line across it. */}
      {pct > 1 && pct < 99 && (
        <div
          className="pointer-events-none absolute inset-x-0 transition-[top] duration-500 ease-out"
          style={{ top: `${pct}%` }}
        >
          <div className="h-px w-full bg-amber/80" />
          <div className="h-8 w-full bg-gradient-to-b from-amber/18 to-transparent" />
        </div>
      )}

      {!compact && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 pb-2.5">
          <span className="relative block h-[3px] flex-1 overflow-hidden rounded-full bg-white/12">
            <span
              className="absolute inset-y-0 left-0 block rounded-full bg-amber transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="mono shrink-0 text-[9.5px]/[1] text-white/55">
            {pct < 99 ? `${Math.round(pct)}%` : 'ready'}
          </span>
        </div>
      )}
    </div>
  );
}

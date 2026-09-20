'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The shell every expanded piece of evidence opens into.
 *
 * **It renders through a portal into `document.body`, and that is the whole
 * point.** `position: fixed` resolves against the nearest ancestor with a
 * transform, filter or backdrop-filter rather than against the viewport, and
 * the room is full of them — every message carries `.land`, which animates a
 * translate. A modal rendered in place therefore centred itself inside the
 * message it came from instead of inside the window. Portalling to the body
 * puts it outside all of them, so "centre" means the screen.
 *
 * It also owns the things a dialog has to get right and that are easy to get
 * wrong once per modal: escape to close, a locked background, focus moved in
 * and handed back on close, and a backdrop click that does not fire when the
 * pointer started inside the panel.
 */
export function Lightbox({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  // Callers pass an inline arrow, so it is a new function every render.
  // Holding it in a ref keeps the mount effect from re-running on every SSE
  // tick — which would drag focus back to Close mid-playback and turn Space
  // into "dismiss" instead of "pause".
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = useCallback(() => close.current(), []);

  // A portal has no server-side target, so the first client render has to
  // match the server's empty one.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const returnTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      returnTo?.focus?.();
    };
  }, [mounted]);

  // A drag that starts on the panel and releases on the backdrop — scrubbing
  // a video is exactly this — must not count as a click outside.
  const downOnBackdrop = useRef(false);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[10px] sm:p-8"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) dismiss();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* A definite height, not `max-h-full`. The media inside is absolutely
          positioned and so contributes no intrinsic height — with only a
          maximum, the panel collapsed to its own header and footer and the
          frame rendered 0px tall. */}
      <div className="pop flex h-full w-full max-w-[1180px] flex-col overflow-hidden rounded-[18px] bg-stage shadow-[0_40px_120px_-24px_rgba(0,0,0,.9)]">
        <div className="flex flex-none items-center gap-3 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]/[1.3] font-medium text-ink">{title}</div>
            {subtitle && (
              <div className="mono mt-1 truncate text-[11.5px]/[1.3] text-ink-7">{subtitle}</div>
            )}
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chip text-ink-5 transition-colors hover:bg-[#3a3a3a] hover:text-ink focus-visible:ring-2 focus-visible:ring-amber focus-visible:outline-none"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Never scrolls: an expanded frame that needs a scrollbar to be seen
            whole is not expanded. Children stretch to fill this — no
            `items-center`, which would collapse a percentage height to zero —
            and letterbox themselves inside it. */}
        <div className="flex min-h-0 flex-1 overflow-hidden px-4 pb-1">{children}</div>

        <div className="flex flex-none items-center gap-3 px-6 py-3.5">
          {footer}
          <span className="flex-1" />
          <span className="mono text-[11px]/[1.5] text-ink-8">esc to close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

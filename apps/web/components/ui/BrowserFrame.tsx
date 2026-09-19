import clsx from 'clsx';

/** Dark chrome around a page render. `flagged` outlines the frame in vermilion. */
export function BrowserFrame({
  url,
  flagged = false,
  live = false,
  rec,
  cursor,
  dots = 3,
  radius = 9,
  children,
}: {
  url?: string;
  flagged?: boolean;
  live?: boolean;
  /** Elapsed recording time, e.g. "0:19". Shows a blinking REC chip. */
  rec?: string;
  /** Where the agent is about to click, as CSS percentages. */
  cursor?: { left: string; top: string };
  dots?: 2 | 3;
  radius?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden bg-shot"
      style={{ borderRadius: radius, outline: flagged ? '1.5px solid var(--color-flare)' : undefined }}
    >
      <div className="flex items-center gap-[5px] bg-edge-2 px-[9px] py-[7px]">
        {Array.from({ length: dots }).map((_, i) => (
          <span key={i} className="block size-[7px] rounded-full bg-[#3a3a3a]" />
        ))}
        {url && (
          <span className="mono ml-[5px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] bg-[#161616] px-[7px] py-[2px] text-[8.5px]/[1.7] text-ink-6">
            {url}
          </span>
        )}
        {rec && (
          <span className="ml-1 flex items-center gap-1">
            <span className="blink block size-[6px] rounded-full bg-flare" />
            <span className="mono text-[8.5px]/[1] text-ink-7">REC {rec}</span>
          </span>
        )}
      </div>

      <div className={clsx('relative overflow-hidden', live && 'isolate')}>
        {children}
        {live && (
          <>
            <span
              className="scanline absolute inset-x-0 top-0 block h-[18px]"
              style={{ background: 'linear-gradient(rgba(255,255,255,0),rgba(20,22,26,.08))' }}
            />
            {cursor && (
              <span
                className="absolute block size-0"
                style={{
                  left: cursor.left,
                  top: cursor.top,
                  borderLeft: '7px solid var(--color-amber)',
                  borderTop: '5px solid transparent',
                  borderBottom: '5px solid transparent',
                  transform: 'rotate(28deg)',
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

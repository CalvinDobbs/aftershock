import clsx from 'clsx';

/** Amber ring spinner — "working". Never used for a failure. */
export function Spinner({ size = 11 }: { size?: number }) {
  return (
    <span
      className="spin block rounded-full border-amber border-r-transparent"
      style={{ width: size, height: size, borderWidth: 1.6 }}
    />
  );
}

export function StatePill({ state }: { state: 'working' | 'finished' | 'failed' | 'queued' }) {
  if (state === 'working') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-sunk px-2.5 py-1">
        <Spinner />
        <span className="text-[11.5px]/[1] font-medium text-amber">Working</span>
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-[#2a1512] px-2.5 py-1">
        <span className="block size-[6px] rounded-full bg-flare" />
        <span className="text-[11.5px]/[1] font-medium text-alarm">Failed</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-chip px-2.5 py-1">
      <span className="block size-[6px] rounded-full bg-ink-9" />
      <span className="text-[11.5px]/[1] font-medium text-ink-5">
        {state === 'queued' ? 'Queued' : 'Finished'}
      </span>
    </span>
  );
}

export function LiveDot() {
  return <span className="blink block size-[6px] rounded-full bg-amber" />;
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx('mono rounded-full bg-bubble px-3 py-[7px] text-[11.5px]/[1] text-ink-5', className)}
    >
      {children}
    </span>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={clsx('text-[11px]/[1] font-medium text-ink-8', className)}
      style={{ letterSpacing: '.05em' }}
    >
      {children}
    </div>
  );
}

/** A text caret that blinks, for a bot mid-sentence. */
export function Caret({ h = 15, w = 7 }: { h?: number; w?: number }) {
  return (
    <span
      className="caret ml-[3px] inline-block align-[-2px] bg-ink-2"
      style={{ width: w, height: h }}
    />
  );
}

/** Recording scrubber with step ticks and an amber playhead. */
export function Scrubber({
  duration,
  steps,
  position = 0.78,
}: {
  duration: string;
  steps: number;
  position?: number;
}) {
  return (
    <div className="flex items-center gap-[11px] px-[3px]">
      <span className="mono text-[11px]/[1] text-ink-6">0:00</span>
      <span className="relative block h-[3px] flex-1 rounded-[2px] bg-[#2c2c2c]">
        <span
          className="absolute inset-y-0 left-0 block rounded-[2px] bg-[#565656]"
          style={{ right: `${Math.round((1 - position) * 100)}%` }}
        />
        {Array.from({ length: Math.max(0, steps - 1) }).map((_, i) => (
          <span
            key={i}
            className="absolute -top-[2px] block h-[7px] w-[1.5px] bg-[#3e3e3e]"
            style={{ left: `${((i + 1) / steps) * 100}%` }}
          />
        ))}
        <span
          className="absolute -top-[4px] -ml-[5px] block size-[10px] rounded-full bg-amber"
          style={{ left: `${position * 100}%` }}
        />
      </span>
      <span className="mono text-[11px]/[1] text-ink-6">{duration}</span>
    </div>
  );
}

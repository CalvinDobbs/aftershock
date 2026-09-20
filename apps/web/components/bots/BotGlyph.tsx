import type { BotId } from './registry';

/**
 * A mark for what each agent *does*, drawn rather than borrowed.
 *
 * These were emoji. Emoji are somebody else's drawings: they arrive in a
 * different style on every platform, they render at a different weight to
 * everything around them, and a row of them reads as decoration stuck onto an
 * interface rather than as part of one. The faces in this product are
 * geometric monoline shapes, so their marks are too — same stroke, same
 * rounded caps, same 16-unit grid.
 *
 * Each one is the job, not a mascot: a diff, a check, two overlapping
 * sessions, a balance, a magnifier, a plaster, a mixing desk.
 */
export function BotGlyph({
  bot,
  size = 15,
  className,
  style,
}: {
  bot: BotId;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const S = {
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  const marks: Record<BotId, React.ReactNode> = {
    // A mixing desk: the Director sets the levels and starts everything.
    maestro: (
      <>
        <path d="M4 2.5v11M8 2.5v11M12 2.5v11" {...S} />
        <circle cx="4" cy="5.5" r="1.5" {...S} />
        <circle cx="8" cy="10" r="1.5" {...S} />
        <circle cx="12" cy="6.5" r="1.5" {...S} />
      </>
    ),
    // A diff: one line removed, one added.
    diffany: (
      <>
        <path d="M2.5 5h5" {...S} />
        <path d="M2.5 11h5M5 8.5v5" {...S} />
        <path d="M10.5 5h3M10.5 8h3M10.5 11h3" {...S} strokeWidth={1.2} opacity={0.5} />
      </>
    ),
    // A check, because that is the whole job: does it do what it says.
    qaizen: <path d="M2.5 8.5l3.4 3.4L13.5 4.3" {...S} strokeWidth={1.7} />,
    // Two sessions running the same script, overlapping.
    doppler: (
      <>
        <circle cx="6" cy="8" r="4" {...S} />
        <circle cx="10" cy="8" r="4" {...S} />
      </>
    ),
    // A balance. It weighs, then it decides.
    gavel: (
      <>
        <path d="M8 3.5v9M3 12.5h10" {...S} />
        <path d="M2.5 6h11" {...S} />
        <path d="M4.5 6L3 9.2M4.5 6L6 9.2" {...S} strokeWidth={1.2} />
        <path d="M11.5 6L10 9.2M11.5 6L13 9.2" {...S} strokeWidth={1.2} />
      </>
    ),
    // A magnifier, held over the line that caused it.
    clueso: (
      <>
        <circle cx="6.8" cy="6.8" r="4.1" {...S} />
        <path d="M9.9 9.9l3.4 3.4" {...S} strokeWidth={1.7} />
      </>
    ),
    // A plaster: the smallest thing that covers the problem.
    patchouli: (
      <g transform="rotate(-45 8 8)">
        <rect x="1.8" y="5.4" width="12.4" height="5.2" rx="2.6" {...S} />
        <path d="M8 5.4v5.2" {...S} strokeWidth={1.2} opacity={0.6} />
      </g>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      role="presentation"
      aria-hidden
      style={{ flex: 'none', ...style }}
    >
      {marks[bot]}
    </svg>
  );
}

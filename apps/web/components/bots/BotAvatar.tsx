import { BOTS, type BotId } from './registry';

/**
 * A bot's face.
 *
 * Two stacked groups cross-fading on one timeline: `idle` holds the resting
 * expression for ~84% of the cycle, `grin` flashes twice. Each bot carries its
 * own period so eight faces never blink together — that desync is what makes
 * them read as eight characters rather than one animation.
 *
 * Pass `animate={false}` in dense contexts (past runs, inline chips, card
 * headers) so only the resting face renders.
 */

type Face = { idle: React.ReactNode; grin: React.ReactNode };

function faces(ink: string): Record<BotId, Face> {
  const S = { stroke: ink, strokeLinecap: 'round' as const, fill: 'none' };

  return {
    maestro: {
      idle: <rect x="14" y="14" width="12" height="12" rx="3" fill={ink} />,
      grin: (
        <>
          <rect x="13" y="15" width="4" height="4" rx="1.4" fill={ink} />
          <rect x="23" y="15" width="4" height="4" rx="1.4" fill={ink} />
          <path d="M14 23h12" {...S} strokeWidth="2.6" />
        </>
      ),
    },
    diffany: {
      idle: <path d="M20 12l6 12H14z" fill={ink} />,
      grin: (
        <>
          <path d="M14 16l3 3M26 16l-3 3" {...S} strokeWidth="2.4" />
          <path d="M14 23c2 3.5 10 3.5 12 0" {...S} strokeWidth="2.4" />
        </>
      ),
    },
    qaizen: {
      idle: (
        <>
          <rect x="13" y="14" width="3.4" height="12" rx="1.7" fill={ink} />
          <rect x="18.3" y="14" width="3.4" height="12" rx="1.7" fill={ink} />
          <rect x="23.6" y="14" width="3.4" height="12" rx="1.7" fill={ink} />
        </>
      ),
      grin: (
        <>
          <rect x="13" y="14" width="3.4" height="6" rx="1.7" fill={ink} />
          <rect x="23.6" y="14" width="3.4" height="6" rx="1.7" fill={ink} />
          <path d="M13.5 23c2.5 3 10.5 3 13 0" {...S} strokeWidth="2.6" />
        </>
      ),
    },
    doppler: {
      idle: (
        <>
          <circle cx="16.5" cy="20" r="5" {...S} strokeWidth="2.4" />
          <circle cx="23.5" cy="20" r="5" {...S} strokeWidth="2.4" />
        </>
      ),
      grin: (
        <>
          <circle cx="15.5" cy="17.5" r="2.2" fill={ink} />
          <circle cx="24.5" cy="17.5" r="2.2" fill={ink} />
          <path d="M14.5 23.5c3 3.5 8 3.5 11 0" {...S} strokeWidth="2.4" />
        </>
      ),
    },
    gavel: {
      idle: <path d="M12 18h16M20 18v8" {...S} strokeWidth="2.4" />,
      grin: (
        <>
          <rect x="13.5" y="15" width="4" height="4" rx="1.3" fill={ink} />
          <rect x="22.5" y="15" width="4" height="4" rx="1.3" fill={ink} />
          <path d="M15 24h10" {...S} strokeWidth="2.4" />
        </>
      ),
    },
    clueso: {
      idle: (
        <>
          <circle cx="18" cy="18" r="5.5" {...S} strokeWidth="2.4" />
          <path d="M22.5 22.5l4.5 4.5" {...S} strokeWidth="2.4" />
        </>
      ),
      grin: (
        <>
          {/* the wink */}
          <path d="M13 17.5c1.3-1.7 3.2-1.7 4.5 0" {...S} strokeWidth="2.4" />
          <circle cx="24.5" cy="17.5" r="2.2" fill={ink} />
          <path d="M15 24c2.5 2.5 7.5 2.5 10 0" {...S} strokeWidth="2.4" />
        </>
      ),
    },
    // Drawn static in the design source because both are still waiting when the
    // frame was captured. Given faces in the same idiom so they animate once
    // they have work: Patchouli keeps the plus as a mouth, Encore's curtain
    // bars part into eyes.
    patchouli: {
      idle: <path d="M20 13v14M13 20h14" {...S} strokeWidth="2.6" />,
      grin: (
        <>
          <circle cx="15.5" cy="17.5" r="2.2" fill={ink} />
          <circle cx="24.5" cy="17.5" r="2.2" fill={ink} />
          <path d="M20 21.5v5M17.5 24h5" {...S} strokeWidth="2.4" />
        </>
      ),
    },
    encore: {
      idle: <path d="M15.5 13v14M24.5 13v14" {...S} strokeWidth="2.8" />,
      grin: (
        <>
          <rect x="13.8" y="15" width="3.4" height="5" rx="1.7" fill={ink} />
          <rect x="22.8" y="15" width="3.4" height="5" rx="1.7" fill={ink} />
          <path d="M14 23.5c2.5 3 9.5 3 12 0" {...S} strokeWidth="2.6" />
        </>
      ),
    },
  };
}

export function BotAvatar({
  bot,
  size = 30,
  animate = true,
  className,
  style,
}: {
  bot: BotId;
  size?: number;
  animate?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const b = BOTS[bot];
  const face = faces(b.ink)[bot];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label={b.name}
      className={className}
      style={{ flex: 'none', ...style }}
    >
      <circle cx="20" cy="20" r="20" fill={b.fill} />
      {animate ? (
        <>
          <g style={{ animation: `idle ${b.dur} ease-in-out infinite` }}>{face.idle}</g>
          <g style={{ animation: `grin ${b.dur} ease-in-out infinite` }}>{face.grin}</g>
        </>
      ) : (
        <g>{face.idle}</g>
      )}
    </svg>
  );
}

/**
 * The run's own mark — amber, used where a run is the subject rather than a
 * bot: the sidebar row for the active run and the run header.
 */
export function RunMark({ size = 26, animate = true }: { size?: number; animate?: boolean }) {
  const ink = '#4a3412';
  const idle = (
    <>
      <rect x="12.5" y="15" width="4.2" height="10" rx="2.1" fill={ink} />
      <rect x="23.3" y="15" width="4.2" height="10" rx="2.1" fill={ink} />
    </>
  );
  const grin = (
    <path d="M13 21c2 4 12 4 14 0" stroke={ink} strokeWidth="2.8" strokeLinecap="round" fill="none" />
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="Aftershock run"
      style={{ flex: 'none' }}
    >
      <circle cx="20" cy="20" r="20" fill="#e8a33d" />
      {animate ? (
        <>
          <g style={{ animation: 'idle 6.8s ease-in-out infinite' }}>{idle}</g>
          <g style={{ animation: 'grin 6.8s ease-in-out infinite' }}>{grin}</g>
        </>
      ) : (
        <g>{idle}</g>
      )}
    </svg>
  );
}

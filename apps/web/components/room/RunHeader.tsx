'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Run } from '@aftershock/schema';
import { RunMark } from '@/components/bots/BotAvatar';
import { duration } from '@/lib/format';

export function RunHeader({
  run,
  sessions,
  view,
  onView,
  replaying,
  onSkip,
  onReplay,
}: {
  run: Run;
  sessions: number;
  view: 'room' | 'browsers';
  onView: (v: 'room' | 'browsers') => void;
  /** True while the stored run is being paced back out over SSE. */
  replaying: boolean;
  onSkip: () => void;
  onReplay: () => void;
}) {
  // A running clock has no server-side value, so tick it only after mount —
  // otherwise SSR and the first client render disagree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (run.finishedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run.finishedAt]);

  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsed = end ? duration(end - Date.parse(run.startedAt)) : '—';

  return (
    <div className="flex items-center gap-[11px] border-b border-edge px-6 py-[15px]">
      <RunMark size={26} animate={run.status === 'running'} />
      <span className="text-[16px]/[1] font-medium text-ink">
        {run.id.replace('run_', 'Run ')} · {run.commit.branch.split('/').at(-1)}
      </span>
      <span className="mono text-[13px]/[1] text-ink-6">
        {run.commit.sha.slice(0, 7)} · {run.commit.branch}
      </span>
      {run.previewUrl && (
        <a
          href={run.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="mono text-[12px]/[1] text-ink-8 hover:text-amber"
        >
          preview ↗
        </a>
      )}
      <span className="flex-1" />
      <span className="text-[12.5px]/[1] text-ink-6">
        {sessions} browsers · {elapsed}
      </span>
      <button
        type="button"
        onClick={replaying ? onSkip : onReplay}
        className="rounded-full bg-chip px-[11px] py-[5px] text-[11.5px]/[1] text-ink-5 transition-colors hover:bg-[#2e2e2e] hover:text-ink-2"
      >
        {replaying ? 'Skip to end' : 'Replay'}
      </button>
      <button
        type="button"
        aria-label={view === 'room' ? 'Show the browsers' : 'Back to the room'}
        onClick={() => onView(view === 'room' ? 'browsers' : 'room')}
        className={clsx(
          'rounded-md p-1 transition-colors',
          view === 'browsers' ? 'text-amber' : 'text-ink-9 hover:text-ink-5',
        )}
      >
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="2" y="3.5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 17h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

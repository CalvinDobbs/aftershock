'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Run } from '@aftershock/schema';
import { RunMark } from '@/components/bots/BotAvatar';
import { duration } from '@/lib/format';
import { subject } from '@/lib/voice';

/**
 * What this run is, in one line.
 *
 * It used to print the whole commit message, body and all, which on a
 * well-written commit is a paragraph — set at 15px above a transcript you are
 * meant to read. Only the subject belongs here; the rest is on hover.
 */
export function RunHeader({ run, sessions }: { run: Run; sessions: number }) {
  // A running clock has no server-side value, so tick it only after mount.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (run.finishedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run.finishedAt]);

  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsed = end ? duration(end - Date.parse(run.startedAt)) : '—';
  const live = run.status === 'running';

  return (
    <header className="flex items-center gap-3 border-b border-edge bg-stage px-6 py-[13px]">
      <RunMark size={26} animate={live} />

      <span
        className="min-w-0 truncate text-[15px]/[1.25] font-semibold tracking-[-.01em] text-ink"
        title={run.commit.message}
      >
        {subject(run.commit.message)}
      </span>

      {/* The sha is an identifier, so it gets an identifier's treatment: mono,
          in a chip. The branch is the subject of the whole run, so it is the
          one thing up here that carries the accent. */}
      <span className="mono hidden shrink-0 items-center gap-2 md:flex">
        <span className="rounded-[5px] bg-chip px-[7px] py-[3px] text-[11px]/[1.35] text-ink-6">
          {run.commit.sha.slice(0, 7)}
        </span>
        <span className="truncate text-[11.5px]/[1.35] text-amber/85">{run.commit.branch}</span>
      </span>

      <span className="flex-1" />

      {/* Numbers in mono, their units in sans. The eye lands on the figures
          without either being shouted. */}
      <span className="hidden shrink-0 items-baseline gap-[5px] text-[12.5px]/[1] text-ink-8 sm:flex">
        <span className="mono font-medium text-ink-3">{sessions}</span>
        <span>browsers</span>
        <span className="text-edge-3">·</span>
        <span className="mono font-medium text-ink-3">{elapsed}</span>
      </span>

      <span
        className={clsx(
          'flex shrink-0 items-center gap-1.5 rounded-full py-[4px] pr-2.5 pl-2 text-[11px]/[1]',
          live ? 'bg-amber-sunk text-amber-2' : 'bg-chip text-ink-6',
        )}
      >
        <span
          className={clsx(
            'block size-[6px] rounded-full',
            live ? 'blink bg-amber' : run.status === 'failed' ? 'bg-flare' : 'bg-plus',
          )}
        />
        {live ? 'running' : run.status === 'failed' ? 'failed' : 'complete'}
      </span>
    </header>
  );
}

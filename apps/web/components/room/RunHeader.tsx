'use client';

import { useEffect, useState } from 'react';
import type { Run } from '@aftershock/schema';
import { RunMark } from '@/components/bots/BotAvatar';
import { duration } from '@/lib/format';

export function RunHeader({
  run,
  sessions,
  replaying,
  onSkip,
  onReplay,
}: {
  run: Run;
  sessions: number;
  replaying: boolean;
  onSkip: () => void;
  onReplay: () => void;
}) {
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

  return (
    <header className="flex items-center gap-3 border-b border-edge px-6 py-[15px]">
      <RunMark size={26} animate={run.status === 'running'} />
      <span className="truncate text-[15.5px]/[1.2] font-medium text-ink">
        {run.commit.message}
      </span>
      <span className="mono hidden shrink-0 text-[12.5px]/[1] text-ink-6 md:inline">
        {run.commit.sha.slice(0, 7)} · {run.commit.branch}
      </span>
      <span className="flex-1" />
      <span className="hidden shrink-0 text-[12.5px]/[1] text-ink-7 sm:inline">
        {sessions} browsers · {elapsed}
      </span>
      <button
        type="button"
        onClick={replaying ? onSkip : onReplay}
        className="shrink-0 rounded-full bg-chip px-3 py-[6px] text-[11.5px]/[1] text-ink-5 transition-colors hover:bg-[#2e2e2e] hover:text-ink-2"
      >
        {replaying ? 'Skip to end' : 'Replay'}
      </button>
    </header>
  );
}

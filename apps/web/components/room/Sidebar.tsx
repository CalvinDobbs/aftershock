'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { RunSummary } from '@aftershock/schema';
import { BotAvatar, RunMark } from '@/components/bots/BotAvatar';
import { BOTS, ROSTER, type BotId } from '@/components/bots/registry';
import { SectionLabel } from '@/components/ui/atoms';
import { browserHours, lastBot, preview } from '@/lib/derive';
import { ago, duration } from '@/lib/format';

export type RosterStatus = {
  /** What this bot is doing right now, in its own voice. */
  line: string;
  tone: 'live' | 'bad' | 'done' | 'idle';
};

const DOT: Record<RosterStatus['tone'], string> = {
  live: 'bg-amber',
  bad: 'bg-flare',
  done: 'bg-[#3d5c48]',
  idle: 'bg-[#2e2e2e]',
};

/**
 * The rail is a presence list first and a navigation list second.
 *
 * Every bot shows what it is doing on its own line, so the question the room
 * answers at a glance is "who is working and on what" rather than "which
 * stages have completed". Maestro is absent: the Director is deterministic
 * code and is never something you wait on.
 */
export function Sidebar({
  runs,
  activeRunId,
  roster,
  runCostMs,
}: {
  runs: RunSummary[];
  activeRunId: string;
  roster: Record<BotId, RosterStatus>;
  runCostMs: number;
}) {
  const used = browserHours(runs);
  // Four most recent, but never at the cost of hiding the run being viewed
  // from its own navigation.
  const head = runs.slice(0, 4);
  const visible = head.some((r) => r.id === activeRunId)
    ? head
    : [...runs.filter((r) => r.id === activeRunId), ...head.slice(0, 3)];

  return (
    <aside className="flex w-[288px] flex-none flex-col bg-rail">
      <div className="flex items-center gap-2 px-4 pt-[17px] pb-3">
        <span className="block size-[11px] rounded-full bg-[#e35d4f]" />
        <span className="block size-[11px] rounded-full bg-[#e3b64f]" />
        <span className="block size-[11px] rounded-full bg-[#54b85a]" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <SectionLabel className="px-2.5 pt-1 pb-2">RUNS</SectionLabel>
        <div className="flex flex-col gap-px">
          {visible.map((r) => {
            const active = r.id === activeRunId;
            const who = lastBot(r);
            return (
              <Link
                key={r.id}
                href={`/runs/${r.id}`}
                className={clsx(
                  'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors',
                  active ? 'bg-bubble' : 'hover:bg-[#161616]',
                )}
              >
                {who === 'run' ? (
                  <RunMark size={22} />
                ) : (
                  <BotAvatar bot={who} size={22} animate={false} />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={clsx(
                      'block truncate text-[13px]/[1.3]',
                      active ? 'font-medium text-ink-2' : 'text-ink-6',
                    )}
                  >
                    {r.branch.split('/').at(-1)}
                  </span>
                  <span className="block truncate text-[11px]/[1.4] text-ink-8">{preview(r)}</span>
                </span>
                <span className="flex-none text-[10.5px]/[1] text-ink-8">{ago(r.startedAt)}</span>
              </Link>
            );
          })}
        </div>

        <SectionLabel className="px-2.5 pt-6 pb-2.5">IN THE ROOM</SectionLabel>
        <div className="flex flex-col gap-1">
          {ROSTER.map((id) => {
            const st = roster[id];
            return (
              <div
                key={id}
                className={clsx(
                  'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2',
                  st.tone === 'idle' && 'opacity-55',
                )}
              >
                <span className="relative flex-none">
                  {/* Faces keep blinking even while a bot waits — freezing them
                      reads as the room being switched off. Waiting is carried
                      by opacity and the status dot instead. */}
                  <BotAvatar bot={id} size={26} />
                  <span
                    className={clsx(
                      'absolute -right-px -bottom-px block size-[9px] rounded-full ring-2 ring-rail',
                      DOT[st.tone],
                      st.tone === 'live' && 'blink',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]/[1.25] text-ink-4">
                    {BOTS[id].name}
                  </span>
                  <span
                    className={clsx(
                      'block truncate text-[11.5px]/[1.4]',
                      st.tone === 'bad'
                        ? 'text-alarm'
                        : st.tone === 'live'
                          ? 'text-amber'
                          : 'text-ink-8',
                    )}
                  >
                    {st.line}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <SectionLabel className="px-2.5 pt-6 pb-2.5">BROWSER BUDGET</SectionLabel>
        <div className="flex flex-col gap-2 px-2.5 pb-5">
          <div className="flex justify-between">
            <span className="text-[12px]/[1] text-ink-7">used of the grant</span>
            <span className="mono text-[11.5px]/[1] text-ink-5">{used.toFixed(1)} / 100 h</span>
          </div>
          <span className="relative block h-1 rounded-[2px] bg-edge-2">
            <span
              className="absolute inset-y-0 left-0 block rounded-[2px] bg-amber"
              style={{ width: `${Math.min(100, used)}%` }}
            />
          </span>
          <div className="text-[11.5px]/[1.5] text-ink-8">
            this run, {duration(runCostMs)} of browser time
          </div>
        </div>
      </div>

      {/* PLACEHOLDER — the signed-in user is hardcoded. Auth on our own
          dashboard is explicitly out of scope in the PRD; swap this for the
          GitHub App's installation user when there is a session to read. */}
      <div className="flex items-center gap-2.5 border-t border-edge px-4 py-3.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-[#262626] text-[11.5px]/[1] font-medium text-ink-4">
          MK
        </span>
        <span className="text-[13.5px]/[1] text-ink-3">Maya Khan</span>
      </div>
    </aside>
  );
}

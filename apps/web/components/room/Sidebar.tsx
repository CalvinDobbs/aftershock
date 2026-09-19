'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { Finding, RunSummary } from '@aftershock/schema';
import { BotAvatar, RunMark } from '@/components/bots/BotAvatar';
import { BOTS, ROSTER, type BotId } from '@/components/bots/registry';
import { LiveDot, SectionLabel } from '@/components/ui/atoms';
import { browserHours, lastBot, preview, roomMemory } from '@/lib/derive';
import { ago, duration } from '@/lib/format';

export type RosterStatus = { text: string; tone: 'idle' | 'live' | 'bad' };

export function Sidebar({
  runs,
  activeRunId,
  roster,
  findings,
  runCostMs,
}: {
  runs: RunSummary[];
  activeRunId: string;
  roster: Record<BotId, RosterStatus>;
  findings: Finding[];
  runCostMs: number;
}) {
  const used = browserHours(runs);
  const memory = roomMemory(findings);

  return (
    <aside className="flex w-[292px] flex-none flex-col bg-rail">
      <div className="flex items-center gap-2 px-4 pt-[17px] pb-3">
        <span className="block size-[11px] rounded-full bg-[#e35d4f]" />
        <span className="block size-[11px] rounded-full bg-[#e3b64f]" />
        <span className="block size-[11px] rounded-full bg-[#54b85a]" />
        <span className="flex-1" />
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="#8a8a8a" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>

      <div className="px-3 pt-1 pb-2.5">
        {/* PLACEHOLDER — inert. Search across runs needs a query endpoint on
            `api`; there is nothing to filter client-side once runs paginate. */}
        <div className="flex items-center gap-[9px] rounded-[11px] bg-card-2 px-3 py-[9px]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="4.6" stroke="#9e9e9e" strokeWidth="1.4" />
            <path d="M10.6 10.6l3 3" stroke="#9e9e9e" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="text-[14px]/[1] text-ink-6">Search</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-1">
        {runs.map((r) => {
          const active = r.id === activeRunId;
          const who = lastBot(r);
          return (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className={clsx(
                'flex gap-[11px] rounded-[12px] p-2.5 transition-colors',
                active ? 'bg-bubble' : 'hover:bg-[#161616]',
              )}
            >
              {who === 'run' ? (
                <RunMark size={38} />
              ) : (
                <BotAvatar bot={who} size={38} animate={false} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={clsx(
                      'truncate text-[14.5px]/[1.3] font-medium',
                      active ? 'text-ink' : 'text-ink-3',
                    )}
                  >
                    {r.id.replace('run_', 'Run ')} · {r.branch.split('/').at(-1)}
                  </span>
                  <span className="flex-none text-[11.5px]/[1.3] text-ink-6">
                    {ago(r.startedAt)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[13px]/[1.4] text-ink-7">{preview(r)}</div>
              </div>
            </Link>
          );
        })}

        <SectionLabel className="px-2.5 pt-5 pb-2.5">ON THIS RUN</SectionLabel>
        <div className="flex flex-col gap-3.5 px-2.5">
          {ROSTER.map((id) => {
            const st = roster[id];
            return (
              <div
                key={id}
                className={clsx('flex items-center gap-[9px]', st.tone === 'idle' && 'opacity-[.72]')}
              >
                <BotAvatar bot={id} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[13px]/[1.2] text-ink-5">{BOTS[id].name}</span>
                    {st.tone === 'live' ? (
                      <span className="flex items-center gap-[5px]">
                        <LiveDot />
                        <span className="text-[11px]/[1] text-ink-7">{st.text}</span>
                      </span>
                    ) : (
                      <span
                        className={clsx(
                          'text-[11px]/[1]',
                          st.tone === 'bad' ? 'text-alarm' : 'text-ink-8',
                        )}
                      >
                        {st.text}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px]/[1.4] text-ink-8">{BOTS[id].blurb}</div>
                </div>
              </div>
            );
          })}
        </div>

        {memory.length > 0 && (
          <>
            <SectionLabel className="px-2.5 pt-6 pb-2.5">WHAT THE ROOM REMEMBERS</SectionLabel>
            <div className="flex flex-col gap-2 px-2.5">
              {memory.map((m, i) => (
                <div
                  key={i}
                  className="rounded-[11px] bg-sunk px-3 py-2.5 text-[12.5px]/[1.5] text-ink-7"
                >
                  {m}
                </div>
              ))}
            </div>
          </>
        )}

        <SectionLabel className="px-2.5 pt-6 pb-2.5">BUDGET</SectionLabel>
        <div className="flex flex-col gap-[9px] px-2.5 pb-5">
          <div className="flex justify-between">
            <span className="text-[12.5px]/[1] text-ink-7">browser hours</span>
            <span className="mono text-[12px]/[1] text-ink-4">{used.toFixed(1)} / 100</span>
          </div>
          <span className="relative block h-1 rounded-[2px] bg-edge-2">
            <span
              className="absolute inset-y-0 left-0 block rounded-[2px] bg-amber"
              style={{ width: `${Math.min(100, used)}%` }}
            />
          </span>
          <div className="text-[11.5px]/[1.5] text-ink-8">
            this run cost about {(runCostMs / 3_600_000).toFixed(2)} of an hour ·{' '}
            {duration(runCostMs)} of browser time
          </div>
        </div>
      </div>

      {/* PLACEHOLDER — the signed-in user is hardcoded. The PRD puts auth on
          our own dashboard explicitly out of scope, so this stays until there
          is a session to read; swap for the GitHub App's installation user. */}
      <div className="flex items-center gap-[11px] border-t border-edge px-[18px] py-3.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#262626] text-[12px]/[1] font-medium text-ink-4">
          MK
        </span>
        <span className="text-[14px]/[1] text-ink-3">Maya Khan</span>
      </div>
    </aside>
  );
}

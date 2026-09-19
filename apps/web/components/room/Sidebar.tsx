'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { RunSummary } from '@aftershock/schema';
import { BotAvatar, RunMark } from '@/components/bots/BotAvatar';
import { BOTS, ROSTER, type BotId } from '@/components/bots/registry';
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

type Prefs = { collapsed: boolean; runs: boolean; roster: boolean };
const DEFAULTS: Prefs = { collapsed: false, runs: true, roster: true };
const STORE = 'aftershock.rail';

/**
 * The rail is a presence list first and a navigation list second.
 *
 * Every bot shows what it is doing on its own line, so the question the room
 * answers at a glance is "who is working and on what" rather than "which
 * stages have completed". Maestro is absent: the Director is deterministic
 * code and is never something you wait on.
 *
 * Collapsing keeps the faces. A rail that hides them to save 230px has thrown
 * away the only thing it was for, so the collapsed state is a column of
 * avatars with their status dots — presence at a glance, no labels.
 */
export function Sidebar({
  runs,
  activeRunId,
  roster,
  runCostMs,
  author,
}: {
  runs: RunSummary[];
  activeRunId: string;
  roster: Record<BotId, RosterStatus>;
  runCostMs: number;
  /** Whoever pushed the commit under test. Empty until Scout has read it. */
  author: string;
}) {
  // Defaults render on the server; the stored preference is applied after
  // mount so the two passes agree.
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setPrefs({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* a corrupt preference should never stop the room rendering */
    }
  }, []);

  const set = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* private browsing */
      }
      return next;
    });

  const used = browserHours(runs);
  const head = runs.slice(0, 4);
  const visible = head.some((r) => r.id === activeRunId)
    ? head
    : [...runs.filter((r) => r.id === activeRunId), ...head.slice(0, 3)];

  if (prefs.collapsed) {
    return (
      <aside className="flex w-[60px] flex-none flex-col items-center gap-3 bg-rail py-4">
        <RailToggle collapsed onClick={() => set({ collapsed: false })} />
        <span className="my-1 h-px w-6 bg-edge" />
        {ROSTER.map((id) => {
          const st = roster[id];
          return (
            <span
              key={id}
              className={clsx('relative', st.tone === 'idle' && 'opacity-55')}
              title={`${BOTS[id].name} — ${st.line}`}
            >
              <BotAvatar bot={id} size={28} />
              <span
                className={clsx(
                  'absolute -right-px -bottom-px block size-[9px] rounded-full ring-2 ring-rail',
                  DOT[st.tone],
                  st.tone === 'live' && 'blink',
                )}
              />
            </span>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="flex w-[288px] flex-none flex-col bg-rail">
      <div className="flex items-center gap-2 px-4 pt-[17px] pb-3">
        <span className="block size-[11px] rounded-full bg-[#e35d4f]" />
        <span className="block size-[11px] rounded-full bg-[#e3b64f]" />
        <span className="block size-[11px] rounded-full bg-[#54b85a]" />
        <span className="flex-1" />
        <RailToggle collapsed={false} onClick={() => set({ collapsed: true })} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <Section
          title="Runs"
          open={prefs.runs}
          onToggle={() => set({ runs: !prefs.runs })}
          count={visible.length}
        >
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
                    <span className="block truncate text-[11px]/[1.4] text-ink-8">
                      {preview(r)}
                    </span>
                  </span>
                  <span className="flex-none text-[10.5px]/[1] text-ink-8">{ago(r.startedAt)}</span>
                </Link>
              );
            })}
          </div>
        </Section>

        <Section
          title="In the room"
          open={prefs.roster}
          onToggle={() => set({ roster: !prefs.roster })}
          count={ROSTER.length}
        >
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
                    {/* Faces keep blinking even while a bot waits — freezing
                        them reads as the room being switched off. Waiting is
                        carried by opacity and the status dot instead. */}
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
        </Section>

        <div className="mt-5 flex flex-col gap-2 px-2.5 pb-5">
          <div className="flex justify-between">
            <span className="text-[12px]/[1] text-ink-7">browser budget</span>
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

      {/* The room has no login — the PRD puts dashboard auth out of scope —
          so the footer names the one person a run is actually about: whoever
          pushed the commit. Real data from Scout, never a placeholder name. */}
      <div className="flex items-center gap-2.5 border-t border-edge px-4 py-3.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-[#262626] text-[11.5px]/[1] font-medium text-ink-4">
          {initials(author)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px]/[1.25] text-ink-3">
            {author || 'author not read yet'}
          </span>
          <span className="block text-[11px]/[1.3] text-ink-8">pushed this commit</span>
        </span>
      </div>
    </aside>
  );
}

/** "maya" → "M", "Maya Khan" → "MK", "" → "?" */
function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

function Section({
  title,
  open,
  onToggle,
  count,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-4 first:pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group flex w-full items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#161616]"
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          className={clsx('shrink-0 transition-transform duration-200', open && 'rotate-90')}
        >
          <path d="M3 1.5L7 5l-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span
          className="text-[11px]/[1] font-medium text-ink-8 group-hover:text-ink-6"
          style={{ letterSpacing: '.05em' }}
        >
          {title.toUpperCase()}
        </span>
        <span className="flex-1" />
        {!open && <span className="mono text-[10.5px]/[1] text-ink-8">{count}</span>}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function RailToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? 'Expand the rail' : 'Collapse the rail'}
      title={collapsed ? 'Expand the rail' : 'Collapse the rail'}
      className="flex size-7 items-center justify-center rounded-[7px] text-ink-9 transition-colors hover:bg-[#1c1c1c] hover:text-ink-5"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="1.8"
          y="2.8"
          width="12.4"
          height="10.4"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M6.3 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
        {/* The chevron points the way the rail will move. */}
        <path
          d={collapsed ? 'M9.2 6.4L11 8l-1.8 1.6' : 'M11 6.4L9.2 8l1.8 1.6'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

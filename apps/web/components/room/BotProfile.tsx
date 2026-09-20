'use client';

import clsx from 'clsx';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { BOTS, type BotId } from '@/components/bots/registry';
import type { RosterStatus } from './Sidebar';

export type ProfileStat = { label: string; value: string };

const DOT: Record<RosterStatus['tone'], string> = {
  live: 'bg-amber',
  bad: 'bg-flare',
  done: 'bg-[#3d5c48]',
  idle: 'bg-[#2e2e2e]',
};

const TONE_WORD: Record<RosterStatus['tone'], string> = {
  live: 'Working',
  bad: 'Found something',
  done: 'Done',
  idle: 'Idle',
};

/**
 * One agent's profile, opened by clicking its face in the rail.
 *
 * The rail can only afford a name and one status line, which is the right
 * trade for a presence list and the wrong one the moment somebody asks "what
 * is Doppler, actually?" — the question a room of seven strangers invites.
 * This answers it without leaving the run: who it is, what it is for, what it
 * is doing right now, and what it did in *this* run rather than in general.
 *
 * Everything below the fold is live pipeline state. A profile that showed only
 * static blurb text would be a help page wearing a person's face.
 */
export function BotProfile({
  bot,
  status,
  stats,
  onClose,
}: {
  bot: BotId;
  status: RosterStatus;
  /** What this agent did in this run. Empty before it has done anything. */
  stats: ProfileStat[];
  onClose: () => void;
}) {
  const b = BOTS[bot];

  return (
    <aside
      className="slide-in-right flex w-[320px] flex-none flex-col border-l border-edge bg-rail"
      aria-label={`${b.name} profile`}
    >
      <div className="flex flex-none items-center gap-2 px-4 pt-[17px] pb-3">
        <span className="text-[14.5px]/[1] font-medium text-ink-2">Profile</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close profile"
          className="flex size-7 items-center justify-center rounded-[7px] text-ink-9 transition-colors hover:bg-[#1c1c1c] hover:text-ink-5"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {/* The face at portrait size, on its own colour. The rail shows it at
            26px where the expression is barely legible; this is the only place
            you can actually see who you have been reading all run. */}
        <div
          className="flex aspect-square w-full items-center justify-center rounded-[16px]"
          style={{ background: b.fill }}
        >
          <BotAvatar bot={bot} size={168} />
        </div>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-[19px]/[1.2] font-medium text-ink">{b.name}</span>
          <span className="text-[17px]/[1]" aria-hidden>
            {b.emoji}
          </span>
        </div>
        <div className="mt-[3px] text-[13.5px]/[1.4] text-ink-5">{b.role}</div>
        <div className="mono mt-[3px] text-[11.5px]/[1.4] text-ink-8">{b.pronounce}</div>

        <div className="mt-3.5 flex items-center gap-2">
          <span className={clsx('block size-[9px] rounded-full', DOT[status.tone], status.tone === 'live' && 'blink')} />
          <span className="text-[12.5px]/[1.4] text-ink-6">
            {TONE_WORD[status.tone]} — {status.line}
          </span>
        </div>

        <p className="pretty mt-4 border-t border-edge pt-4 text-[13.5px]/[1.65] text-ink-6">
          {b.about}
        </p>

        <Block title="Owns">
          <span className="mono text-[12px]/[1.4] text-ink-5">
            {b.stage.replace(/_/g, ' ')}
          </span>
        </Block>

        {stats.length > 0 && (
          <Block title="In this run">
            <div className="flex flex-col gap-[7px]">
              {stats.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px]/[1.4] text-ink-7">{s.label}</span>
                  <span className="mono shrink-0 text-[12px]/[1.4] text-ink-4">{s.value}</span>
                </div>
              ))}
            </div>
          </Block>
        )}
      </div>
    </aside>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-edge pt-4">
      <div
        className="mb-2 text-[11px]/[1] font-medium text-ink-8"
        style={{ letterSpacing: '.05em' }}
      >
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

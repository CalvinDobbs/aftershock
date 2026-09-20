'use client';

import clsx from 'clsx';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { BotGlyph } from '@/components/bots/BotGlyph';
import { BOTS, type BotId } from '@/components/bots/registry';
import type { RosterStatus } from './Sidebar';

export type ProfileStat = { label: string; value: string };

const DOT: Record<RosterStatus['tone'], string> = {
  live: 'bg-amber',
  bad: 'bg-flare',
  done: 'bg-plus',
  idle: 'bg-ink-9',
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
 * The rail can afford a name and one status line, which is right for a
 * presence list and useless the moment somebody asks "what *is* Doppler?" —
 * the question a room of seven strangers invites. This answers it without
 * leaving the run.
 *
 * The first attempt put the round face inside a 280px flat colour square,
 * which gave four dead corners of the loudest colour on screen and a small
 * face adrift in the middle. Here the face is the hero and the colour is
 * light: a radial wash of the bot's own hue falling off into the rail, sized
 * so the face fills it. Everything below is deliberately quiet — one accent
 * per panel is the budget.
 *
 * The numbers are live pipeline state, read from the same place the thread is
 * drawn from, so a profile and the transcript can never disagree. A profile
 * showing only blurb text would be a help page wearing somebody's face.
 */
export function BotProfile({
  bot,
  status,
  stats,
  onClose,
}: {
  bot: BotId;
  status: RosterStatus;
  stats: ProfileStat[];
  onClose: () => void;
}) {
  const b = BOTS[bot];

  return (
    <aside
      className="slide-in-right flex w-[326px] flex-none flex-col border-l border-edge bg-rail"
      aria-label={`${b.name} profile`}
    >
      <div className="flex flex-none items-center gap-2 border-b border-edge px-4 py-3">
        <span className="text-[11px]/[1] font-medium tracking-[.06em] text-ink-8">PROFILE</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close profile"
          className="flex size-7 items-center justify-center rounded-[7px] text-ink-9 transition-colors hover:bg-chip hover:text-ink-4"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The face, lit by its own colour rather than pasted onto a slab of
            it. The wash fades to nothing before the panel edge, so there is no
            rectangle — just presence. */}
        <div className="relative flex h-[164px] items-center justify-center overflow-hidden">
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 42%, ${b.fill}2e 0%, ${b.fill}12 38%, transparent 68%)`,
            }}
          />
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${b.fill}44, transparent)` }}
          />
          <BotAvatar bot={bot} size={104} />
        </div>

        <div className="px-4 pt-1 pb-5">
          <div className="flex items-center gap-2">
            <h2 className="text-[20px]/[1.15] font-semibold tracking-[-.01em] text-ink">{b.name}</h2>
            <BotGlyph bot={bot} size={15} className="mt-[1px]" style={{ color: b.say }} />
          </div>
          <div className="mt-[5px] text-[13.5px]/[1.45] text-ink-5">{b.role}</div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mono rounded-full bg-chip px-2 py-[4px] text-[10.5px]/[1] text-ink-7">
              {b.pronounce}
            </span>
            <span className="mono rounded-full bg-chip px-2 py-[4px] text-[10.5px]/[1] text-ink-7">
              {b.stage.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="mt-3.5 flex items-center gap-2 rounded-[9px] bg-card px-2.5 py-2">
            <span
              className={clsx(
                'block size-[7px] flex-none rounded-full',
                DOT[status.tone],
                status.tone === 'live' && 'blink',
              )}
            />
            <span className="text-[12px]/[1.4] font-medium text-ink-4">{TONE_WORD[status.tone]}</span>
            <span className="min-w-0 flex-1 truncate text-[12px]/[1.4] text-ink-7">{status.line}</span>
          </div>

          <p className="pretty mt-4 text-[13px]/[1.7] text-ink-6">{b.about}</p>

          {stats.length > 0 && (
            <div className="mt-5">
              <div className="mb-1 text-[11px]/[1] font-medium tracking-[.06em] text-ink-8">
                IN THIS RUN
              </div>
              <dl className="m-0">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-baseline justify-between gap-3 border-b border-edge py-[9px] last:border-b-0"
                  >
                    <dt className="text-[12.5px]/[1.4] text-ink-7">{s.label}</dt>
                    <dd className="mono m-0 shrink-0 text-[12px]/[1.4] font-medium text-ink-3">
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

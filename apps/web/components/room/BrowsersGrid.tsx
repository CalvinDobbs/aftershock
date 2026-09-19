'use client';

import clsx from 'clsx';
import type { Assignment } from '@aftershock/schema';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { BOTS } from '@/components/bots/registry';
import { BrowserFrame } from '@/components/ui/BrowserFrame';
import { PageShot } from '@/components/ui/PageShot';
import { botFor } from '@/lib/room';
import { duration } from '@/lib/format';

/**
 * Every session at once (design ref 2c).
 *
 * Failing agents stay expanded with their evidence; passing agents collapse to
 * a strip. Differential pairs span two columns and show both sides, which is
 * the one view that explains the second oracle without a word of narration.
 */
export function BrowsersGrid({
  assignments,
  host,
  baseHost,
  branch,
  baseBranch,
  maxConcurrent,
}: {
  assignments: Assignment[];
  host: string;
  baseHost: string;
  branch: string;
  baseBranch: string;
  maxConcurrent: number;
}) {
  const sessions = assignments.reduce((n, a) => n + (a.archetype === 'differential' ? 2 : 1), 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-[30px]">
      <div className="flex items-center gap-3 border-b border-[#1f1f1f] pb-3.5">
        <span className="text-[14px]/[1] font-medium text-ink-1">Browsers</span>
        <span className="text-[12.5px]/[1] text-ink-6">
          {sessions} sessions · MAX_CONCURRENT {maxConcurrent} · every action screenshotted, every
          session recorded
        </span>
      </div>

      <div className="mt-[22px] grid grid-cols-3 gap-[22px]">
        {assignments.map((a) =>
          a.archetype === 'differential' ? (
            <DiffCard key={a.id} a={a} host={host} baseHost={baseHost} branch={branch} baseBranch={baseBranch} />
          ) : (
            <SoloCard key={a.id} a={a} host={host} />
          ),
        )}
      </div>
    </div>
  );
}

function CardHead({ a }: { a: Assignment }) {
  const bot = BOTS[botFor(a)];
  const label =
    a.status === 'failed'
      ? 'Failed'
      : a.status === 'running'
        ? 'Working'
        : a.status === 'errored'
          ? 'Errored'
          : a.status === 'queued'
            ? 'Queued'
            : 'Clean';
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <BotAvatar bot={botFor(a)} size={24} />
      <span className="text-[13.5px]/[1] font-medium text-ink-1">{bot.name}</span>
      <span className="mono text-[11px]/[1] text-ink-8">{a.assertionId}</span>
      <span className="flex-1" />
      <span
        className={clsx(
          'text-[11px]/[1] font-medium',
          a.status === 'failed' || a.status === 'errored'
            ? 'text-alarm'
            : a.status === 'running'
              ? 'text-amber'
              : 'text-ink-7',
        )}
      >
        {label}
      </span>
    </div>
  );
}

function SoloCard({ a, host }: { a: Assignment; host: string }) {
  const failed = a.status === 'failed';
  const shot = failed
    ? ([...a.steps].reverse().find((s) => !s.ok) ?? a.steps.at(-1))
    : a.steps.at(-1);

  return (
    <div className="rounded-[14px] bg-card p-[13px]">
      <CardHead a={a} />

      {failed || a.status === 'running' ? (
        <>
          <BrowserFrame
            dots={3}
            radius={8}
            flagged={failed}
            live={a.status === 'running'}
            cursor={a.status === 'running' ? { left: '62%', top: '58%' } : undefined}
          >
            <PageShot digest={shot?.digest} screenshotUrl={shot?.screenshotUrl} scale="md" />
          </BrowserFrame>
          <Strip steps={a.steps.length} hot={failed} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: Math.max(4, a.steps.length) }).map((_, i) => (
              <span
                key={i}
                className="block h-10 rounded-[3px] bg-chip"
                style={{ width: 'calc(25% - 3px)' }}
              />
            ))}
          </div>
          <div className="mt-2.5 text-[12.5px]/[1.5] text-ink-6">
            Nothing to show. Collapsed by default — passing agents don&apos;t take space.
          </div>
        </>
      )}

      <div className="mono mt-[7px] text-[10.5px]/[1.5] text-ink-8">
        {a.steps.length} shots · {duration(a.durationMs)}
        {a.status === 'running' ? ' · live view' : ''}
      </div>
      <div className="mt-1 truncate text-[11.5px]/[1.5] text-ink-8" title={a.brief}>
        {a.brief}
      </div>
    </div>
  );
}

function Strip({ steps, hot }: { steps: number; hot: boolean }) {
  return (
    <div className="mt-2 flex gap-1">
      {Array.from({ length: steps }).map((_, i) => (
        <span
          key={i}
          className="block h-[22px] flex-1 rounded-[3px]"
          style={{
            background: !hot
              ? '#242424'
              : i === steps - 1
                ? '#4a2018'
                : i === steps - 2
                  ? '#3a2a18'
                  : '#242424',
          }}
        />
      ))}
    </div>
  );
}

function DiffCard({
  a,
  host,
  baseHost,
  branch,
  baseBranch,
}: {
  a: Assignment;
  host: string;
  baseHost: string;
  branch: string;
  baseBranch: string;
}) {
  const step = [...a.steps].reverse().find((s) => s.baseDigest || s.digest) ?? a.steps.at(-1);

  return (
    <div className="col-span-2 rounded-[14px] bg-card p-[13px]">
      <CardHead a={a} />
      <div className="flex gap-3">
        <Side label={baseBranch.toUpperCase()} host={baseHost}>
          <PageShot digest={step?.baseDigest} screenshotUrl={step?.baseScreenshotUrl} scale="md" />
        </Side>
        <Side label={branch.toUpperCase()} host={host} flagged>
          <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="md" />
        </Side>
      </div>
      <div className="mono mt-2 text-[10.5px]/[1.5] text-ink-8">
        the identical recorded action replayed on both sides · no model in the loop · step{' '}
        {step?.idx ?? '—'} of {a.steps.length}
      </div>
    </div>
  );
}

function Side({
  label,
  host,
  flagged = false,
  children,
}: {
  label: string;
  host: string;
  flagged?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1">
      <div className="mono mb-[7px] text-[10px]/[1] text-ink-8">{label}</div>
      <BrowserFrame dots={2} radius={8} flagged={flagged} url={host}>
        {children}
      </BrowserFrame>
    </div>
  );
}

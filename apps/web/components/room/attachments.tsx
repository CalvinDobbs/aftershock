'use client';

import { useState } from 'react';
import type { Assignment, Finding, Step } from '@aftershock/schema';
import type { Attachment } from '@/lib/room';
import { BOTS } from '@/components/bots/registry';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { BrowserFrame } from '@/components/ui/BrowserFrame';
import { PageShot } from '@/components/ui/PageShot';
import { Scrubber, StatePill } from '@/components/ui/atoms';
import { ReplayModal } from '@/components/evidence/ReplayModal';
import { botFor } from '@/lib/room';
import { duration } from '@/lib/format';

/** The failing frame and the one immediately before it — the persuasive pair. */
function evidencePair(a: Assignment): { before?: Step; after?: Step } {
  const withDigest = a.steps.filter((s) => s.digest || s.screenshotUrl);
  const after = [...withDigest].reverse().find((s) => !s.ok) ?? withDigest.at(-1);
  const before = withDigest.filter((s) => s.idx < (after?.idx ?? 0)).at(-1);
  return { before, after };
}

export function Attachments({ items, host }: { items: Attachment[]; host: string }) {
  return (
    <>
      {items.map((a, i) => (
        <div key={i} className="mt-[9px]">
          <One a={a} host={host} />
        </div>
      ))}
    </>
  );
}

function One({ a, host }: { a: Attachment; host: string }) {
  switch (a.kind) {
    case 'assertions':
      return <AssertionRows rows={a.rows} />;
    case 'recording':
      return <RecordingCard assignment={a.assignment} host={host} />;
    case 'diffpair':
      return <DiffPair {...a} />;
    case 'live':
      return <LiveCard assignment={a.assignment} host={host} />;
    case 'verdict':
      return <VerdictCard finding={a.finding} />;
    case 'citation':
      return <Citation assignment={a.assignment} stepIdx={a.stepIdx} note={a.note} />;
    case 'patch':
      return <PatchCard diff={a.patch.diff} branch={a.patch.branch} />;
    case 'verification':
      return <VerificationCard rows={a.verification.rows} />;
  }
}

// --- Diffany's charter ------------------------------------------------------

function AssertionRows({ rows }: { rows: { id: string; statement: string; source: string }[] }) {
  return (
    <div className="flex flex-col gap-[5px]">
      {rows.map((r) => (
        <div key={r.id} className="flex items-baseline gap-2.5">
          <span className="mono w-5 flex-none text-[11px]/[1.5] font-medium text-ink-8">{r.id}</span>
          <span className="flex-1 text-[13.5px]/[1.5] text-[#a8a8a8]">{r.statement}</span>
          <span className="mono flex-none text-[11px]/[1.5] text-ink-8">{r.source}</span>
        </div>
      ))}
    </div>
  );
}

// --- QAizen's recording -----------------------------------------------------

function RecordingCard({ assignment: a, host }: { assignment: Assignment; host: string }) {
  const [open, setOpen] = useState(false);
  const { before, after } = evidencePair(a);
  const url = `${host}${a.route}`;

  return (
    <div className="flex flex-col gap-[11px] rounded-[14px] bg-card-2 p-[13px]">
      <div className="flex items-center gap-[9px] px-[3px]">
        <span className="text-[13.5px]/[1] font-medium text-ink-1">Recording</span>
        <span className="mono text-[12px]/[1] text-ink-6">
          {a.sessionId} · {a.steps.length} steps · {duration(a.durationMs)}
        </span>
        <span className="flex-1" />
        <StatePill state={a.status === 'failed' ? 'failed' : 'finished'} />
      </div>

      <div className="flex gap-[11px]">
        <Shot step={before} url={url} caption={`step ${before?.idx ?? '—'} — before`} />
        <Shot
          step={after}
          url={url}
          caption={`step ${after?.idx ?? '—'} — ${after?.ok ? 'after' : 'unchanged'}`}
          note={after?.ok ? undefined : 'expected $67.20'}
          bad={!after?.ok}
        />
      </div>

      <Scrubber duration={duration(a.durationMs)} steps={a.steps.length} />

      <div className="flex px-[3px]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-chip px-[11px] py-[5px] text-[11.5px]/[1] text-ink-5 transition-colors hover:bg-[#2e2e2e] hover:text-ink-2"
        >
          Open replay
        </button>
      </div>

      {open && a.sessionId && (
        <ReplayModal sessionId={a.sessionId} title={a.brief} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function Shot({
  step,
  url,
  caption,
  note,
  bad = false,
}: {
  step?: Step;
  url: string;
  caption: string;
  note?: string;
  bad?: boolean;
}) {
  return (
    <div className="flex-1">
      <BrowserFrame url={url} flagged={bad}>
        <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="lg" />
      </BrowserFrame>
      <div className="mt-[7px] flex justify-between">
        <span className={bad ? 'text-[11px]/[1.5] text-alarm' : 'text-[11px]/[1.5] text-ink-6'}>
          {caption}
        </span>
        {note && <span className="mono text-[11px]/[1.5] text-ink-6">{note}</span>}
      </div>
    </div>
  );
}

// --- Doppler's paired panes -------------------------------------------------

function DiffPair({
  baseLabel,
  headLabel,
  rows,
}: {
  baseLabel: string;
  headLabel: string;
  rows: { label: string; base: string; head: string; differs: boolean }[];
}) {
  const Panel = ({ label, side, flagged }: { label: string; side: 'base' | 'head'; flagged: boolean }) => (
    <div
      className="flex-1 rounded-[11px] bg-card-2 px-3 py-[11px]"
      style={{ outline: flagged ? '1.5px solid var(--color-flare)' : undefined }}
    >
      <div className="mono mb-[9px] text-[10.5px]/[1] text-ink-6">{label}</div>
      {rows.map((r) => {
        const v = side === 'base' ? r.base : r.head;
        const hot = side === 'head' && r.differs;
        return (
          <div key={r.label} className="mb-1.5 flex justify-between last:mb-0">
            <span className="max-w-[60%] truncate text-[12px]/[1] text-ink-7">{shorten(r.label)}</span>
            <span
              className={hot ? 'mono text-[12px]/[1] font-medium text-alarm' : 'mono text-[12px]/[1] text-ink-2'}
            >
              {v}
            </span>
          </div>
        );
      })}
    </div>
  );

  const anyDiff = rows.some((r) => r.differs);
  return (
    <div className="flex gap-[11px]">
      <Panel label={baseLabel} side="base" flagged={false} />
      <Panel label={headLabel} side="head" flagged={anyDiff} />
    </div>
  );
}

const shorten = (s: string) => s.replace(/^\[data-testid="(.+)"\]$/, '$1').replace(/-/g, ' ');

// --- a Cast member mid-assignment -------------------------------------------

function LiveCard({ assignment: a, host }: { assignment: Assignment; host: string }) {
  const last = a.steps.at(-1);
  const elapsed = a.startedAt
    ? Math.round((Date.now() - Date.parse(a.startedAt)) / 1000)
    : 0;
  const rec = `${Math.floor(elapsed / 60)}:${String(Math.max(0, elapsed % 60)).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] bg-card-2 p-[13px]">
      <div className="flex items-center gap-[9px] px-[3px]">
        <span className="text-[13.5px]/[1] font-medium text-ink-1">Browser</span>
        <span className="text-[12px]/[1] text-ink-6">{a.brief}</span>
        <span className="flex-1" />
        <StatePill state="working" />
      </div>

      <BrowserFrame url={`${host}${a.route}`} live rec={rec} cursor={{ left: '62%', top: '58%' }}>
        <PageShot digest={last?.digest} screenshotUrl={last?.screenshotUrl} scale="lg" />
      </BrowserFrame>

      <div className="mono px-[3px] text-[11px]/[1.5] text-ink-6">
        step {a.steps.length} · {last?.label ?? 'starting'} · screenshots kept every action
      </div>
    </div>
  );
}

// --- Gavel's ledger for a finding that did not clear the gate ---------------

function VerdictCard({ finding }: { finding: Finding }) {
  const rows = [
    { label: classLabel(finding.class), value: finding.baseConfidence.toFixed(2) },
    ...finding.modifiers.map((m) => ({
      label: m.label,
      value: `${m.delta >= 0 ? '+' : '−'} ${Math.abs(m.delta).toFixed(2)}`,
    })),
  ];

  return (
    <div className="rounded-[14px] border border-dashed border-edge-3 bg-[#181818] px-[15px] py-[13px]">
      <div className="mb-[9px] flex items-center justify-between">
        <span
          className="text-[14px]/[1.3] text-ink-9 line-through"
          style={{ textDecorationColor: '#3e3e3e' }}
        >
          {finding.title}
        </span>
        <span
          className="ml-2.5 flex-none rounded-full bg-chip px-[9px] py-[5px] text-[10.5px]/[1] font-medium text-ink-9"
          style={{ letterSpacing: '.07em' }}
        >
          NOT FILED
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between border-t border-chip py-1.5">
          <span className="text-[12.5px]/[1.4] text-ink-9">{r.label}</span>
          <span className="mono text-[12px]/[1.4] text-ink-5">{r.value}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-chip pt-[7px]">
        <span className="text-[12.5px]/[1.4] font-medium text-ink-3">threshold 0.70</span>
        <span className="mono text-[12px]/[1.4] font-medium text-ink-3">
          {finding.confidence.toFixed(2)} ·{' '}
          {finding.status === 'pre_existing' ? 'already on main' : 'discarded'}
        </span>
      </div>
    </div>
  );
}

const classLabel = (c: string) =>
  ({
    hard_failure: 'hard failure — 5xx or uncaught',
    unclaimed_delta: 'differs from main, nothing claimed it',
    assertion_violation: 'contradicts an assertion',
  })[c] ?? c;

// --- Clueso citing a frame somebody else captured ---------------------------

function Citation({
  assignment,
  stepIdx,
  note,
}: {
  assignment: Assignment;
  stepIdx: number;
  note: string;
}) {
  const step = assignment.steps.find((s) => s.idx === stepIdx) ?? assignment.steps.at(-1);
  const bot = BOTS[botFor(assignment)];

  return (
    <div className="flex items-center gap-3 rounded-[13px] bg-[#181818] px-[13px] py-[11px]">
      <div className="w-[150px] flex-none">
        <BrowserFrame dots={3} radius={7}>
          <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="sm" />
        </BrowserFrame>
      </div>
      <div className="flex-1">
        <div className="mono text-[11px]/[1.5] text-ink-6">
          CITED · {bot.name.toUpperCase()} · {assignment.assertionId} · STEP {stepIdx}
        </div>
        <div className="mt-[3px] text-[13px]/[1.55] text-ink-7">{note}</div>
      </div>
    </div>
  );
}

// --- Patchouli's diff -------------------------------------------------------

export function PatchCard({ diff, branch }: { diff: string; branch?: string }) {
  const lines = diff.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l));
  return (
    <div className="rounded-[13px] bg-[#181818] px-[13px] py-3">
      <div className="mono overflow-x-auto rounded-[8px] bg-shot px-3 py-2.5 text-[11.5px]/[1.7]">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.startsWith('+')
                ? 'text-plus'
                : l.startsWith('-')
                  ? 'text-minus'
                  : l.startsWith('@@')
                    ? 'text-ink-8'
                    : 'text-ink-7'
            }
          >
            {l || ' '}
          </div>
        ))}
      </div>
      {branch && (
        <div className="mono mt-[9px] text-[11px]/[1.5] text-ink-8">
          {branch} · two attempts, then it opens as a draft marked unverified
        </div>
      )}
    </div>
  );
}

// --- Encore's before and after ----------------------------------------------

function VerificationCard({
  rows,
}: {
  rows: {
    label: string;
    before: string;
    after: string;
    beforeValue?: string;
    afterValue?: string;
  }[];
}) {
  return (
    <div className="rounded-[13px] bg-[#181818] px-[14px] py-3">
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-t border-chip py-[9px] first:border-t-0 first:pt-0"
        >
          <span className="flex-1 text-[12.5px]/[1.45] text-ink-5">{r.label}</span>
          <span className="mono text-[12px]/[1] text-alarm line-through">{r.beforeValue}</span>
          <span className="text-[12px]/[1] text-ink-8">→</span>
          <span className="mono text-[12px]/[1] text-plus">{r.afterValue}</span>
        </div>
      ))}
    </div>
  );
}

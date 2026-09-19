'use client';

import clsx from 'clsx';
import type { Assignment, Finding } from '@aftershock/schema';
import type { Attachment } from '@/lib/room';
import { botFor } from '@/lib/room';
import { BOTS } from '@/components/bots/registry';
import { BrowserFrame } from '@/components/ui/BrowserFrame';
import { PageShot } from '@/components/ui/PageShot';
import { IssueCard } from './IssueCard';
import { PatchCard } from './PatchCard';

export function Attachments({ items }: { items: Attachment[] }) {
  return (
    <>
      {items.map((a, i) => (
        <One key={i} a={a} />
      ))}
    </>
  );
}

function One({ a }: { a: Attachment }) {
  switch (a.kind) {
    case 'assertions':
      return <AssertionRows rows={a.rows} />;
    case 'values':
      return <ValueReadout {...a} />;
    case 'diffpair':
      return <DiffPair {...a} />;
    case 'verdict':
      return <VerdictCard finding={a.finding} />;
    case 'citation':
      return <Citation assignment={a.assignment} stepIdx={a.stepIdx} note={a.note} />;
    case 'patch':
      return <PatchCard diff={a.patch.diff} branch={a.patch.branch} />;
    case 'verification':
      return <VerificationCard rows={a.verification.rows} />;
    case 'issue':
      return (
        <IssueCard
          issue={a.issue}
          finding={a.finding}
          verification={a.verification}
          compact={a.compact}
        />
      );
  }
}

// --- Diffany's charter ------------------------------------------------------

function AssertionRows({ rows }: { rows: { id: string; statement: string; source: string }[] }) {
  return (
    <div className="mt-[9px] flex flex-col gap-[5px]">
      {rows.map((r) => (
        <div key={r.id} className="flex items-baseline gap-2.5">
          <span className="mono w-5 flex-none text-[11px]/[1.5] font-medium text-ink-8">{r.id}</span>
          <span className="flex-1 text-[13.5px]/[1.5] text-[#a8a8a8]">{r.statement}</span>
          <span className="mono hidden flex-none text-[11px]/[1.5] text-ink-8 sm:block">
            {r.source}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- the value that did not move --------------------------------------------

/**
 * A before/after readout rather than two more screenshots.
 *
 * The recording is already in the browsers row above; repeating it as a pair
 * of page mocks says the same thing twice and doubles the height of the
 * message. Two values side by side make the argument faster.
 *
 * Deliberately app-agnostic. The value is whatever the assertion was about —
 * an order total, a result count, a queue depth, a toggle's state — so the
 * labels are "before"/"after" and never anything domain-shaped.
 */
function ValueReadout({
  label,
  before,
  after,
  expected,
}: {
  label: string;
  before: string;
  after: string;
  expected?: string;
}) {
  return (
    <div className="mt-[9px] flex flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-[11px] bg-card-2 px-3.5 py-3">
      <span className="text-[12px]/[1] text-ink-8">{label}</span>
      <span className="mono text-[13px]/[1] text-ink-4">{before}</span>
      <span className="text-[12px]/[1] text-ink-8">then</span>
      <span className="mono text-[13px]/[1] font-medium text-alarm">{after}</span>
      {expected && (
        <>
          <span className="text-[12px]/[1] text-ink-8">expected</span>
          <span className="mono text-[13px]/[1] text-plus">{expected.replace(/^expected\s+/i, '')}</span>
        </>
      )}
    </div>
  );
}

// --- Doppler's paired panes -------------------------------------------------

const shorten = (s: string) => s.replace(/^\[data-testid="(.+)"\]$/, '$1').replace(/-/g, ' ');

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
      className="min-w-0 flex-1 rounded-[11px] bg-card-2 px-3 py-[11px]"
      style={{ outline: flagged ? '1.5px solid var(--color-flare)' : undefined }}
    >
      <div className="mono mb-[9px] truncate text-[10.5px]/[1] text-ink-6">{label}</div>
      {rows.map((r) => {
        const v = side === 'base' ? r.base : r.head;
        const hot = side === 'head' && r.differs;
        return (
          <div key={r.label} className="mb-1.5 flex justify-between gap-2 last:mb-0">
            <span className="truncate text-[12px]/[1] text-ink-7">{shorten(r.label)}</span>
            <span
              className={clsx(
                'mono shrink-0 text-[12px]/[1]',
                hot ? 'font-medium text-alarm' : 'text-ink-2',
              )}
            >
              {v}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="mt-[9px] flex gap-[11px]">
      <Panel label={baseLabel} side="base" flagged={false} />
      <Panel label={headLabel} side="head" flagged={rows.some((r) => r.differs)} />
    </div>
  );
}

// --- Gavel's ledger for a finding that did not clear the gate ---------------

const classLabel = (c: string) =>
  ({
    hard_failure: 'hard failure — 5xx or uncaught',
    unclaimed_delta: 'differs from main, nothing claimed it',
    assertion_violation: 'contradicts an assertion',
  })[c] ?? c;

function VerdictCard({ finding }: { finding: Finding }) {
  const rows = [
    { label: classLabel(finding.class), value: finding.baseConfidence.toFixed(2) },
    ...finding.modifiers.map((m) => ({
      label: m.label,
      value: `${m.delta >= 0 ? '+' : '−'} ${Math.abs(m.delta).toFixed(2)}`,
    })),
  ];

  return (
    <div className="mt-[9px] rounded-[14px] border border-dashed border-edge-3 bg-card px-[15px] py-[13px]">
      <div className="mb-[9px] flex items-center justify-between gap-2.5">
        <span
          className="text-[14px]/[1.3] text-ink-9 line-through"
          style={{ textDecorationColor: '#3e3e3e' }}
        >
          {finding.title}
        </span>
        <span className="mono flex-none rounded-full bg-chip px-[9px] py-[5px] text-[10px]/[1] text-ink-9">
          not filed
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between gap-3 border-t border-chip py-1.5">
          <span className="text-[12.5px]/[1.4] text-ink-9">{r.label}</span>
          <span className="mono shrink-0 text-[12px]/[1.4] text-ink-5">{r.value}</span>
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
    <div className="mt-[9px] flex items-center gap-3 rounded-[13px] bg-card px-[13px] py-[11px]">
      <div className="w-[136px] flex-none">
        <BrowserFrame dots={3} radius={7}>
          <PageShot digest={step?.digest} screenshotUrl={step?.screenshotUrl} scale="sm" />
        </BrowserFrame>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mono text-[11px]/[1.5] text-ink-6">
          {bot.name} · {assignment.assertionId} · step {stepIdx}
        </div>
        <div className="mt-[3px] text-[13px]/[1.55] text-ink-7">{note}</div>
      </div>
    </div>
  );
}

// --- before and after, per re-run assignment ----------------------------------------------

function VerificationCard({
  rows,
}: {
  rows: { label: string; beforeValue?: string; afterValue?: string }[];
}) {
  return (
    <div className="mt-[9px] rounded-[13px] bg-card px-[14px] py-3">
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-t border-chip py-[9px] first:border-t-0 first:pt-0"
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px]/[1.45] text-ink-5">{r.label}</span>
          <span className="mono shrink-0 text-[12px]/[1] text-alarm line-through">{r.beforeValue}</span>
          <span className="shrink-0 text-[12px]/[1] text-ink-8">→</span>
          <span className="mono shrink-0 text-[12px]/[1] text-plus">{r.afterValue}</span>
        </div>
      ))}
    </div>
  );
}

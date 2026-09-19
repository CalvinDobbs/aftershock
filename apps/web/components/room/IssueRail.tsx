'use client';

import clsx from 'clsx';
import type { Assignment, Diagnosis, Finding, Issue, Patch, PullRequest, Verification } from '@aftershock/schema';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { BOTS, type BotId } from '@/components/bots/registry';
import { BrowserFrame } from '@/components/ui/BrowserFrame';
import { PageShot } from '@/components/ui/PageShot';
import { SectionLabel, Spinner } from '@/components/ui/atoms';

/**
 * The GitHub issue, assembled live and attributed paragraph by paragraph to
 * the bot that supplied each part.
 *
 * This is the confidence model made visible: Diffany owns what *should*
 * happen and cites the diff for it, QAizen owns what *does* happen, and only
 * Gavel owns the reproduction count and the checklist. You can see at a glance
 * that no single agent both found the bug and decided it was one.
 *
 * Stages that have not run yet render dashed rather than absent, so the shape
 * of the finished artefact is visible from the first second of the run.
 */

function RailCard({
  bot,
  bots,
  label,
  dashed = false,
  tinted = false,
  dim = false,
  children,
}: {
  bot?: BotId;
  bots?: BotId[];
  label: string;
  dashed?: boolean;
  tinted?: boolean;
  dim?: boolean;
  children: React.ReactNode;
}) {
  const who = bots ?? (bot ? [bot] : []);
  return (
    <div
      className={clsx(
        'rounded-[13px] px-[14px] py-3',
        tinted ? 'bg-[#1c1a16]' : 'bg-card',
        dashed && 'border border-dashed border-[#262626]',
      )}
    >
      <div className={clsx('mb-[9px] flex items-center gap-[7px]', dim && 'opacity-[.66]')}>
        {who.map((b) => (
          <BotAvatar key={b} bot={b} size={17} animate={false} />
        ))}
        <span
          className={clsx('text-[11.5px]/[1] font-medium', tinted ? 'text-[#c4b28f]' : 'text-ink-7')}
        >
          {who.map((b) => BOTS[b].name).join(' + ')}
        </span>
        <span className="flex-1" />
        <span className={clsx('text-[10.5px]/[1]', tinted ? 'text-[#8a7c63]' : 'text-ink-8')}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

export function IssueRail({
  finding,
  issue,
  assignments,
  diagnosis,
  patch,
  verification,
  pullRequest,
  sha,
}: {
  finding: Finding | null;
  issue: Issue | null;
  assignments: Assignment[];
  diagnosis: Diagnosis | null;
  patch: Patch | null;
  verification: Verification | null;
  pullRequest: PullRequest | null;
  sha: string;
}) {
  if (!finding) {
    return (
      <aside className="flex w-[400px] flex-none flex-col gap-3.5 overflow-y-auto border-l border-edge bg-rail-2 px-[22px] py-5">
        <SectionLabel>NOTHING FILED YET</SectionLabel>
        <div className="text-[13.5px]/[1.6] text-ink-7">
          Gavel writes here once a finding clears 0.70. Nothing reaches GitHub before that.
        </div>
      </aside>
    );
  }

  const cited = assignments.find((a) => finding.assignmentIds.includes(a.id));
  const pair = cited
    ? (() => {
        const withShot = cited.steps.filter((s) => s.digest || s.screenshotUrl);
        const after = [...withShot].reverse().find((s) => !s.ok) ?? withShot.at(-1);
        const before = withShot.filter((s) => s.idx < (after?.idx ?? 0)).at(-1);
        return { before, after };
      })()
    : { before: undefined, after: undefined };

  const done = [issue, diagnosis, patch, verification, pullRequest].filter(Boolean).length + 2;

  return (
    <aside className="flex w-[400px] flex-none flex-col gap-3.5 overflow-y-auto border-l border-edge bg-rail-2 px-[22px] py-5">
      <div className="flex items-center gap-[9px]">
        <span className="text-[14px]/[1] font-medium text-ink-1">
          {issue ? `Issue #${issue.number}` : 'Issue'}
        </span>
        {issue ? (
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-chip px-[9px] py-1 text-[11px]/[1] font-medium text-ink-5 hover:text-ink-2"
          >
            Open on GitHub
          </a>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-sunk px-[9px] py-1">
            <Spinner />
            <span className="text-[11px]/[1] font-medium text-amber">Writing</span>
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[11.5px]/[1] text-ink-8">{done} of 7</span>
      </div>

      <div className="pretty text-[20px]/[1.32] font-medium text-ink">{finding.title}</div>
      <div className="mono -mt-1 flex gap-3.5 text-[11.5px]/[1] text-ink-6">
        <span>{sha.slice(0, 7)}</span>
        <span>confidence {finding.confidence.toFixed(2)}</span>
        <span className="text-alarm">{finding.severity}</span>
      </div>

      <RailCard bot="diffany" label="what should happen">
        <div className="text-[14px]/[1.6] text-ink-3">{finding.expected}</div>
        <div className="mono mt-1.5 text-[11px]/[1.5] text-ink-8">{finding.expectedSource}</div>
      </RailCard>

      <RailCard bot="qaizen" label="what happens">
        <div className="text-[14px]/[1.6] text-ink-3">{finding.actual}</div>
      </RailCard>

      <RailCard bots={['qaizen', 'doppler']} label="evidence">
        <div className="flex gap-2">
          <Thumb step={pair.before} caption="before" />
          <Thumb step={pair.after} caption="after" bad />
          <div className="flex-1">
            <div className="flex h-[47px] items-center justify-center rounded-[6px] bg-shot">
              <span
                className="ml-[3px] block size-0"
                style={{
                  borderLeft: '10px solid #ededed',
                  borderTop: '6.5px solid transparent',
                  borderBottom: '6.5px solid transparent',
                }}
              />
            </div>
            <div className="mt-[5px] text-[10px]/[1.5] text-ink-8">mp4</div>
          </div>
        </div>
      </RailCard>

      <RailCard bot="gavel" label="reproduction">
        <ol className="mono list-decimal pl-4 text-[12px]/[1.85] text-ink-5">
          {finding.repro.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
        <div className="mono mt-[7px] text-[11px]/[1.5] text-ink-8">
          {finding.reproCount} of {finding.reproAttempts}
          {cited ? ` · cut from ${cited.steps.length} steps` : ''}
        </div>
      </RailCard>

      {diagnosis ? (
        <RailCard bot="clueso" label="suspect files">
          {diagnosis.hypotheses.map((h, i) => (
            <div
              key={h.file}
              className={clsx(
                'flex items-baseline justify-between gap-2.5',
                i === 0 ? 'border-b border-[#222] pb-2' : 'pt-2',
              )}
            >
              <div>
                <div className={clsx('mono text-[12px]/[1.4]', i === 0 ? 'text-ink-3' : 'text-ink-7')}>
                  {h.file}:{h.lines.join('–')}
                </div>
                <div className={clsx('mt-0.5 text-[11.5px]/[1.5]', i === 0 ? 'text-ink-6' : 'text-ink-8')}>
                  {h.explanation}
                </div>
              </div>
              <span className="mono flex-none text-[12px]/[1] text-ink-5">
                {h.confidence.toFixed(2)}
              </span>
            </div>
          ))}
        </RailCard>
      ) : (
        <RailCard bot="clueso" label="writing now" tinted>
          <div className="text-[14px]/[1.6] text-ink-3">
            Reading the network log before I open a file
            <span className="caret ml-0.5 inline-block h-[14px] w-1.5 align-[-2px] bg-ink-3" />
          </div>
        </RailCard>
      )}

      {issue && (
        <RailCard bot="gavel" label="fix checklist">
          <div className="flex flex-col gap-2">
            {issue.fixChecklist.map((c) => {
              const passed = verification?.checklist.find((x) => x.item === c)?.passed ?? false;
              return (
                <div key={c} className="flex items-start gap-[9px]">
                  <span
                    className={clsx(
                      'mt-0.5 flex size-[13px] flex-none items-center justify-center rounded-[3px] border',
                      passed ? 'border-plus bg-plus/15' : 'border-[#3e3e3e]',
                    )}
                  >
                    {passed && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path
                          d="M1.5 5.2l2.2 2.2L8.5 2.6"
                          stroke="var(--color-plus)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="text-[12.5px]/[1.45] text-ink-5">{c}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2.5 text-[11px]/[1.5] text-ink-8">
            Encore re-runs exactly these against the patch. The checklist is the test plan.
          </div>
        </RailCard>
      )}

      <RailCard bot="encore" label="before and after" dashed={!verification} dim={!verification}>
        <div className="flex gap-2">
          <Thumb step={pair.after} caption={verification ? 'before the fix' : 'today, broken'} bad />
          {verification ? (
            <div className="flex-1">
              <div className="flex h-[47px] items-center justify-center rounded-[6px] bg-white">
                <span className="mono text-[11px] font-medium text-[#1a7f4b]">
                  {verification.rows[0]?.afterValue}
                </span>
              </div>
              <div className="mt-[5px] text-[10px]/[1.5] text-plus">after the fix</div>
            </div>
          ) : (
            <div className="flex-1">
              <div className="mono flex h-[47px] items-center justify-center rounded-[6px] border border-dashed border-[#303030] text-[10px]/[1] text-ink-8">
                awaiting patch
              </div>
              <div className="mt-[5px] text-[10px]/[1.5] text-ink-8">after the fix</div>
            </div>
          )}
        </div>
        <div className="mt-[9px] text-[11px]/[1.5] text-ink-8">
          Two recordings of the same journey, one broken and one fixed, both attached to the PR.
        </div>
      </RailCard>

      <RailCard bot="patchouli" label="the patch" dashed={!patch} dim={!patch}>
        {patch ? (
          <div className="mono overflow-x-auto rounded-[8px] bg-shot px-3 py-2.5 text-[11.5px]/[1.7]">
            {patch.diff
              .split('\n')
              .filter((l) => l.startsWith('+') || l.startsWith('-'))
              .filter((l) => !l.startsWith('+++') && !l.startsWith('---'))
              .slice(0, 6)
              .map((l, i) => (
                <div key={i} className={l.startsWith('+') ? 'text-plus' : 'text-minus'}>
                  {l}
                </div>
              ))}
            <div className="mt-1 text-ink-8">{patch.branch}</div>
          </div>
        ) : (
          <div className="mono rounded-[8px] bg-shot px-3 py-2.5 text-[11.5px]/[1.7] text-ink-8">
            written the moment Clueso finishes
          </div>
        )}
        <div className="mt-[9px] text-[11px]/[1.5] text-ink-8">
          Two attempts, then it opens as a draft marked unverified.
        </div>
      </RailCard>

      <div className="rounded-[13px] bg-card px-[14px] py-3">
        <div className="mb-2 text-[10.5px]/[1] text-ink-8">WHEN IT IS DONE</div>
        <div className="flex flex-col gap-[7px] text-[12.5px]/[1.5] text-ink-7">
          <Row k="issue filed by" v="Maestro, on Gavel's word" />
          <Row k="branch" v={patch?.branch ?? 'pending'} mono />
          <Row
            k="pull request"
            v={pullRequest ? `#${pullRequest.number} · ${pullRequest.labels.at(-1)}` : 'pending'}
          />
          <Row k="regression test left behind" v="Playwright spec" />
        </div>
      </div>
    </aside>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{k}</span>
      <span className={clsx('truncate text-ink-4', mono && 'mono')}>{v}</span>
    </div>
  );
}

function Thumb({
  step,
  caption,
  bad = false,
}: {
  step?: { digest?: unknown; screenshotUrl?: string | null };
  caption: string;
  bad?: boolean;
}) {
  return (
    <div className="flex-1">
      <div
        className="overflow-hidden rounded-[6px]"
        style={{ outline: bad ? '1.5px solid var(--color-flare)' : undefined }}
      >
        <PageShot
          digest={step?.digest as never}
          screenshotUrl={step?.screenshotUrl}
          scale="sm"
        />
      </div>
      <div className={clsx('mt-[5px] text-[10px]/[1.5]', bad ? 'text-alarm' : 'text-ink-8')}>
        {caption}
      </div>
    </div>
  );
}

'use client';

import clsx from 'clsx';
import type { Finding, Issue, Verification } from '@aftershock/schema';
import { sayFailure, saySpec, shortTitle } from '@/lib/voice';

/**
 * The filed issue, posted into the thread by Gavel at the moment it is filed.
 *
 * It used to live in a permanent right-hand column, which meant the product's
 * output artefact occupied a third of the screen for the whole run before it
 * existed. Here it arrives when it is real, and the checklist ticks in place
 * as the Cast re-runs each item — so the card is the same object the whole way
 * through rather than two views of one issue.
 */
export function IssueCard({
  issue,
  finding,
  verification,
  compact = false,
}: {
  issue: Issue;
  finding?: Finding;
  verification?: Verification | null;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex items-center gap-2.5 rounded-[11px] border border-[#242424] bg-card px-3.5 py-2.5 transition-colors hover:border-[#2e2e2e]"
      >
        <span className="mono shrink-0 text-[11.5px]/[1] text-ink-6">#{issue.number}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]/[1.4] text-ink-4">
          {shortTitle(issue.title, 110)}
        </span>
        {finding && (
          <span className="mono shrink-0 text-[11px]/[1] text-ink-7">
            {finding.confidence.toFixed(2)}
          </span>
        )}
        <span className="mono shrink-0 text-[11px]/[1] text-alarm">{finding?.severity}</span>
      </a>
    );
  }

  return (
    <div className="mt-[9px] overflow-hidden rounded-[14px] border border-[#2a2a2a] bg-card">
      <div className="flex items-center gap-2.5 border-b border-edge px-[15px] py-3">
        <span className="mono text-[11.5px]/[1] text-ink-6">#{issue.number}</span>
        <span className="text-[14px]/[1.3] font-medium text-ink-1">{shortTitle(issue.title, 120)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-[15px] pt-3">
        {finding && (
          <>
            <span className="mono text-[11.5px]/[1] text-ink-6">
              confidence {finding.confidence.toFixed(2)}
            </span>
            <span className="mono text-[11.5px]/[1] text-alarm">{finding.severity}</span>
            <span className="mono text-[11.5px]/[1] text-ink-6">
              {finding.reproCount} of {finding.reproAttempts} replays
            </span>
          </>
        )}
        {issue.labels.map((l) => (
          <span key={l} className="mono rounded-full bg-chip px-2 py-[3px] text-[10px]/[1] text-ink-7">
            {l}
          </span>
        ))}
      </div>

      {finding && (
        <div className="grid gap-x-4 gap-y-2.5 px-[15px] pt-3.5 sm:grid-cols-2">
          <div>
            <div className="text-[11px]/[1.5] text-ink-8">should happen</div>
            <div className="mt-1 text-[13px]/[1.55] text-ink-4">{saySpec(finding.expected)}</div>
            <div className="mono mt-1.5 text-[10.5px]/[1.5] text-ink-8">{finding.expectedSource}</div>
          </div>
          <div>
            <div className="text-[11px]/[1.5] text-ink-8">does happen</div>
            <div className="mt-1 text-[13px]/[1.55] text-ink-4">{sayFailure(finding.actual)}</div>
          </div>
        </div>
      )}

      <div className="px-[15px] pt-3.5 pb-[15px]">
        <div className="text-[11px]/[1.5] text-ink-8">
          fix checklist
          {verification ? ' — re-run against the patch' : ' — the Cast re-runs exactly these'}
        </div>
        <div className="mt-2 flex flex-col gap-[7px]">
          {issue.fixChecklist.map((c) => {
            const passed = verification?.checklist.find((x) => x.item === c)?.passed ?? false;
            return (
              <div key={c} className="flex items-start gap-2.5">
                <span
                  className={clsx(
                    'mt-[3px] flex size-[13px] flex-none items-center justify-center rounded-[3px] border',
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
                <span className={clsx('text-[12.5px]/[1.45]', passed ? 'text-ink-5' : 'text-ink-7')}>
                  {saySpec(c)}
                </span>
              </div>
            );
          })}
        </div>

        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3.5 inline-block rounded-full bg-chip px-3 py-[6px] text-[11.5px]/[1] text-ink-5 transition-colors hover:bg-[#2e2e2e] hover:text-ink-2"
        >
          Open on GitHub
        </a>
      </div>
    </div>
  );
}

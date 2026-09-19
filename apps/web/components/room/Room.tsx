'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunDetail, RunSummary } from '@aftershock/schema';
import type { BotId } from '@/components/bots/registry';
import { useRunStream } from '@/lib/useRunStream';
import { duration } from '@/lib/format';
import { Sidebar, type RosterStatus } from './Sidebar';
import { RunHeader } from './RunHeader';
import { Message } from './Message';
import { Handoff } from './Handoff';
import { SystemLine } from './SystemLine';
import { Waiting } from './Waiting';
import { Composer } from './Composer';
import { BrowsersGrid } from './BrowsersGrid';
import { IssueRail } from './IssueRail';

const strip = (u: string | null) => (u ?? '').replace(/^https?:\/\//, '');

export function Room({
  runId,
  seed,
  runs,
  maxConcurrent,
}: {
  runId: string;
  seed: RunDetail;
  runs: RunSummary[];
  maxConcurrent: number;
}) {
  // speed 1 paces the stored run back out (the demo reveal); speed 0 replays
  // it instantly, which is what you want when browsing a finished run.
  const [speed, setSpeed] = useState(1);
  const { state, entries } = useRunStream(runId, seed, speed);
  const [view, setView] = useState<'room' | 'browsers'>('room');
  const bottom = useRef<HTMLDivElement>(null);

  // The thread follows the run the way a chat follows a conversation.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length, view]);

  const run = state.run ?? seed.run;
  const host = strip(run.previewUrl);
  const baseHost = strip(run.baseUrl);
  const sessions = state.assignments.reduce(
    (n, a) => n + (a.archetype === 'differential' ? 2 : 1),
    0,
  );

  const roster = useMemo(() => buildRoster(state), [state]);

  const topFinding =
    [...state.findings]
      .filter((f) => f.status === 'confirmed')
      .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  const issue = topFinding ? (state.issues.find((i) => i.findingId === topFinding.id) ?? null) : null;

  const runCostMs = state.assignments.reduce(
    (ms, a) => ms + (a.durationMs ?? 0) * (a.archetype === 'differential' ? 2 : 1),
    0,
  );

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <Sidebar
        runs={runs}
        activeRunId={runId}
        roster={roster}
        findings={state.findings}
        runCostMs={runCostMs}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-stage">
        <RunHeader
          run={run}
          sessions={sessions}
          view={view}
          onView={setView}
          replaying={speed > 0 && !state.pullRequest}
          onSkip={() => setSpeed(0)}
          onReplay={() => setSpeed(1)}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {view === 'browsers' ? (
            <BrowsersGrid
              assignments={state.assignments}
              host={host}
              baseHost={baseHost}
              maxConcurrent={maxConcurrent}
            />
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-[17px] overflow-y-auto px-[26px] pt-5">
              {entries.map((e) => {
                switch (e.kind) {
                  case 'system':
                    return <SystemLine key={e.id} text={e.text} />;
                  case 'handoff':
                    return <Handoff key={e.id} {...e} />;
                  case 'waiting':
                    return <Waiting key={e.id} bot={e.bot} text={e.text} />;
                  case 'message':
                    return <Message key={e.id} {...e} host={host} />;
                }
              })}
              <div ref={bottom} className="mt-auto">
                <Composer runId={runId} />
              </div>
            </div>
          )}

          <IssueRail
            finding={topFinding}
            issue={issue}
            assignments={state.assignments}
            diagnosis={state.diagnosis}
            patch={state.patch}
            verification={state.verification}
            pullRequest={state.pullRequest}
            sha={run.commit.sha}
          />
        </div>
      </div>
    </div>
  );
}

/** Sidebar roster status, entirely derived from pipeline state. */
function buildRoster(s: ReturnType<typeof useRunStream>['state']): Record<BotId, RosterStatus> {
  const idle = (text: string): RosterStatus => ({ text, tone: 'idle' });
  const live = (text: string): RosterStatus => ({ text, tone: 'live' });
  const bad = (text: string): RosterStatus => ({ text, tone: 'bad' });

  const cast = (archetype: 'conformance' | 'differential'): RosterStatus => {
    const mine = s.assignments.filter((a) => a.archetype === archetype);
    if (mine.length === 0) return idle('waiting');
    const running = mine.find((a) => a.status === 'running');
    if (running) return live(duration(Date.now() - Date.parse(running.startedAt ?? '')));
    const failed = mine.filter((a) => a.status === 'failed').length;
    if (failed > 0) return bad(failed === 1 ? 'found one' : `found ${failed}`);
    if (mine.every((a) => a.status === 'queued')) return idle('queued');
    return { text: `clean · ${duration(mine[0]?.durationMs ?? null)}`, tone: 'idle' };
  };

  const kept = s.findings.filter((f) => f.status === 'confirmed').length;
  const cut = s.findings.length - kept;

  return {
    maestro: s.run?.status === 'complete' ? { text: 'closed the run', tone: 'idle' } : live('open'),
    diffany: s.charter
      ? { text: `${s.charter.assertions.length} assertions`, tone: 'idle' }
      : live('reading'),
    qaizen: cast('conformance'),
    doppler: cast('differential'),
    gavel: s.findings.length
      ? { text: `kept ${kept}, cut ${cut}`, tone: 'idle' }
      : s.active === 'critic'
        ? live('weighing')
        : idle('waiting'),
    clueso: s.diagnosis
      ? { text: s.diagnosis.hypotheses[0]?.confidence.toFixed(2) ?? 'done', tone: 'idle' }
      : s.active === 'sleuth'
        ? live('writing')
        : idle('waiting'),
    patchouli: s.patch
      ? { text: `attempt ${s.patch.attempt}`, tone: 'idle' }
      : s.active === 'understudy'
        ? live('patching')
        : idle('waiting'),
    encore: s.verification
      ? { text: s.verification.passed ? 'verified' : 'sent it back', tone: 'idle' }
      : s.active === 'curtain_call'
        ? live('re-running')
        : idle('waiting'),
  };
}

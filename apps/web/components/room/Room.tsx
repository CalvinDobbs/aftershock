'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunDetail, RunSummary } from '@aftershock/schema';
import type { BotId } from '@/components/bots/registry';
import { BOTS } from '@/components/bots/registry';
import { useRunStream } from '@/lib/useRunStream';
import { duration } from '@/lib/format';
import { Sidebar, type RosterStatus } from './Sidebar';
import { RunHeader } from './RunHeader';
import { Message } from './Message';
import { Handoff } from './Handoff';
import { SystemLine } from './SystemLine';
import { Typing } from './Typing';
import { Composer } from './Composer';
import { BrowsersRow } from './BrowsersRow';

export function Room({
  runId,
  seed,
  runs,
}: {
  runId: string;
  seed: RunDetail;
  runs: RunSummary[];
}) {
  // speed 1 paces the stored run back out; speed 0 replays it instantly,
  // which is what you want when browsing a run that finished hours ago.
  const [speed, setSpeed] = useState(1);
  const { state, entries } = useRunStream(runId, seed, speed);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length]);

  const run = state.run ?? seed.run;
  const sessions = state.assignments.reduce(
    (n, a) => n + (a.archetype === 'differential' ? 2 : 1),
    0,
  );
  const roster = useMemo(() => buildRoster(state), [state]);
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
        runCostMs={runCostMs}
        author={run.commit.author}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-stage">
        <RunHeader
          run={run}
          sessions={sessions}
          replaying={speed > 0 && !state.pullRequest}
          onSkip={() => setSpeed(0)}
          onReplay={() => setSpeed(1)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* The column is wide enough for evidence; the speech bubbles inside
              it are capped separately, because prose past ~80 characters a line
              stops being readable however wide the window is. */}
          <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col gap-[19px] px-6 pt-6">
            {entries.map((e) => {
              switch (e.kind) {
                case 'system':
                  return <SystemLine key={e.id} text={e.text} />;
                case 'handoff':
                  return <Handoff key={e.id} {...e} />;
                case 'browsers':
                  return <BrowsersRow key={e.id} feeds={e.feeds} note={e.note} />;
                case 'typing':
                  return <Typing key={e.id} bot={e.bot} verb={e.verb} />;
                case 'message':
                  return <Message key={e.id} {...e} />;
              }
            })}
            <div ref={bottom} className="mt-auto">
              <Composer runId={runId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rail status, entirely derived from pipeline state. */
function buildRoster(s: ReturnType<typeof useRunStream>['state']): Record<BotId, RosterStatus> {
  const verb = (b: BotId) => BOTS[b].doing[0]!;
  const idle = (line = 'waiting'): RosterStatus => ({ line, tone: 'idle' });

  const cast = (archetype: 'conformance' | 'differential'): RosterStatus => {
    const mine = s.assignments.filter((a) => a.archetype === archetype);
    if (mine.length === 0) return idle();

    // The Cast owns verification too — Curtain Call is these same bots
    // replaying their own Actions against the fix preview.
    if (s.verification) {
      const ids = new Set(mine.map((a) => a.id));
      const rows = s.verification.rows.filter((r) => ids.has(r.assignmentId));
      if (rows.length > 0) {
        const green = rows.every((r) => r.after === 'passed');
        return { line: green ? `re-ran ${rows.length}, green` : 'still red', tone: green ? 'done' : 'bad' };
      }
    }
    if (s.active === 'curtain_call') return { line: verb(archetype === 'differential' ? 'doppler' : 'qaizen'), tone: 'live' };

    const running = mine.filter((a) => a.status === 'running');
    if (running.length > 0) {
      const a = running[0]!;
      return {
        line:
          archetype === 'differential'
            ? 'running both sides'
            : `${a.assertionId} · step ${a.steps.length}`,
        tone: 'live',
      };
    }
    const failed = mine.filter((a) => a.status === 'failed').length;
    if (failed > 0) return { line: failed === 1 ? 'found one' : `found ${failed}`, tone: 'bad' };
    if (mine.every((a) => a.status === 'queued')) return idle('queued');
    return { line: `clean · ${duration(mine[0]?.durationMs ?? null)}`, tone: 'done' };
  };

  const kept = s.findings.filter((f) => f.status === 'confirmed').length;
  const cut = s.findings.length - kept;

  return {
    maestro: idle(),
    diffany: s.charter
      ? { line: `${s.charter.assertions.length} assertions written`, tone: 'done' }
      : { line: verb('diffany'), tone: 'live' },
    qaizen: cast('conformance'),
    doppler: cast('differential'),
    gavel: s.findings.length
      ? { line: `kept ${kept}, cut ${cut}`, tone: 'done' }
      : s.active === 'critic'
        ? { line: verb('gavel'), tone: 'live' }
        : idle(),
    clueso: s.diagnosis
      ? { line: s.diagnosis.hypotheses[0]?.file ?? 'found it', tone: 'done' }
      : s.active === 'sleuth'
        ? { line: verb('clueso'), tone: 'live' }
        : idle(),
    patchouli: s.patch
      ? { line: `patch on attempt ${s.patch.attempt}`, tone: 'done' }
      : s.active === 'understudy'
        ? { line: verb('patchouli'), tone: 'live' }
        : idle(),
  };
}

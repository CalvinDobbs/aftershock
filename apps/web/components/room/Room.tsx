'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunDetail, RunSummary } from '@aftershock/schema';
import type { BotId } from '@/components/bots/registry';
import { BOTS } from '@/components/bots/registry';
import { useRunStream } from '@/lib/useRunStream';
import { duration } from '@/lib/format';
import { Sidebar, type RosterStatus } from './Sidebar';
import { BotProfile, type ProfileStat } from './BotProfile';
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
  // A finished run has nothing to pace: the Director's journal replays its
  // whole backlog on connect. Pacing is only for the fixture path, where
  // there is no live stream to follow.
  const { state, entries } = useRunStream(runId, seed, 1);
  const bottom = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<BotId | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length]);

  // The open profile lives in the URL, so "here's what Doppler does" is a
  // link rather than a set of instructions. Read after mount: the server
  // render has no query string to agree with.
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('bot');
    if (b && b in BOTS) setProfile(b as BotId);
  }, []);

  const showProfile = (b: BotId | null) => {
    setProfile(b);
    const url = new URL(window.location.href);
    if (b) url.searchParams.set('bot', b);
    else url.searchParams.delete('bot');
    window.history.replaceState(null, '', url);
  };

  const run = state.run ?? seed.run;
  const sessions = state.assignments.reduce(
    (n, a) => n + (a.archetype === 'differential' ? 2 : 1),
    0,
  );
  const roster = useMemo(() => buildRoster(state), [state]);
  const stats = useMemo(() => (profile ? statsFor(profile, state) : []), [profile, state]);
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
        onSelectBot={(b) => showProfile(profile === b ? null : b)}
        selectedBot={profile}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-stage">
        <RunHeader run={run} sessions={sessions} />

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

      {profile && (
        <BotProfile
          bot={profile}
          status={roster[profile]}
          stats={stats}
          onClose={() => showProfile(null)}
        />
      )}
    </div>
  );
}

/**
 * What one agent actually did in this run.
 *
 * Read off the same pipeline state the thread is drawn from, so the numbers in
 * a profile and the numbers in the transcript can never disagree.
 */
function statsFor(bot: BotId, s: ReturnType<typeof useRunStream>['state']): ProfileStat[] {
  const out: ProfileStat[] = [];
  const secs = (ms: number | null | undefined) => (ms ? `${(ms / 1000).toFixed(1)}s` : '—');

  if (bot === 'diffany' && s.charter) {
    out.push({ label: 'Assertions written', value: String(s.charter.assertions.length) });
    out.push({ label: 'Claims read from the diff', value: String(s.charter.intent.claims.length) });
  }

  if (bot === 'qaizen' || bot === 'doppler') {
    const archetype = bot === 'doppler' ? 'differential' : 'conformance';
    const mine = s.assignments.filter((a) => a.archetype === archetype);
    if (mine.length > 0) {
      out.push({ label: 'Assignments', value: String(mine.length) });
      out.push({
        label: 'Browser sessions',
        value: String(mine.length * (archetype === 'differential' ? 2 : 1)),
      });
      out.push({ label: 'Passed', value: String(mine.filter((a) => a.status === 'passed').length) });
      out.push({ label: 'Found something', value: String(mine.filter((a) => a.status === 'failed').length) });
      out.push({ label: 'Steps driven', value: String(mine.reduce((n, a) => n + a.steps.length, 0)) });
      const ms = mine.reduce((t, a) => t + (a.durationMs ?? 0), 0);
      out.push({ label: 'Browser time', value: secs(ms) });
      const rows = s.verification?.rows.filter((r) => mine.some((a) => a.id === r.assignmentId)) ?? [];
      if (rows.length > 0) {
        out.push({ label: 'Re-ran against the fix', value: `${rows.filter((r) => r.after === 'passed').length} of ${rows.length} green` });
      }
    }
  }

  if (bot === 'gavel' && s.findings.length > 0) {
    const kept = s.findings.filter((f) => f.status === 'confirmed');
    out.push({ label: 'Findings reviewed', value: String(s.findings.length) });
    out.push({ label: 'Filed', value: String(s.issues.length) });
    out.push({ label: 'Discarded', value: String(s.findings.length - kept.length) });
    if (kept.length > 0) {
      const top = kept.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      out.push({ label: 'Highest confidence', value: top.confidence.toFixed(2) });
    }
  }

  if (bot === 'clueso' && s.diagnosis) {
    const h = s.diagnosis.hypotheses[0];
    out.push({ label: 'Hypotheses ranked', value: String(s.diagnosis.hypotheses.length) });
    if (h) {
      out.push({ label: 'Top suspect', value: h.file });
      out.push({ label: 'Confidence', value: h.confidence.toFixed(2) });
    }
  }

  if (bot === 'patchouli' && s.patch) {
    const lines = s.patch.diff.split('\n');
    const plus = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const minus = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    out.push({ label: 'Attempt', value: String(s.patch.attempt) });
    out.push({ label: 'Change', value: `+${plus} −${minus}` });
    out.push({ label: 'Verified', value: s.patch.verified ? 'yes' : 'not yet' });
    if (s.pullRequest) out.push({ label: 'Pull request', value: `#${s.pullRequest.number}` });
  }

  return out;
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

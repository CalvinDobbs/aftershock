import { describe, expect, it } from 'vitest';

import { deriveRoom, type RunState } from './room';
import * as golden from '@/fixtures/golden-run';

/**
 * The transcript is what a judge reads. Every other test in the repo protects
 * a number; these protect the sentence that number turns into.
 *
 * Three shapes matter: a run that found something, a run that found nothing,
 * and a run that died half way. The last is the one most likely to be wrong,
 * because it is the one nobody rehearses.
 */

const state = (over: Partial<RunState> = {}): RunState => ({
  run: golden.run,
  charter: golden.charter,
  assignments: golden.assignments,
  findings: golden.findings,
  issues: golden.issues,
  diagnosis: golden.diagnosis,
  patch: golden.patch,
  verification: golden.verification,
  pullRequest: golden.pullRequest,
  ...over,
});

const kinds = (s: RunState) => deriveRoom(s).map((e) => e.kind);
const said = (s: RunState, bot: string) =>
  deriveRoom(s).find((e) => e.kind === 'message' && e.bot === bot);

describe('a run that found something', () => {
  it('opens on what the author pushed, not on an agent', () => {
    const first = deriveRoom(state())[0]!;
    expect(first.kind).toBe('system');
    expect((first as { text: string }).text).toContain('pushed');
  });

  it('gives every bot with something to say exactly one turn', () => {
    const messages = deriveRoom(state()).filter((e) => e.kind === 'message');
    const bots = messages.map((m) => (m as { bot: string }).bot);
    // Six bots speak at most once each; the Cast speaks twice only because
    // it both reports and re-runs.
    expect(new Set(bots).size).toBeGreaterThanOrEqual(5);
    expect(bots).toContain('diffany');
    expect(bots).toContain('gavel');
  });

  it('never gives Maestro a turn — the Director is the system voice', () => {
    const bots = deriveRoom(state())
      .filter((e) => e.kind === 'message')
      .map((m) => (m as { bot: string }).bot);
    expect(bots).not.toContain('maestro');
  });

  it('shows every browser in one row rather than one card per agent', () => {
    const browsers = deriveRoom(state()).find((e) => e.kind === 'browsers');
    expect(browsers).toBeDefined();
    expect((browsers as { feeds: unknown[] }).feeds).toHaveLength(golden.assignments.length);
  });

  it('quotes the diff back at the author, with its citation', () => {
    const diffany = said(state(), 'diffany') as { body: string; attachments: { kind: string }[] };
    // Quoted back in the author's own terms, lower-cased into the sentence.
    const summary = golden.charter.intent.summary;
    expect(diffany.body).toContain(summary[0]!.toLowerCase() + summary.slice(1, 30));
    expect(diffany.attachments.map((a) => a.kind)).toContain('assertions');
  });

  it('lets Gavel show its arithmetic and post the issue it filed', () => {
    const gavel = said(state(), 'gavel') as { body: string; attachments: { kind: string }[] };
    // The verdict names the reproduction count: 3 of 3 is a different claim
    // from 1 of 1, and hiding the difference is how tools lose trust.
    expect(gavel.body).toMatch(/\d+ of \d+/);
    expect(gavel.attachments.map((a) => a.kind)).toContain('verdict');
    expect(gavel.attachments.map((a) => a.kind)).toContain('issue');
  });

  it('closes on the Cast confirming its own fix, not on a new character', () => {
    const entries = deriveRoom(state());
    const verifiers = entries.filter(
      (e) => e.kind === 'message' && (e as { role: string }).role === 're-run against the fix',
    );
    expect(verifiers.length).toBeGreaterThan(0);
    expect(verifiers.map((v) => (v as { bot: string }).bot)).toContain('qaizen');
  });
});

describe('a run that found nothing', () => {
  const clean = state({
    findings: [],
    issues: [],
    diagnosis: null,
    patch: null,
    verification: null,
    pullRequest: null,
    assignments: golden.assignments.map((a) => ({ ...a, status: 'passed' as const })),
  });

  it('says nothing rather than inventing a verdict', () => {
    // The Cast was still dispatched — that handoff is real. What must not
    // appear is the handoff to Gavel, because there is nothing to judge.
    const handoffs = deriveRoom(clean).filter((e) => e.kind === 'handoff');
    expect(handoffs).toHaveLength(1);
    expect(handoffs.map((h) => (h as { to: string[] }).to.join())).not.toContain('gavel');

    const bots = deriveRoom(clean)
      .filter((e) => e.kind === 'message')
      .map((m) => (m as { bot: string }).bot);
    expect(bots).not.toContain('gavel');
    expect(bots).not.toContain('clueso');
  });

  it('still shows the browsers, because the work happened', () => {
    const browsers = deriveRoom(clean).find((e) => e.kind === 'browsers');
    expect(browsers).toBeDefined();
    expect((browsers as { note: string }).note).toContain('all clean');
  });

  it('keeps passing agents out of the thread', () => {
    // A room where everyone reports in is a room nobody reads: only Diffany
    // speaks, because no agent found anything worth saying.
    const messages = deriveRoom(clean).filter((e) => e.kind === 'message');
    expect(messages).toHaveLength(1);
    expect((messages[0] as { bot: string }).bot).toBe('diffany');
  });
});

describe('a run that died half way', () => {
  const stalled = state({
    run: { ...golden.run, status: 'running', finishedAt: null },
    findings: [],
    issues: [],
    diagnosis: null,
    patch: null,
    verification: null,
    pullRequest: null,
    assignments: golden.assignments.map((a) => ({ ...a, status: 'passed' as const })),
  });

  it('names who the room is waiting on instead of going silent', () => {
    const typing = deriveRoom(stalled).find((e) => e.kind === 'typing');
    expect(typing).toBeDefined();
    expect((typing as { verb: string }).verb.length).toBeGreaterThan(0);
  });

  it('reports a crashed agent rather than leaving a gap', () => {
    const errored = state({
      assignments: golden.assignments.map((a, i) =>
        i === 0 ? { ...a, status: 'errored' as const, trace: [] } : a,
      ),
    });
    const message = deriveRoom(errored).find(
      (e) => e.kind === 'message' && (e as { body: string }).body.includes('session died'),
    );
    expect(message).toBeDefined();
  });

  it('renders nothing at all before the run exists', () => {
    expect(deriveRoom(state({ run: null }))).toEqual([]);
  });

  it('survives a charter that never arrived', () => {
    const noCharter = state({ charter: null });
    expect(() => deriveRoom(noCharter)).not.toThrow();
    const bots = deriveRoom(noCharter)
      .filter((e) => e.kind === 'message')
      .map((m) => (m as { bot: string }).bot);
    expect(bots).not.toContain('diffany');
  });
});

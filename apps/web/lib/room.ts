import type {
  Assignment,
  Diagnosis,
  Finding,
  Issue,
  Patch,
  PullRequest,
  Run,
  Step,
  TestCharter,
  Verification,
  VerificationRow,
} from '@aftershock/schema';
import { BOTS, BOT_BY_ARCHETYPE, type BotId } from '@/components/bots/registry';

/**
 * The room is a *projection* of the pipeline, not a data source the pipeline
 * has to feed.
 *
 * The backend emits exactly what the PRD specifies. Nothing in it knows this
 * dashboard renders a conversation. Where a bot speaks, the words come from
 * `Assignment.trace`, which the PRD already requires every agent to emit;
 * stages with no trace are composed from their structured output.
 *
 * Maestro has no seat in the rail — the Director is deterministic code, so it
 * speaks as the room's centred system lines instead.
 */

export type Attachment =
  | { kind: 'assertions'; rows: { id: string; statement: string; source: string }[] }
  /** A before/after value readout. Text, because the recording is already above it. */
  | { kind: 'values'; before: string; after: string; expected?: string; label: string }
  | {
      kind: 'diffpair';
      baseLabel: string;
      headLabel: string;
      rows: { label: string; base: string; head: string; differs: boolean }[];
    }
  | { kind: 'verdict'; finding: Finding }
  | { kind: 'citation'; assignment: Assignment; stepIdx: number; note: string }
  | { kind: 'patch'; patch: Patch }
  | { kind: 'verification'; verification: Verification }
  | {
      kind: 'issue';
      issue: Issue;
      finding?: Finding;
      verification: Verification | null;
      /** Everything after the leading issue renders as a single line. */
      compact: boolean;
    };

export type FeedItem = {
  assignmentId: string;
  bot: BotId;
  sessionId: string | null;
  state: 'queued' | 'running' | 'passed' | 'failed' | 'errored' | 'skipped';
  label: string;
  caption: string;
  step?: Step;
  url?: string;
};

export type RoomEntry =
  | { kind: 'system'; id: string; text: string }
  /** Every browser in the run, in one row. The Cast made visible. */
  | { kind: 'browsers'; id: string; feeds: FeedItem[]; note: string }
  | {
      kind: 'message';
      id: string;
      bot: BotId;
      at: string;
      role: string;
      body: string;
      attachments: Attachment[];
    }
  | { kind: 'handoff'; id: string; from: BotId[]; to: BotId[]; lead: string; tail?: string }
  | { kind: 'typing'; id: string; bot: BotId; verb: string };

export type RunState = {
  run: Run | null;
  charter: TestCharter | null;
  assignments: Assignment[];
  findings: Finding[];
  issues: Issue[];
  diagnosis: Diagnosis | null;
  patch: Patch | null;
  verification: Verification | null;
  pullRequest: PullRequest | null;
};

// --- helpers ----------------------------------------------------------------

const clock = (iso: string | null, from: string | undefined) => {
  if (!iso || !from) return '';
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.parse(from)) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const stripDot = (s: string) => s.replace(/\.\s*$/, '');
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

export const botFor = (a: Assignment): BotId => BOT_BY_ARCHETYPE[a.archetype];

/**
 * An agent's trace is a sequence of decisions, and the last one alone is the
 * conclusion without the observation that earned it. The final two entries are
 * the observation and the verdict — the pair a colleague would actually type.
 */
const verdictOf = (trace: { content: string }[]) =>
  trace.slice(-2).map((t) => t.content).join(' ');

function reporter(f: Finding, assignments: Assignment[]): BotId {
  const a = assignments.find((x) => f.assignmentIds.includes(x.id));
  return a ? botFor(a) : 'qaizen';
}

/** The failing frame and the one before it. */
function evidencePair(a: Assignment): { before?: Step; after?: Step } {
  const shot = a.steps.filter((s) => s.digest || s.screenshotUrl);
  const after = [...shot].reverse().find((s) => !s.ok) ?? shot.at(-1);
  const before = shot.filter((s) => s.idx < (after?.idx ?? 0)).at(-1);
  return { before, after };
}

/** The one value this step's assertion is about, whatever the app calls it. */
const valueOf = (s?: Step) => s?.digest?.primary?.value;

/**
 * What the assertion said should have happened.
 *
 * The Critic's Finding carries this as `expected`, sourced from the charter.
 * The step-label parse is only a fallback for an assignment that failed
 * before any finding was written about it.
 */
const expectedOf = (s: Step | undefined, finding?: Finding) =>
  finding?.expected || s?.label.match(/expected\s+([^)]+?)\)?\s*$/i)?.[1]?.trim();

/** Pick a presence verb deterministically, so it never changes on re-render. */
function verbFor(bot: BotId, salt: string): string {
  const v = BOTS[bot].doing;
  let h = 0;
  for (const c of salt) h = (h * 31 + c.charCodeAt(0)) | 0;
  return v[Math.abs(h) % v.length]!;
}

// --- the projection ---------------------------------------------------------

export function deriveRoom(s: RunState): RoomEntry[] {
  const out: RoomEntry[] = [];
  const run = s.run;
  if (!run) return out;
  const t0 = run.startedAt;
  const host = (run.previewUrl ?? '').replace(/^https?:\/\//, '');

  out.push({
    kind: 'system',
    id: 'sys-open',
    text: `${cap(run.commit.author)} pushed ${run.commit.filesChanged} files — ${run.commit.message}`,
  });

  // --- Diffany reads the diff ---
  if (s.charter) {
    const c = s.charter;
    const diff = c.assertions.find((a) => a.type === 'differential');
    let body = `${cap(run.commit.author)} says this ${lowerFirst(stripDot(c.intent.summary))}. That's ${c.intent.claims.length} things the diff claims are true.`;
    if (diff) {
      body += ` I'm also sending someone down ${lowerFirst(stripDot(diff.journey ?? diff.route))}, against main at the same time — nothing in the diff mentions it, which is exactly why I want it watched.`;
    }
    out.push({
      kind: 'message',
      id: 'm-diffany',
      bot: 'diffany',
      at: clock(run.stages.find((x) => x.stage === 'scout')?.finishedAt ?? null, t0),
      role: BOTS.diffany.role,
      body,
      attachments: [
        {
          kind: 'assertions',
          rows: c.assertions.map((a) => ({
            id: a.id,
            statement: a.statement ?? a.journey ?? a.route,
            source: a.derivedFrom ?? a.rationale ?? 'unclaimed',
          })),
        },
      ],
    });
  }

  // --- the Cast, as one row of browsers ---
  if (s.assignments.length > 0) {
    const castBots = [...new Set(s.assignments.map(botFor))];
    const sessions = s.assignments.reduce((n, a) => n + (a.archetype === 'differential' ? 2 : 1), 0);

    out.push({
      kind: 'handoff',
      id: 'h-cast',
      from: ['diffany'],
      to: castBots,
      lead: `Diffany handed ${s.assignments.length} assignments to`,
      tail: `· ${sessions} sessions`,
    });

    const live = s.assignments.filter((a) => a.status === 'running').length;
    const queued = s.assignments.filter((a) => a.status === 'queued').length;
    const failed = s.assignments.filter((a) => a.status === 'failed').length;
    const errored = s.assignments.filter((a) => a.status === 'errored').length;

    const note = (() => {
      if (live || queued) {
        const parts = [];
        if (live) parts.push(`${live} running`);
        if (queued) parts.push(`${queued} waiting for a slot`);
        return `${parts.join(', ')} of ${s.assignments.length} · every action screenshotted, every session recorded`;
      }
      const tail = [
        failed ? `${failed} found something` : null,
        errored ? `${errored} died` : null,
      ].filter(Boolean);
      return `${s.assignments.length} sessions${tail.length ? ` · ${tail.join(', ')}` : ' · all clean'}`;
    })();

    out.push({
      kind: 'browsers',
      id: 'browsers',
      note,
      feeds: s.assignments.map((a) => {
        const { after } = evidencePair(a);
        const state: FeedItem['state'] =
          a.status === 'running'
            ? 'running'
            : a.status === 'failed'
              ? 'failed'
              : a.status === 'errored'
                ? 'errored'
                : a.status === 'passed'
                  ? 'passed'
                  : a.status === 'skipped'
                    ? 'skipped'
                    : 'queued';
        const caption = {
          running: a.steps.at(-1)?.label ?? 'opening the page',
          queued: 'waiting for a slot',
          // Captured but never graded — a coverage gap, not a browser that is
          // still waiting. Rendering it as queued hid the gap.
          skipped: 'ran, not graded',
          failed: 'found something',
          errored: 'session died',
          passed: 'clean',
        }[state];
        return {
          assignmentId: a.id,
          bot: botFor(a),
          sessionId: a.sessionId,
          state,
          label:
            state === 'running'
              ? `${a.assertionId} · step ${a.steps.length}`
              : state === 'queued'
                ? `${a.assertionId} · queued`
                : state === 'skipped'
                  ? `${a.assertionId} · skipped`
                : `${a.assertionId} · ${a.steps.length} steps`,
          caption,
          step: after,
          url: `${host}${a.route}`,
        } satisfies FeedItem;
      }),
    });
  }

  // Passing agents do not speak. They are visible in the browsers row, and a
  // room where everyone reports in is a room nobody reads.
  const speaking = s.assignments
    .filter((a) => a.status === 'failed' || a.status === 'errored')
    .sort((a, b) => Date.parse(a.finishedAt ?? '') - Date.parse(b.finishedAt ?? ''));

  for (const a of speaking) {
    const bot = botFor(a);
    const finding = s.findings.find((f) => f.assignmentIds.includes(a.id));
    const said = verdictOf(a.trace);
    const { before, after } = evidencePair(a);

    const attachments: Attachment[] = [];
    if (a.archetype === 'differential') {
      attachments.push({
        kind: 'diffpair',
        baseLabel: (run.baseBranch ?? 'base').toUpperCase(),
        headLabel: run.commit.branch.toUpperCase(),
        rows: (finding?.deltas ?? [])
          .filter((d) => d.classification === 'unclaimed' || d.classification === 'claimed')
          .slice(0, 3)
          .map((d) => ({
            label: d.field,
            base: d.base,
            head: d.preview,
            differs: d.classification === 'unclaimed',
          })),
      });
    } else if (valueOf(before) && valueOf(after)) {
      attachments.push({
        kind: 'values',
        label: after?.digest?.primary?.label ?? 'value',
        before: valueOf(before)!,
        after: valueOf(after)!,
        ...(expectedOf(after, finding) ? { expected: expectedOf(after, finding) } : {}),
      });
    }

    // A crashed agent still reports. Partial failure is normal with several
    // browsers in flight, and a silent gap reads as a bug in the room.
    const fallback =
      a.status === 'errored'
        ? `My session died at step ${a.steps.length} before I could finish ${a.assertionId}. The run carries on without me.`
        : (finding?.actual ?? '');

    out.push({
      kind: 'message',
      id: `m-${a.id}`,
      bot,
      at: clock(a.finishedAt, t0),
      role: a.archetype === 'differential' ? BOTS.doppler.role : `assertion ${a.assertionId}`,
      body: said || fallback,
      attachments: a.status === 'errored' ? [] : attachments,
    });
  }

  // --- Gavel decides, and files ---
  if (s.findings.length > 0) {
    const castBots = [...new Set(s.assignments.filter((a) => a.status === 'failed').map(botFor))];
    const shots = s.assignments.reduce((n, a) => n + a.steps.length, 0);
    out.push({
      kind: 'handoff',
      id: 'h-critic',
      from: castBots,
      to: ['gavel'],
      lead: `${list(castBots.map((b) => BOTS[b].name))} passed ${s.findings.length} findings and ${shots} screenshots to`,
    });

    const kept = s.findings.filter((f) => f.status === 'confirmed');
    const cut = s.findings.filter((f) => f.status !== 'confirmed');
    const parts: string[] = [];

    kept.forEach((f, i) => {
      const b = BOTS[reporter(f, s.assignments)].name;
      parts.push(
        i === 0
          ? `@${b} keeping yours — ${f.reproCount} of ${f.reproAttempts}, and main does the right thing, so it's new.`
          : `@${b} yours too, ${f.confidence.toFixed(2)}.`,
      );
    });
    for (const f of cut) {
      parts.push(
        f.status === 'pre_existing'
          ? `The ${lowerFirst(f.title)} does the same thing on main, so it isn't a regression and I'm killing it outright.`
          : `@${BOTS[reporter(f, s.assignments)].name} I'm not filing yours — ${f.reproCount} of ${f.reproAttempts} replays, ${f.confidence.toFixed(2)}.`,
      );
    }

    const attachments: Attachment[] = cut.map((f) => ({ kind: 'verdict', finding: f }) as const);

    // The artefact the product exists to produce, posted when it is real.
    // Ranked the way the Critic ranks: severity x confidence. Only the leading
    // issue gets the full card — a second one at full weight buries the first,
    // and the PRD's own reporting discipline is that a tool which opens a pile
    // of issues gets muted.
    const RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;
    const score = (i: Issue) => {
      const f = s.findings.find((x) => x.id === i.findingId);
      return f ? RANK[f.severity] * f.confidence : 0;
    };
    [...s.issues]
      .sort((a, b) => score(b) - score(a))
      .forEach((issue, i) => {
        const finding = s.findings.find((f) => f.id === issue.findingId);
        attachments.push({
          kind: 'issue',
          issue,
          ...(finding ? { finding } : {}),
          verification: s.verification,
          compact: i > 0,
        });
      });

    out.push({
      kind: 'message',
      id: 'm-gavel',
      bot: 'gavel',
      at: clock(run.stages.find((x) => x.stage === 'critic')?.finishedAt ?? null, t0),
      role: BOTS.gavel.role,
      body: parts.join(' '),
      attachments,
    });
  }

  // --- Clueso localises it ---
  if (s.diagnosis && s.diagnosis.hypotheses.length > 0) {
    const h = s.diagnosis.hypotheses[0]!;
    const net = h.evidence.find((e) => e.startsWith('network:'))?.replace(/^network:\s*/, '');
    const cited = s.assignments.find((a) => a.status === 'failed' && a.archetype === 'conformance');
    const failingStep = cited?.steps.find((st) => !st.ok)?.idx ?? cited?.steps.length ?? 0;

    let body = net
      ? `The network log settles it before I open a file. ${stripDot(net)}. Client state, not the API. ${h.explanation}`
      : h.explanation;
    if (cited) body += ` @${BOTS[botFor(cited)].name}'s step ${failingStep} is the whole argument.`;

    out.push({
      kind: 'message',
      id: 'm-clueso',
      bot: 'clueso',
      at: clock(run.stages.find((x) => x.stage === 'sleuth')?.finishedAt ?? null, t0),
      role: BOTS.clueso.role,
      body,
      attachments: cited
        ? [
            {
              kind: 'citation',
              assignment: cited,
              stepIdx: failingStep,
              note: `The same frame ${BOTS[botFor(cited)].name} captured, not a copy of it.`,
            },
          ]
        : [],
    });
  }

  // --- Patchouli patches ---
  if (s.patch) {
    const lines = s.patch.diff.split('\n');
    const plus = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const minus = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    const files = new Set(lines.filter((l) => l.startsWith('--- a/')).map((l) => l.slice(6))).size;

    out.push({
      kind: 'message',
      id: 'm-patchouli',
      bot: 'patchouli',
      at: clock(run.stages.find((x) => x.stage === 'understudy')?.finishedAt ?? null, t0),
      role: BOTS.patchouli.role,
      body: `@Clueso's first suspect was right. Smallest thing that satisfies the checklist: ${files} file, +${plus} −${minus}. No tests touched, nothing renamed, no new dependencies.`,
      attachments: [{ kind: 'patch', patch: s.patch }],
    });
  }

  // --- the Cast re-runs its own work against the fix ---
  //
  // Curtain Call is not a separate agent; the PRD's cast table gives its model
  // as "reuses the Cast". So the bot that ran an assignment is the one that
  // says whether the patch fixed it, which also makes the closing beat the
  // bot that found the bug confirming it is gone.
  if (s.verification) {
    const v = s.verification;
    const at = clock(run.stages.find((x) => x.stage === 'curtain_call')?.finishedAt ?? null, t0);

    const byBot = new Map<BotId, VerificationRow[]>();
    for (const r of v.rows) {
      const a = s.assignments.find((x) => x.id === r.assignmentId);
      const bot = a ? botFor(a) : 'qaizen';
      byBot.set(bot, [...(byBot.get(bot) ?? []), r]);
    }

    for (const [bot, rows] of byBot) {
      const flipped = rows.find((r) => r.before === 'failed' && r.after === 'passed');
      const ids = list(rows.map((r) => r.assignmentId));

      const body =
        bot === 'doppler'
          ? `Re-ran both sides against the patch preview, same Actions as before. ${flipped?.beforeValue ?? 'the delta'} is now ${flipped?.afterValue ?? 'gone'}.${v.regressionSuitePassed ? ' Nothing else differs from main either, so the fix did not trade one regression for another.' : ' Something else differs now — sending it back.'}`
          : `Replayed ${ids} against the patch preview. Same Action sequence, no new planning, so this is the same test that failed. ${flipped?.beforeValue ?? '—'} before, ${flipped?.afterValue ?? '—'} now.`;

      out.push({
        kind: 'message',
        id: `m-verify-${bot}`,
        bot,
        at,
        role: 're-run against the fix',
        body,
        attachments: [{ kind: 'verification', verification: { ...v, rows } }],
      });
    }
  }

  if (s.pullRequest) {
    const pr = s.pullRequest;
    out.push({
      kind: 'system',
      id: 'sys-pr',
      text: `Maestro opened #${pr.number} against ${pr.baseBranch}, closing #${pr.closesIssue}. ${cap(run.commit.author)} never opened a browser.`,
    });
  }

  const next = nextWaiting(s);
  if (next) out.push({ kind: 'typing', id: 'typing', bot: next, verb: verbFor(next, run.id) });

  return out;
}

function nextWaiting(s: RunState): BotId | null {
  if (!s.run || s.run.status === 'complete' || s.run.status === 'failed') return null;
  if (!s.charter) return 'diffany';
  if (s.assignments.some((a) => a.status === 'queued' || a.status === 'running')) return null;
  if (s.findings.length === 0) return 'gavel';
  if (!s.diagnosis) return 'clueso';
  if (!s.patch) return 'patchouli';
  if (!s.verification) return 'qaizen';
  return null;
}

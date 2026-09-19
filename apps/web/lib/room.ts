import type {
  Assignment,
  Diagnosis,
  Finding,
  Patch,
  PullRequest,
  Run,
  TestCharter,
  Verification,
} from '@aftershock/schema';
import { BOTS, BOT_BY_ARCHETYPE, type BotId } from '@/components/bots/registry';

/**
 * The room is a *projection* of the pipeline, not a data source the pipeline
 * has to feed.
 *
 * The backend emits exactly what the PRD specifies — a Test Charter,
 * assignments with reasoning traces, findings, a diagnosis, a patch, a
 * verification. Nothing in it knows this dashboard renders a conversation.
 * Everything below is derived here, client-side.
 *
 * Where a bot "speaks", the words come from `Assignment.trace`, which the PRD
 * already requires every agent to emit ("Every agent emits a reasoning trace.
 * Stored as structured steps, streamed to the frontend after each stage
 * completes"). Stages with no trace are composed from their structured output.
 * Add a stage to the pipeline and it gets a seat here; change how a stage
 * speaks and nothing else moves.
 */

export type Attachment =
  | { kind: 'assertions'; rows: { id: string; statement: string; source: string }[] }
  | { kind: 'recording'; assignment: Assignment; finding?: Finding }
  | {
      kind: 'diffpair';
      baseLabel: string;
      headLabel: string;
      rows: { label: string; base: string; head: string; differs: boolean }[];
    }
  | { kind: 'live'; assignment: Assignment }
  | { kind: 'verdict'; finding: Finding }
  | { kind: 'citation'; assignment: Assignment; stepIdx: number; note: string }
  | { kind: 'patch'; patch: Patch }
  | { kind: 'verification'; verification: Verification };

export type RoomEntry =
  | { kind: 'system'; id: string; text: string }
  | {
      kind: 'message';
      id: string;
      bot: BotId;
      at: string;
      role: string;
      body: string;
      attachments: Attachment[];
      /** Bubble max width, in px. Short asides read better narrow. */
      max: number;
      typing?: boolean;
    }
  | { kind: 'handoff'; id: string; from: BotId[]; to: BotId[]; lead: string; tail?: string }
  | { kind: 'waiting'; id: string; bot: BotId; text: string };

export type RunState = {
  run: Run | null;
  charter: TestCharter | null;
  assignments: Assignment[];
  findings: Finding[];
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

/**
 * What a bot says about an assignment.
 *
 * An agent's trace is a sequence of decisions, and the last one alone is the
 * conclusion without the observation that earned it. The final two entries are
 * the observation and the verdict, which is the pair a colleague would
 * actually type.
 */
const verdictOf = (trace: { content: string }[]) =>
  trace.slice(-2).map((t) => t.content).join(' ');

export const botFor = (a: Assignment): BotId => BOT_BY_ARCHETYPE[a.archetype];

/** The bot that reported a finding, via the assignment that raised it. */
function reporter(f: Finding, assignments: Assignment[]): BotId {
  const a = assignments.find((x) => f.assignmentIds.includes(x.id));
  return a ? botFor(a) : 'qaizen';
}

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

// --- the projection ---------------------------------------------------------

export function deriveRoom(s: RunState): RoomEntry[] {
  const out: RoomEntry[] = [];
  const run = s.run;
  if (!run) return out;
  const t0 = run.startedAt;

  out.push({
    kind: 'system',
    id: 'sys-open',
    text: `${cap(run.commit.author)} pushed ${run.commit.filesChanged} files. Maestro opened the run.`,
  });

  // --- Diffany reads the diff ---
  if (s.charter) {
    const c = s.charter;
    const diff = c.assertions.find((a) => a.type === 'differential');
    const scoutAt = run.stages.find((x) => x.stage === 'scout')?.finishedAt ?? null;

    let body = `${cap(run.commit.author)} says this ${lowerFirst(stripDot(c.intent.summary))}. That's ${c.intent.claims.length} things the diff claims are true.`;
    if (diff) {
      body += ` I'm also sending someone down ${lowerFirst(stripDot(diff.journey ?? diff.route))}, against main at the same time — nothing in the diff mentions it, which is exactly why I want it watched.`;
    }

    out.push({
      kind: 'message',
      id: 'm-diffany',
      bot: 'diffany',
      at: clock(scoutAt, t0),
      role: BOTS.diffany.role,
      body,
      max: 640,
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

  // --- the Cast is dispatched ---
  if (s.assignments.length > 0) {
    const castBots = [...new Set(s.assignments.map(botFor))];
    const sessions = s.assignments.reduce((n, a) => n + (a.archetype === 'differential' ? 2 : 1), 0);
    out.push({
      kind: 'handoff',
      id: 'h-cast',
      from: ['diffany'],
      to: castBots,
      lead: `Diffany handed ${s.assignments.length} assignments to`,
      tail: `· ${s.assignments.length} browsers, ${sessions} sessions`,
    });
  }

  // Passing agents do not take space in the thread — they are visible in the
  // Browsers view and in the handoff count. Only running and failed agents
  // speak, which is what keeps the room readable at eight bots.
  const speaking = s.assignments
    .filter((a) => a.status === 'failed' || a.status === 'running' || a.status === 'errored')
    .sort((a, b) => Date.parse(a.finishedAt ?? a.startedAt ?? '') - Date.parse(b.finishedAt ?? b.startedAt ?? ''));

  for (const a of speaking) {
    const bot = botFor(a);
    const finding = s.findings.find((f) => f.assignmentIds.includes(a.id));
    const said = verdictOf(a.trace);

    if (a.status === 'running') {
      out.push({
        kind: 'message',
        id: `m-${a.id}`,
        bot,
        at: 'live',
        role: a.archetype === 'differential' ? BOTS.doppler.role : `assertion ${a.assertionId}`,
        body: said,
        max: 560,
        attachments: [{ kind: 'live', assignment: a }],
        typing: true,
      });
      continue;
    }

    if (a.status === 'errored') {
      out.push({
        kind: 'message',
        id: `m-${a.id}`,
        bot,
        at: clock(a.finishedAt, t0),
        role: `assertion ${a.assertionId}`,
        body: said || 'Session died before I could finish. The run carries on without me.',
        max: 520,
        attachments: [],
      });
      continue;
    }

    const attachments: Attachment[] =
      a.archetype === 'differential'
        ? [
            {
              kind: 'diffpair',
              baseLabel: 'MAIN',
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
            },
          ]
        : [{ kind: 'recording', assignment: a, finding }];

    out.push({
      kind: 'message',
      id: `m-${a.id}`,
      bot,
      at: clock(a.finishedAt, t0),
      role: a.archetype === 'differential' ? BOTS.doppler.role : `assertion ${a.assertionId}`,
      body: said || finding?.actual || '',
      max: 680,
      attachments,
    });
  }

  // --- Gavel decides ---
  if (s.findings.length > 0) {
    const castBots = [...new Set(s.assignments.filter((a) => a.status === 'failed').map(botFor))];
    const shots = s.assignments.reduce((n, a) => n + a.steps.length, 0);
    const recordings = s.assignments.reduce(
      (n, a) => n + (a.sessionId ? 1 : 0) + (a.baseSessionId ? 1 : 0),
      0,
    );
    out.push({
      kind: 'handoff',
      id: 'h-critic',
      from: castBots,
      to: ['gavel'],
      lead: `${list(castBots.map((b) => BOTS[b].name))} passed ${s.findings.length} findings, ${shots} screenshots and ${recordings} recordings to`,
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
      if (f.status === 'pre_existing') {
        parts.push(
          `The ${lowerFirst(f.title)} does the same thing on main, so it isn't a regression and I'm killing it outright.`,
        );
      } else {
        parts.push(
          `@${BOTS[reporter(f, s.assignments)].name} I'm not filing yours — ${f.reproCount} of ${f.reproAttempts} replays, ${f.confidence.toFixed(2)}.`,
        );
      }
    }

    out.push({
      kind: 'message',
      id: 'm-gavel',
      bot: 'gavel',
      at: clock(run.stages.find((x) => x.stage === 'critic')?.finishedAt ?? null, t0),
      role: BOTS.gavel.role,
      body: parts.join(' '),
      max: 660,
      attachments: cut.map((f) => ({ kind: 'verdict', finding: f }) as const),
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
      max: 660,
      attachments: cited
        ? [
            {
              kind: 'citation',
              assignment: cited,
              stepIdx: failingStep,
              note: `The same frame ${BOTS[botFor(cited)].name} posted, not a copy of it. Every screenshot in this run has one home.`,
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
      body: `@Clueso's first suspect was right. Smallest thing that satisfies the checklist: ${files} file, +${plus} −${minus}. No tests touched, nothing renamed, no new dependencies. Branch is \`${s.patch.branch}\`.`,
      max: 660,
      attachments: [{ kind: 'patch', patch: s.patch }],
    });
  }

  // --- Encore verifies ---
  if (s.verification) {
    const v = s.verification;
    const flipped = v.rows.filter((r) => r.before === 'failed' && r.after === 'passed');
    const head = flipped[0];
    const body = head
      ? `Replayed the exact Actions, no new planning, so this is the same test that failed. ${head.label.split('·').at(-1)?.trim()} read ${head.beforeValue} and now reads ${head.afterValue}.${v.regressionSuitePassed ? ' The differential suite against main is still clean, so the patch did not trade one regression for another.' : ' The differential suite is not clean — sending it back.'}`
      : 'Replayed the failing assignments against the patch.';

    out.push({
      kind: 'message',
      id: 'm-encore',
      bot: 'encore',
      at: clock(run.stages.find((x) => x.stage === 'curtain_call')?.finishedAt ?? null, t0),
      role: BOTS.encore.role,
      body,
      max: 680,
      attachments: [{ kind: 'verification', verification: v }],
    });
  }

  // --- Maestro closes ---
  if (s.pullRequest) {
    const pr = s.pullRequest;
    out.push({
      kind: 'message',
      id: 'm-maestro-pr',
      bot: 'maestro',
      at: clock(run.finishedAt, t0),
      role: BOTS.maestro.role,
      body: `PR #${pr.number} is open against \`${pr.baseBranch}\`, closing #${pr.closesIssue}, labelled ${pr.labels.join(', ')}. Both recordings are attached — the broken one and the fixed one. Maya never opened a browser.`,
      max: 620,
      attachments: [],
    });
  }

  // --- who the room is waiting on ---
  const next = nextWaiting(s);
  if (next) out.push({ kind: 'waiting', id: 'w', bot: next.bot, text: next.text });

  return out;
}

function nextWaiting(s: RunState): { bot: BotId; text: string } | null {
  if (!s.run || s.run.status === 'complete' || s.run.status === 'failed') return null;
  if (!s.charter) return { bot: 'diffany', text: 'Diffany is reading the diff' };
  if (s.assignments.some((a) => a.status === 'queued' || a.status === 'running')) return null;
  if (s.findings.length === 0) return { bot: 'gavel', text: 'Gavel is weighing the findings' };
  if (!s.diagnosis) return { bot: 'clueso', text: 'Clueso is reading the log' };
  if (!s.patch) return { bot: 'patchouli', text: 'Patchouli is waiting for the hypothesis' };
  if (!s.verification) return { bot: 'encore', text: 'Encore is waiting for a preview of the patch' };
  return null;
}

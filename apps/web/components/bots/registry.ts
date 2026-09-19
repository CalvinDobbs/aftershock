import type { Stage } from '@aftershock/schema';

/**
 * The room.
 *
 * The Claude Design source draws eleven bots. Four do not get a seat:
 *
 *   Havoc   — adversary agents   cut #1 in the PRD's own cut order, P2
 *   Wanda   — explorer agents    cut #3, P1
 *   Nitpick — a second edge-case Cast member, redundant once Havoc is gone
 *   Maestro — the Director, which is deterministic code rather than an agent.
 *             It speaks as the room's system lines instead of occupying a row,
 *             because a roster is a list of things that can be waited on and
 *             the Director is never what you are waiting for.
 *   Encore  — Curtain Call, whose model in the PRD's own cast table is
 *             "Reuses the Cast". It was never a separate agent: verification
 *             is the same Actions replayed by the same bots against the fix
 *             preview. So QAizen and Doppler report their own re-runs, and the
 *             loop closes on the bot that found the bug saying it is fixed.
 *
 * Six remain and every one is load-bearing: remove any and a stage of the
 * pipeline has nobody in it. QAizen and Doppler stay separate because they are
 * the two oracles — collapsing them costs the side-by-side preview/base shot,
 * which is the one frame that explains the differential oracle unaided.
 * Clueso stays separate from Patchouli for the reason the PRD gives: diagnosis
 * and repair are different skills, and merging them yields patches that fix
 * the symptom.
 */

export type BotId =
  | 'maestro'
  | 'diffany'
  | 'qaizen'
  | 'doppler'
  | 'gavel'
  | 'clueso'
  | 'patchouli';

export type Bot = {
  id: BotId;
  name: string;
  /** Sidebar one-liner — what this bot is for. */
  blurb: string;
  /** Byline next to the name on a message. */
  role: string;
  /** Which pipeline stage this bot owns. */
  stage: Stage;
  fill: string;
  /** Face colour: a dark tint of `fill`. */
  ink: string;
  /** @mention colour in message text. */
  say: string;
  /** Face cross-fade period. Every bot differs so the room never blinks together. */
  dur: string;
  /**
   * What this bot is doing while you wait on it, in its own voice. The room
   * shows one of these under the name in the rail and as a typing line in the
   * thread, so a stage that takes twenty seconds still reads as someone
   * working rather than a spinner.
   */
  doing: string[];
};

export const BOTS: Record<BotId, Bot> = {
  maestro: {
    id: 'maestro',
    name: 'Maestro',
    blurb: 'runs the room, writes to GitHub',
    role: 'runs the room',
    stage: 'trigger',
    fill: '#8a8a8a',
    ink: '#2a2a2a',
    say: '#b4b4b4',
    dur: '9.4s',
    doing: ['is opening the run', 'is writing it up'],
  },
  diffany: {
    id: 'diffany',
    name: 'Diffany',
    blurb: 'turns the diff into claims',
    role: 'reads diffs',
    stage: 'scout',
    fill: '#d6a13c',
    ink: '#3d2c0c',
    say: '#e3c07f',
    dur: '7.2s',
    doing: ['is reading the diff', 'is cooking up assertions'],
  },
  qaizen: {
    id: 'qaizen',
    name: 'QAizen',
    blurb: 'checks a claim start to finish',
    role: 'checks a claim',
    stage: 'cast',
    fill: '#4fae7a',
    ink: '#0f2e1e',
    say: '#7fd3a3',
    dur: '6.1s',
    doing: ['is clicking through it', 'is running it back'],
  },
  doppler: {
    id: 'doppler',
    name: 'Doppler',
    blurb: 'runs your branch against main',
    role: 'two sessions, one script',
    stage: 'cast',
    fill: '#5b8fd6',
    ink: '#12243a',
    say: '#8fb4e8',
    dur: '7.7s',
    doing: ['is running both sides', 'is diffing the snapshots'],
  },
  gavel: {
    id: 'gavel',
    name: 'Gavel',
    blurb: 'the only one allowed to file',
    role: 'decides what counts',
    stage: 'critic',
    fill: '#d6604f',
    ink: '#3d1410',
    say: '#eda08f',
    dur: '8.8s',
    doing: ['is weighing it', 'is cooking'],
  },
  clueso: {
    id: 'clueso',
    name: 'Clueso',
    blurb: 'reads the log, then the code',
    role: 'finds the line',
    stage: 'sleuth',
    fill: '#4f9fd6',
    ink: '#0e2439',
    say: '#8fc4ea',
    dur: '7s',
    doing: ['is reading the log', 'is in the codebase'],
  },
  patchouli: {
    id: 'patchouli',
    name: 'Patchouli',
    blurb: 'writes the smallest patch',
    role: 'writes the patch',
    stage: 'understudy',
    fill: '#68b55f',
    ink: '#0f2c0c',
    say: '#9ad693',
    dur: '7.9s',
    doing: ['is writing the patch', 'is keeping it small'],
  },
};

/**
 * Rail order — the order they speak in a run. Maestro is absent by design: it
 * is the system voice, not a participant.
 */
export const ROSTER: BotId[] = [
  'diffany',
  'qaizen',
  'doppler',
  'gavel',
  'clueso',
  'patchouli',
];

export const BOT_BY_STAGE: Record<Stage, BotId> = {
  trigger: 'maestro',
  scout: 'diffany',
  cast: 'qaizen',
  critic: 'gavel',
  sleuth: 'clueso',
  understudy: 'patchouli',
  // Curtain Call is a re-run mode on the Cast, not its own agent.
  curtain_call: 'qaizen',
};

/** Which bot runs a given Cast assignment. */
export const BOT_BY_ARCHETYPE = {
  conformance: 'qaizen',
  differential: 'doppler',
} as const satisfies Record<string, BotId>;

/**
 * @mention colouring covers every bot, not just the rail. Maestro has no rail
 * row but can still be named in a message, and a mention that renders as plain
 * text reads as a typo.
 */
export const NAME_TO_BOT: Record<string, BotId> = Object.fromEntries(
  (Object.keys(BOTS) as BotId[]).map((id) => [BOTS[id].name.toLowerCase(), id]),
);

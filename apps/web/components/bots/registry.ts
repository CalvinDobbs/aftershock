import type { Stage } from '@aftershock/schema';

/**
 * The room.
 *
 * The Claude Design source draws eleven bots. Three are cut here, in the order
 * the PRD's own cut list says to cut them (Scope > The cut order):
 *
 *   Havoc   — adversary agents        cut #1, P2
 *   Wanda   — explorer agents         cut #3, P1
 *   Nitpick — extra edge-case Cast member, redundant once Havoc is gone
 *
 * What is left is exactly the PRD's seven roles, with the Cast split into its
 * two P0 archetypes. Every bot below is load-bearing: remove any one and a
 * stage of the pipeline has nobody in it.
 */

export type BotId =
  | 'maestro'
  | 'diffany'
  | 'qaizen'
  | 'doppler'
  | 'gavel'
  | 'clueso'
  | 'patchouli'
  | 'encore';

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
  },
  encore: {
    id: 'encore',
    name: 'Encore',
    blurb: 're-runs the same browsers',
    role: 're-runs the browsers',
    stage: 'curtain_call',
    fill: '#b58a5f',
    ink: '#33220f',
    say: '#d4b795',
    dur: '8.5s',
  },
};

/** Sidebar order — the order they speak in a run. */
export const ROSTER: BotId[] = [
  'maestro',
  'diffany',
  'qaizen',
  'doppler',
  'gavel',
  'clueso',
  'patchouli',
  'encore',
];

export const BOT_BY_STAGE: Record<Stage, BotId> = {
  trigger: 'maestro',
  scout: 'diffany',
  cast: 'qaizen',
  critic: 'gavel',
  sleuth: 'clueso',
  understudy: 'patchouli',
  curtain_call: 'encore',
};

/** Which bot runs a given Cast assignment. */
export const BOT_BY_ARCHETYPE = {
  conformance: 'qaizen',
  differential: 'doppler',
} as const satisfies Record<string, BotId>;

export const NAME_TO_BOT: Record<string, BotId> = Object.fromEntries(
  ROSTER.map((id) => [BOTS[id].name.toLowerCase(), id]),
);

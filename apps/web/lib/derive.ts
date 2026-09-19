import type { Finding, RunSummary, Stage } from '@aftershock/schema';
import { BOT_BY_STAGE, type BotId } from '@/components/bots/registry';

/**
 * Numbers the sidebar shows, all computed from run data rather than stored.
 * If the backend later persists them, these become a fallback.
 */

/** Browser-seconds ≈ wall time × sessions held. Matches the PRD's 0.25h/run estimate. */
export function browserHours(runs: RunSummary[]): number {
  return runs.reduce((h, r) => h + ((r.durationMs ?? 0) * r.agentCount) / 3_600_000, 0);
}

/** Which bot last acted on a run — drives the sidebar row avatar. */
export function lastBot(r: RunSummary): BotId | 'run' {
  if (r.status === 'running' || r.status === 'pending') return 'run';
  if (r.status === 'failed') return 'maestro';
  if (r.status === 'no_findings') return 'doppler';
  // The Cast only owns the row once it has actually re-run the fix.
  if (r.verified) return 'qaizen';
  return r.prNumber ? 'patchouli' : 'gavel';
}

/**
 * One-line preview under a run in the sidebar.
 *
 * `verified` comes from Curtain Call actually re-running the failing work
 * against the patch. It is never inferred from a pull request existing:
 * Understudy opens a draft labelled `aftershock:unverified` after two failed
 * attempts, and calling that verified is the product lying about the one
 * thing it exists to prove.
 */
export function preview(r: RunSummary): string {
  if (r.status === 'pending') return 'waiting for the preview deployment';
  if (r.status === 'running') return 'Diffany is reading the diff…';
  if (r.status === 'failed') return 'run failed — partial results kept';
  if (r.status === 'no_findings') return `nothing to report. ${r.findingsRaised} raised, all discarded`;
  if (r.prNumber && r.verified) return `#${r.prNumber} opened, the re-run came back green`;
  if (r.prNumber) return `#${r.prNumber} opened as a draft — the fix is not proven`;
  // "confirmed", not "filed": the summary knows what cleared the gates, not
  // what reached GitHub. Filing is a write, and this line must not claim one.
  return `${r.findingsConfirmed} confirmed of ${r.findingsRaised} raised`;
}

export const stageBot = (s: Stage): BotId => BOT_BY_STAGE[s];

/**
 * "What the room remembers" — facts this run established about the project.
 *
 * Derived from the run's own output today. The natural home for these is a
 * persisted per-project store (the noise-filter rules the comparator learns),
 * which is a backend concern; until it exists these are computed live so the
 * panel never shows anything the pipeline did not actually produce.
 */
export function roomMemory(findings: Finding[], threshold = 0.7): string[] {
  const notes: string[] = [];

  const noise = findings.flatMap((f) => f.deltas ?? []).filter((d) => d.classification === 'noise');
  if (noise.length > 0) {
    notes.push(
      `${noise.length} deltas normalised away as noise this run — ${noise
        .map((d) => d.field)
        .join(', ')}. Without that filter the comparator reports thirty per run and nobody reads it.`,
    );
  }

  const discarded = findings.filter((f) => f.status === 'flaky' || f.status === 'low_confidence');
  if (discarded.length > 0) {
    notes.push(
      `${discarded.length} finding${discarded.length === 1 ? '' : 's'} stayed below ${threshold.toFixed(2)} and never reached GitHub. Gavel shows the arithmetic rather than hiding it.`,
    );
  }

  const preExisting = findings.filter((f) => f.status === 'pre_existing');
  if (preExisting.length > 0) {
    notes.push(
      `${preExisting.length} failure was already on main, so it is not a regression and was killed outright. Aftershock never reports a bug it did not cause.`,
    );
  }

  return notes;
}

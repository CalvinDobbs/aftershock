export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r.toString().padStart(2, '0')}s`;
}

export function ago(iso: string, now = Date.now()): string {
  const d = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(d / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const STAGE_LABEL: Record<string, string> = {
  trigger: 'Trigger',
  scout: 'Scout',
  cast: 'The Cast',
  critic: 'Critic',
  sleuth: 'Sleuth',
  understudy: 'Understudy',
  curtain_call: 'Curtain Call',
};

export const STAGE_BLURB: Record<string, string> = {
  trigger: 'Webhook received, preview deployment resolved',
  scout: 'Diff to Test Charter',
  cast: 'Parallel browser agents on Browserbase',
  critic: 'Triage, reproduction, confidence',
  sleuth: 'Root cause localisation',
  understudy: 'Patch generation via Codex',
  curtain_call: 'Re-run the Cast against the fix',
};

export const SEVERITY_TONE = {
  critical: 'fail',
  high: 'fail',
  medium: 'warn',
  low: 'neutral',
} as const;

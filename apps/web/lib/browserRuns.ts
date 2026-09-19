import type { AgentTraceEvent, RunSummary } from '@aftershock/schema/browser';

/**
 * Data access for real browser runs, served by the `orchestrator` service.
 *
 * This is the second of the dashboard's two sources and deliberately separate
 * from `lib/api.ts`: that one reads the product pipeline (charter, findings,
 * repair), this one reads what the Browserbase agents actually did — sequenced
 * `AgentEvent`s, content-addressed screenshots, session replays.
 *
 * The orchestrator runs on its own origin, so every URL here is absolute. It
 * was the Vite control room's dev-server proxy that hid that; Next has no
 * proxy, so the origin is configuration instead.
 */

export const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://127.0.0.1:3001';

export interface DemoRun {
  runId: string;
  assignmentId: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

export async function listBrowserRuns(): Promise<RunSummary[]> {
  const body = await parseResponse<{ runs: RunSummary[] }>(
    await fetch(`${ORCHESTRATOR_URL}/api/runs`),
  );
  return body.runs;
}

export async function getBrowserRunTraces(runId: string): Promise<AgentTraceEvent[]> {
  const body = await parseResponse<{ traces: AgentTraceEvent[] }>(
    await fetch(`${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/events`),
  );
  return body.traces;
}

/** Guarded launcher: the orchestrator answers 404 unless it was started with one. */
export async function launchDemoRun(): Promise<DemoRun> {
  const body = await parseResponse<{ run: DemoRun }>(
    await fetch(`${ORCHESTRATOR_URL}/api/demo/runs`, { method: 'POST' }),
  );
  return body.run;
}

export function browserRunStreamUrl(runId: string): string {
  return `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/events/stream`;
}

export function screenshotUrl(id: string): string {
  return `${ORCHESTRATOR_URL}/api/evidence/screenshots/${encodeURIComponent(id)}`;
}

export function browserbaseSessionUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${encodeURIComponent(sessionId)}`;
}

import type { RunDetail, RunSummary } from '@aftershock/schema';
import * as golden from '@/fixtures/golden-run';

/**
 * Single data access point for the dashboard.
 *
 * When AFTERSHOCK_API_URL is set, every read goes to the `api` service. When it
 * is not, the dashboard serves the cached golden run from fixtures — which is
 * both the pre-backend development mode and the demo-safety fallback the PRD
 * asks for. Nothing else in the frontend knows which of the two is live.
 */

export const API_URL = process.env.AFTERSHOCK_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';
export const LIVE = API_URL.length > 0;

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<RunSummary[]> {
  if (LIVE) {
    const live = await get<RunSummary[]>('/runs');
    if (live) return live;
  }
  return golden.runList;
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  if (LIVE) {
    const live = await get<RunDetail>(`/runs/${runId}`);
    if (live) return live;
  }
  // Every fixture row deep-links to the golden run so the dashboard is
  // navigable before the backend exists.
  if (golden.runList.some((r) => r.id === runId)) {
    return { ...golden.detail, run: { ...golden.detail.run, id: runId } };
  }
  return null;
}

/** Manual trigger. Converges on the same createRun() the webhook calls. */
export async function createRun(input: { repo: string; sha: string }): Promise<{ runId: string }> {
  if (LIVE) {
    const res = await fetch(`${API_URL}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) return (await res.json()) as { runId: string };
    throw new Error(`api: createRun failed (${res.status})`);
  }
  // Without a backend, "Run on commit" replays the golden run.
  return { runId: golden.RUN_ID };
}

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
  // One cached run, not a fabricated history. The other rows the fixture
  // carries were placeholders that all deep-linked to this same run.
  return golden.runList.filter((r) => r.id === golden.RUN_ID);
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  if (LIVE) {
    const live = await get<RunDetail>(`/runs/${runId}`);
    if (live) return live;
  }
  // Without a backend the dashboard serves exactly one run: the golden run
  // the PRD names as the DEMO_MODE fallback, so a dead network on stage costs
  // nothing. Live runs come from services/api; this is not a stand-in for it.
  if (runId === golden.RUN_ID) return golden.detail;
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

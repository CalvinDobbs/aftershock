import type { AgentTraceEvent, RunSummary } from "@aftershock/schema";

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

export async function listRuns(): Promise<RunSummary[]> {
  const body = await parseResponse<{ runs: RunSummary[] }>(await fetch("/api/runs"));
  return body.runs;
}

export async function getRunTraces(runId: string): Promise<AgentTraceEvent[]> {
  const body = await parseResponse<{ traces: AgentTraceEvent[] }>(
    await fetch(`/api/runs/${encodeURIComponent(runId)}/events`),
  );
  return body.traces;
}

export async function launchDemoRun(): Promise<DemoRun> {
  const body = await parseResponse<{ run: DemoRun }>(
    await fetch("/api/demo/runs", { method: "POST" }),
  );
  return body.run;
}

export function screenshotUrl(id: string): string {
  return `/api/evidence/screenshots/${encodeURIComponent(id)}`;
}

export function browserbaseSessionUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${encodeURIComponent(sessionId)}`;
}

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { RunDetail, RunEvent, type RunSummary } from "@aftershock/schema";

/** Durable product events owned by the Director; browser traces retain their existing repository. */
export class PipelineJournal {
  private records = new Map<string, RunEvent[]>();
  private listeners = new Map<string, Set<(event: RunEvent, index: number) => void>>();
  private ready: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  constructor(private directory: string) {
    this.ready = this.load();
  }
  private async load() {
    await mkdir(this.directory, { recursive: true });
    for (const path of await readdir(this.directory)) {
      if (!path.endsWith(".jsonl")) continue;
      const lines = (await readFile(join(this.directory, path), "utf8")).split("\n").filter(Boolean);
      const events = lines.map(line => RunEvent.parse(JSON.parse(line)));
      const first = events.find(e => e.type === "run.snapshot");
      if (first?.type === "run.snapshot") this.records.set(first.run.id, events);
    }
  }
  async publish(runId: string, value: RunEvent): Promise<void> {
    const event = RunEvent.parse(structuredClone(value));
    const job = this.tail.then(async () => {
      await this.ready;
      const path = join(this.directory, `${createHash("sha256").update(runId).digest("hex")}.jsonl`);
      await appendFile(path, JSON.stringify(event) + "\n");
      const events = this.records.get(runId) ?? [];
      events.push(event); this.records.set(runId, events);
      for (const listener of this.listeners.get(runId) ?? []) listener(structuredClone(event), events.length-1);
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
  subscribe(runId: string, listener: (event: RunEvent, index: number) => void) {
    const listeners = this.listeners.get(runId) ?? new Set();
    listeners.add(listener); this.listeners.set(runId, listeners);
    return () => { listeners.delete(listener); };
  }
  async history(runId: string) { await this.ready; return structuredClone(this.records.get(runId) ?? []); }
  async detail(runId: string): Promise<RunDetail | null> {
    const events = await this.history(runId);
    let detail: RunDetail | null = null;
    for (const event of events) {
      if (event.type === "run.snapshot") {
        detail ??= { run: event.run, charter: null, assignments: [], findings: [], issues: [], diagnosis: null, patch: null, verification: null, pullRequest: null };
        detail.run = event.run;
      }
      if (!detail) continue;
      switch (event.type) {
        case "scout.complete": detail.charter = event.charter; detail.run.riskScore = event.charter.riskScore; break;
        case "cast.dispatch": detail.assignments = event.assignments; break;
        case "agent.update": { const i = detail.assignments.findIndex(a => a.id === event.assignment.id); if (i >= 0) detail.assignments[i] = event.assignment; else detail.assignments.push(event.assignment); break; }
        case "critic.complete": detail.findings = event.findings; break;
        case "issue.filed": detail.issues.push(event.issue); { const f = detail.findings.find(f => f.id === event.issue.findingId); if (f) f.filed = true; } break;
        case "sleuth.complete": detail.diagnosis = event.diagnosis; break;
        case "understudy.complete": detail.patch = event.patch; break;
        case "curtaincall.complete": detail.verification = event.verification; break;
        case "pr.opened": detail.pullRequest = event.pullRequest; break;
        case "run.complete": detail.run = event.run; break;
        case "run.failed": detail.run.status = "failed"; break;
      }
      const stageName = event.type === "stage.start" || event.type === "stage.skip" ? event.stage :
        ({ "scout.complete": "scout", "cast.complete": "cast", "critic.complete": "critic", "sleuth.complete": "sleuth", "understudy.complete": "understudy", "curtaincall.complete": "curtain_call" } as Record<string,string>)[event.type];
      const stage = detail.run.stages.find(s => s.stage === stageName);
      if (stage) { stage.status = event.type === "stage.start" ? "running" : event.type === "stage.skip" ? "skipped" : "complete"; if (event.type === "stage.skip") stage.note = event.note; }
    }
    return detail ? RunDetail.parse(detail) : null;
  }
  async summaries(): Promise<RunSummary[]> {
    await this.ready;
    const details = await Promise.all([...this.records.keys()].map(id => this.detail(id)));
    return details.filter((d): d is RunDetail => d !== null).map(d => ({
      id: d.run.id, repo: d.run.repo, sha: d.run.commit.sha, message: d.run.commit.message, branch: d.run.commit.branch,
      author: d.run.commit.author, status: d.run.status, agentCount: d.assignments.length,
      findingsConfirmed: d.findings.filter(f => f.status === "confirmed").length, findingsRaised: d.findings.length,
      durationMs: d.run.finishedAt ? Date.parse(d.run.finishedAt)-Date.parse(d.run.startedAt) : null,
      startedAt: d.run.startedAt, prNumber: d.pullRequest?.number ?? null, verified: d.verification?.passed === true,
    })).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  }
}

import { randomUUID } from "node:crypto";

import type { RunSummary } from "@aftershock/schema";

import type { CreateRunInput } from "./webhook.js";

/**
 * The run registry, and the one `createRun` every trigger converges on.
 *
 * The webhook, the dashboard's manual control and a curl all end up here.
 * That is the point: two entry points means two pipelines, and the one that
 * gets demoed is never the one that got tested.
 *
 * Storage is in-memory for now. Runs already persist as JSONL in the
 * orchestrator; this holds the pipeline-level record that the dashboard's
 * runs list reads, and it is the piece Postgres replaces.
 */

export type RunStatus = "pending" | "running" | "complete" | "failed" | "no_findings";

export interface RunRecord {
  runId: string;
  repo: string;
  sha: string;
  ref: string;
  baseRef: string;
  prNumber?: number;
  previewUrl: string | null;
  baseUrl: string | null;
  /**
   * The Director generates its own id for the work it does. Without keeping
   * it, this service cannot proxy the event stream for a run it started —
   * the two halves of one run are unaddressable from each other.
   */
  orchestratorRunId: string | null;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunStore {
  create(input: CreateRunInput & { baseUrl?: string | null }): Promise<RunRecord>;
  find(query: { repo: string; sha: string }): Promise<RunRecord | null>;
  get(runId: string): Promise<RunRecord | null>;
  list(): Promise<RunRecord[]>;
  update(runId: string, patch: Partial<RunRecord>): Promise<RunRecord | null>;
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();

  async create(input: CreateRunInput & { baseUrl?: string | null }): Promise<RunRecord> {
    // Idempotent per commit. GitHub redelivers webhooks, and a push closely
    // followed by a pull_request describes one change, not two — creating a
    // second run would double the browser spend and split the evidence.
    const existing = await this.find({ repo: input.repo, sha: input.sha });
    if (existing) {
      // A later event may know more than the one that created it.
      if (input.prNumber !== undefined && existing.prNumber === undefined) {
        existing.prNumber = input.prNumber;
      }
      if (input.previewUrl && !existing.previewUrl) existing.previewUrl = input.previewUrl;
      return existing;
    }

    const record: RunRecord = {
      runId: `run_${randomUUID().slice(0, 8)}`,
      repo: input.repo,
      sha: input.sha,
      ref: input.ref,
      baseRef: input.baseRef,
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
      previewUrl: input.previewUrl ?? null,
      baseUrl: input.baseUrl ?? null,
      orchestratorRunId: null,
      // Pending, not running: there is no deployment yet, and the dashboard
      // showing the run before any work starts is the demo's first beat.
      status: "pending",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    this.runs.set(record.runId, record);
    return record;
  }

  async find(query: { repo: string; sha: string }): Promise<RunRecord | null> {
    for (const run of this.runs.values()) {
      if (run.repo === query.repo && run.sha === query.sha) return run;
    }
    return null;
  }

  async get(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async list(): Promise<RunRecord[]> {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async update(runId: string, patch: Partial<RunRecord>): Promise<RunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    Object.assign(run, patch);
    return run;
  }
}

/** The shape the dashboard's runs list reads. */
export function toSummary(run: RunRecord): RunSummary {
  const duration =
    run.startedAt && run.finishedAt
      ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
      : null;

  return {
    id: run.runId,
    repo: run.repo,
    sha: run.sha,
    message: "",
    branch: run.ref.replace(/^refs\/heads\//, ""),
    author: "",
    status: run.status,
    agentCount: 0,
    findingsConfirmed: 0,
    findingsRaised: 0,
    durationMs: duration,
    startedAt: run.startedAt ?? run.createdAt,
    prNumber: run.prNumber ?? null,
  };
}

import { Assignment as ProductAssignment, Run, Stage, type Commit } from "@aftershock/schema";
import type { AgentTraceEvent, Assignment, AssignmentResult, DifferentialResult } from "@aftershock/schema/browser";

export function initialRun(input: {
  runId: string; repo: string; head: string; base: string;
  previewUrl: string; baseUrl: string | null; prNumber?: number;
  commitMetadata?: Pick<Commit, "author" | "branch">;
}, now = new Date().toISOString()): Run {
  return Run.parse({
    id: input.runId, repo: input.repo,
    commit: { sha: input.head, message: "Reading commit", author: input.commitMetadata?.author ?? "unknown",
      branch: input.commitMetadata?.branch ?? input.head, filesChanged: 0, additions: 0, deletions: 0,
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}) },
    previewUrl: input.previewUrl, baseUrl: input.baseUrl, baseBranch: input.baseUrl ? input.base : null,
    status: "running", riskScore: 0, startedAt: now, finishedAt: null,
    stages: Stage.options.map((stage) => ({ stage, status: stage === "trigger" ? "complete" : "pending",
      startedAt: stage === "trigger" ? now : null, finishedAt: stage === "trigger" ? now : null })),
  });
}

export function queuedAssignment(assignment: Assignment): ProductAssignment {
  return ProductAssignment.parse({
    id: assignment.id, runId: assignment.runId, archetype: assignment.archetype,
    assertionId: assignment.assertionId ?? assignment.id, route: assignment.route, brief: assignment.objective,
    status: "queued", sessionId: null, baseSessionId: null, startedAt: null, finishedAt: null,
    durationMs: null, steps: [], network: [], console: [], trace: [],
  });
}

/** Browser telemetry becomes the existing room contract; no fabricated digests or verdicts. */
export function completedAssignment(
  assignment: Assignment,
  history: AgentTraceEvent[],
  result?: AssignmentResult | DifferentialResult,
  failure?: string,
  screenshotUrl: (id: string) => string = (id) => `/api/evidence/screenshots/${id}`,
): ProductAssignment {
  const product = queuedAssignment(assignment);
  const events = history.filter(({ event }) => event.assignmentId === assignment.id).map(({ event }) => event);
  const steps = new Map<number, ProductAssignment["steps"][number]>();
  // Old sequential traces lack side on step events. New traces are explicit.
  let legacySide: "preview" | "base" | "fix" = "preview";
  for (const event of events) {
    if (event.type === "session.opened") {
      legacySide = event.side;
      if (event.side === "base") product.baseSessionId = event.sessionId;
      else product.sessionId = event.sessionId;
    }
    if (event.type === "step.executed" || event.type === "step.captured") {
      const side = event.side ?? legacySide;
      const step = steps.get(event.index) ?? {
        idx: event.index,
        action: { method: "unknown", description: assignment.journey[event.index]?.instruction ?? "Captured step" },
        label: assignment.journey[event.index]?.instruction ?? "Captured step",
        screenshotUrl: null, baseScreenshotUrl: null, ms: 0, ok: true,
      };
      if (event.type === "step.executed" && side !== "base") {
        step.action = { ...event.action, method: event.action.method ?? "unknown" };
        step.ms = event.durationMs;
      }
      if (event.type === "step.captured") {
        if (event.screenshotId) {
          if (side === "base") step.baseScreenshotUrl = screenshotUrl(event.screenshotId);
          else step.screenshotUrl = screenshotUrl(event.screenshotId);
        }
        if (side !== "base") {
          product.network.push(...event.network.requests.map((r) => ({ method: r.method, url: r.url,
            status: r.status ?? 0, ms: r.durationMs ?? 0,
            ...(r.errorText ? { note: r.errorText } : r.status === undefined ? { note: "HTTP status not captured" } : {}) })));
          product.console.push(...event.consoleErrors.map((entry) => ({ level: "error" as const, text: entry.text })));
        }
      }
      steps.set(event.index, step);
    }
    if (event.type === "session.failed") failure ??= event.message;
  }
  const findings = result?.findings ?? [];
  for (const finding of findings) {
    const step = steps.get(finding.stepIndex);
    if (step) step.ok = false;
    product.trace.push({ seq: product.trace.length, at: result!.finishedAt, content: finding.summary });
  }
  product.steps = [...steps.values()].sort((a, b) => a.idx - b.idx);
  product.startedAt = result?.startedAt ?? events[0]?.timestamp ?? null;
  product.finishedAt = result?.finishedAt ?? events.at(-1)?.timestamp ?? new Date().toISOString();
  product.durationMs = product.startedAt ? Math.max(0, Date.parse(product.finishedAt) - Date.parse(product.startedAt)) : null;
  if (result && "previewSessionId" in result) {
    product.sessionId = result.previewSessionId || product.sessionId;
    product.baseSessionId = result.baseSessionId || product.baseSessionId;
  } else if (result) product.sessionId = result.sessionId || product.sessionId;

  if (failure || (result && "completed" in result && result.completed !== true)) {
    product.status = "errored";
    product.trace.push({ seq: product.trace.length, at: product.finishedAt, content: failure ?? "The full comparison did not complete." });
  } else if (findings.length) product.status = "failed";
  else if (result && "evaluation" in result && result.evaluation?.status === "passed") product.status = "passed";
  else if (assignment.archetype === "conformance") {
    product.status = "skipped";
    product.trace.push({ seq: product.trace.length, at: product.finishedAt,
      content: result && "evaluation" in result && result.evaluation ? result.evaluation.reason : "Browser steps completed; assertion evaluation is not implemented yet. This is not a passing assertion." });
  } else if (result && "completed" in result && result.completed) {
    product.status = "passed";
    product.trace.push({ seq: product.trace.length, at: product.finishedAt, content: "Both deployments completed the same actions with no unclaimed differences." });
  } else product.status = "errored";
  return ProductAssignment.parse(product);
}

import {
  AssignmentSchema,
  DifferentialResultSchema,
  type AgentEvent,
  type Assignment,
  type AssignmentResult,
  type DifferentialResult,
} from "@aftershock/schema/browser";

import { compareResults, type CompareOptions } from "./comparator.js";
import type { BrowserConfig } from "./config.js";
import { AssignmentFailedError, runAssignment, type ScreenshotWriter } from "./harness.js";
import type { BrowserSessionFactory } from "./session.js";

export interface RunDifferentialOptions {
  assignment: Assignment;
  /** Deployment of the commit under test. */
  previewUrl: string;
  /** Deployment of the base branch. This is the oracle. */
  baseUrl: string;
  emit: (event: AgentEvent) => void | Promise<void>;
  writeScreenshot?: ScreenshotWriter;
  /** Scout's claims, if there is a charter. The oracle works without them. */
  claims?: string[];
  config?: BrowserConfig;
  sessionFactory?: BrowserSessionFactory;
  now?: () => number;
}

/** True once every step carries a recorded Action, i.e. this journey is replayable. */
export function isReplayable(assignment: Assignment): boolean {
  return assignment.journey.every((step) => step.action !== undefined);
}

/**
 * Builds the base-side journey from what the preview side actually planned.
 *
 * Truncated to the steps that ran, not padded to the original length. The base
 * can only replay Actions that exist, so carrying the unreached steps would
 * make it fail at exactly the point the preview did — and two sides failing
 * identically looks like agreement, which is the opposite of the truth.
 */
export function withRecordedActions(
  assignment: Assignment,
  result: AssignmentResult,
): Assignment | null {
  const journey = assignment.journey
    .slice(0, result.steps.length)
    .map((step, index) => {
      const action = result.steps[index]?.action;
      return action ? { ...step, action } : step;
    })
    .filter((step) => step.action !== undefined);

  if (journey.length === 0) return null;
  return AssignmentSchema.parse({ ...assignment, journey });
}

/**
 * Differential execution: the same journey, both deployments, one comparison.
 *
 * Planning happens exactly once. If each side independently asked a model what
 * to click, any behavioural difference could be model variance rather than a
 * real regression — so the preview side plans, and the base side replays the
 * Actions it produced. That is what makes a delta attributable to the code.
 *
 * Ordering follows from that. A journey with no recorded Actions has to plan
 * before it can replay, so the sides run in sequence; a journey that already
 * carries its Actions — a re-run, or Curtain Call against a fix — replays on
 * both sides at once. Same browser-hours either way, half the wall clock when
 * the Actions are already known.
 */
export async function runDifferential(
  options: RunDifferentialOptions,
): Promise<DifferentialResult> {
  const { assignment, previewUrl, baseUrl, emit, writeScreenshot, claims, now = Date.now } = options;

  const startedAt = new Date(now()).toISOString();
  const shared = {
    emit,
    ...(writeScreenshot ? { writeScreenshot } : {}),
    ...(options.config ? { config: options.config } : {}),
    ...(options.sessionFactory ? { sessionFactory: options.sessionFactory } : {}),
    now,
  };

  /**
   * A side that dies part-way still contributes what it captured. A journey
   * that completes on base and breaks on preview is the strongest finding the
   * comparator can make, and throwing it away would mean the worst
   * regressions are the ones the product stays silent about.
   */
  const attempt = async (
    options: Parameters<typeof runAssignment>[0],
  ): Promise<{ result: AssignmentResult; failed: boolean; message?: string }> => {
    try {
      return { result: await runAssignment(options), failed: false };
    } catch (error) {
      if (error instanceof AssignmentFailedError) {
        return { result: error.result, failed: true, message: error.message };
      }
      throw error;
    }
  };

  let preview: AssignmentResult;
  let base: AssignmentResult;
  let previewFailure: string | undefined;
  let baseFailed = false;

  if (isReplayable(assignment)) {
    const [p, b] = await Promise.all([
      attempt({ ...shared, assignment, targetUrl: previewUrl, mode: "replay", side: "preview" }),
      attempt({ ...shared, assignment, targetUrl: baseUrl, mode: "replay", side: "base" }),
    ]);
    preview = p.result;
    base = b.result;
    previewFailure = p.message;
    baseFailed = b.failed;
  } else {
    const p = await attempt({
      ...shared,
      assignment,
      targetUrl: previewUrl,
      mode: "plan",
      side: "preview",
    });
    preview = p.result;
    previewFailure = p.message;

    const baseAssignment = withRecordedActions(assignment, preview);
    if (!baseAssignment) {
      // Nothing was planned, so there is nothing to replay and no comparison
      // to make. The assignment errored; it did not find anything.
      return DifferentialResultSchema.parse({
        assignmentId: assignment.id,
        previewSessionId: preview.sessionId,
        baseSessionId: "",
        deltas: [],
        noiseFiltered: 0,
        findings: [],
        startedAt,
        finishedAt: new Date(now()).toISOString(),
      });
    }

    const b = await attempt({
      ...shared,
      assignment: baseAssignment,
      targetUrl: baseUrl,
      mode: "replay",
      side: "base",
    });
    base = b.result;
    baseFailed = b.failed;
  }

  const compareOptions: CompareOptions = {
    ...(claims ? { claims } : {}),
    route: assignment.route,
  };
  const outcome = compareResults(base, preview, compareOptions);

  /**
   * The journey completes on base and breaks here.
   *
   * Step counts cannot express this, because the base side only ever replays
   * the Actions the preview managed to plan — so both sides stop at the same
   * index and look like they agree. Completion is the signal, not length.
   */
  if (previewFailure && !baseFailed) {
    const at = preview.steps.length;
    outcome.deltas.push({
      stepIndex: at,
      channel: "status",
      field: "journey completion",
      base: `completed ${base.steps.length} steps`,
      preview: `stopped at step ${at}`,
      classification: "unclaimed",
      reason: previewFailure,
    });
    outcome.findings.push({
      class: "hard_failure",
      severity: "critical",
      signature: `differential::status::journey completion`,
      summary: `The journey completes against base but stops at step ${at} here: ${previewFailure}`,
      stepIndex: at,
      evidence: [`base: completed ${base.steps.length} steps`, `preview: ${previewFailure}`],
    });
  }

  // One comparison event per step, so the room can show both panes filling in
  // and say how much churn was dismissed rather than just how much was found.
  const steps = new Set(outcome.deltas.map((d) => d.stepIndex));
  for (const index of [...steps].sort((a, b) => a - b)) {
    const forStep = outcome.deltas.filter((d) => d.stepIndex === index);
    await emit({
      runId: assignment.runId,
      assignmentId: assignment.id,
      timestamp: new Date(now()).toISOString(),
      type: "step.compared",
      index,
      deltas: forStep,
      noiseFiltered: forStep.filter((d) => d.classification === "noise").length,
    });
  }

  for (const finding of outcome.findings) {
    await emit({
      runId: assignment.runId,
      assignmentId: assignment.id,
      timestamp: new Date(now()).toISOString(),
      type: "finding.raised",
      finding,
    });
  }

  return DifferentialResultSchema.parse({
    assignmentId: assignment.id,
    previewSessionId: preview.sessionId,
    baseSessionId: base.sessionId,
    deltas: outcome.deltas,
    noiseFiltered: outcome.noiseFiltered,
    findings: outcome.findings,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
  });
}

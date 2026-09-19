import {
  ActionSchema,
  AssignmentResultSchema,
  type Action,
  type AgentEvent,
  type Assignment,
  type AssignmentResult,
  type AssignmentStepResult,
} from "@aftershock/schema/browser";

import { loadBrowserConfig, type BrowserConfig } from "./config.js";
import { drainPageEvidence } from "./instrument.js";
import { launchBrowserSession, type BrowserSession, type BrowserSessionFactory } from "./session.js";

/**
 * Thrown when an assignment dies part-way, carrying what it managed to
 * collect.
 *
 * A journey that breaks half-way is not an absence of evidence — it is the
 * evidence. The differential comparator has to see the steps that did run to
 * report that the same Actions no longer complete on both sides, which is the
 * signature of the worst class of regression. Callers that only want the
 * happy path can keep treating this as an ordinary throw.
 */
export class AssignmentFailedError extends Error {
  constructor(
    message: string,
    readonly result: AssignmentResult,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AssignmentFailedError";
  }
}

export interface ScreenshotCapture {
  runId: string;
  assignmentId: string;
  index: number;
  body: Uint8Array;
}

export type ScreenshotWriter = (capture: ScreenshotCapture) => Promise<string>;

export interface RunAssignmentOptions {
  assignment: Assignment;
  targetUrl: string;
  mode: "plan" | "replay";
  side: "preview" | "base" | "fix";
  emit: (event: AgentEvent) => void | Promise<void>;
  writeScreenshot?: ScreenshotWriter;
  config?: BrowserConfig;
  sessionFactory?: BrowserSessionFactory;
  now?: () => number;
  /**
   * How long to let the page settle after an action before capturing.
   *
   * Requests are buffered when they complete, so draining the instant an act
   * returns attributes an in-flight call to the next step — or, on the last
   * step, loses it entirely. A short settle is the difference between seeing
   * the call an action triggered and seeing nothing.
   */
  settleMs?: number;
}

function eventBase(assignment: Assignment, now: () => number) {
  return {
    runId: assignment.runId,
    assignmentId: assignment.id,
    timestamp: new Date(now()).toISOString(),
  };
}

function replayAction(assignment: Assignment, index: number): Action {
  const action = assignment.journey[index]?.action;
  if (!action) throw new Error(`Replay requires a persisted action for step ${index}`);
  return action;
}

async function closeSession(
  session: BrowserSession,
  assignment: Assignment,
  emit: RunAssignmentOptions["emit"],
  now: () => number,
  startedAtMs: number,
): Promise<void> {
  await session.close();
  await emit({
    ...eventBase(assignment, now),
    type: "session.closed",
    sessionId: session.sessionId,
    durationMs: now() - startedAtMs,
  });
}

export async function runAssignment(options: RunAssignmentOptions) {
  const {
    assignment,
    targetUrl,
    mode,
    side,
    emit,
    writeScreenshot,
    config = loadBrowserConfig(),
    sessionFactory = launchBrowserSession,
    now = Date.now,
    settleMs = 400,
  } = options;

  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  let session: BrowserSession | undefined;
  // Declared outside the try so a failure can still hand back what ran.
  const steps: AssignmentStepResult[] = [];

  try {
    session = await sessionFactory(config);
    await emit({
      ...eventBase(assignment, now),
      type: "session.opened",
      side,
      sessionId: session.sessionId,
      ...(session.liveViewUrl ? { liveViewUrl: session.liveViewUrl } : {}),
    });

    await session.page.goto(new URL(assignment.route, targetUrl).toString(), {
      waitUntil: "domcontentloaded",
    });

    for (const [index, journeyStep] of assignment.journey.entries()) {
      let action: Action;

      if (mode === "plan") {
        const planStartedAt = now();
        const observed = await session.stagehand.observe(journeyStep.instruction);
        const candidate = observed.data[0];
        if (!candidate) {
          throw new Error(`Stagehand found no action for step ${index}: ${journeyStep.instruction}`);
        }
        action = ActionSchema.parse(candidate);
        await emit({
          ...eventBase(assignment, now),
          type: "step.planned",
          index,
          instruction: journeyStep.instruction,
          action,
          ...(observed.metadata.actionId ? { actionId: observed.metadata.actionId } : {}),
          cacheStatus: observed.metadata.cache.status,
          usage: observed.metadata.usage,
          durationMs: now() - planStartedAt,
        });
      } else {
        action = replayAction(assignment, index);
      }

      const actionStartedAt = now();
      const acted = await session.stagehand.act(action);
      await emit({
        ...eventBase(assignment, now),
        type: "step.executed",
        index,
        action,
        ...(acted.metadata.actionId ? { actionId: acted.metadata.actionId } : {}),
        usage: acted.metadata.usage,
        durationMs: now() - actionStartedAt,
      });

      const captureStartedAt = now();
      if (settleMs > 0) await session.page.waitForTimeout(settleMs);
      const [snapshot, screenshot, url, evidence] = await Promise.all([
        session.page.snapshot(),
        session.page.screenshot(),
        session.page.url(),
        drainPageEvidence(session.page),
      ]);
      const screenshotBody = Uint8Array.from(screenshot);
      const screenshotId = writeScreenshot
        ? await writeScreenshot({
            runId: assignment.runId,
            assignmentId: assignment.id,
            index,
            body: screenshotBody,
          })
        : undefined;
      const result = {
        index,
        instruction: journeyStep.instruction,
        action,
        snapshot: {
          url,
          formattedTree: snapshot.formattedTree,
          screenshot: screenshotBody,
          network: evidence.network,
          console: evidence.console,
        },
        durationMs: now() - captureStartedAt,
      } satisfies AssignmentStepResult;
      steps.push(result);

      await emit({
        ...eventBase(assignment, now),
        type: "step.captured",
        index,
        url,
        ...(screenshotId ? { screenshotId } : {}),
        network: evidence.network,
        consoleErrors: evidence.console.filter((entry) => entry.level === "error"),
      });
    }

    return AssignmentResultSchema.parse({
      assignmentId: assignment.id,
      sessionId: session.sessionId,
      steps,
      findings: [],
      startedAt,
      finishedAt: new Date(now()).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit({
      ...eventBase(assignment, now),
      type: "session.failed",
      ...(session ? { sessionId: session.sessionId } : {}),
      message,
    });

    throw new AssignmentFailedError(
      message,
      AssignmentResultSchema.parse({
        assignmentId: assignment.id,
        sessionId: session?.sessionId ?? "",
        steps,
        findings: [],
        startedAt,
        finishedAt: new Date(now()).toISOString(),
      }),
      error,
    );
  } finally {
    if (session) await closeSession(session, assignment, emit, now, startedAtMs);
  }
}

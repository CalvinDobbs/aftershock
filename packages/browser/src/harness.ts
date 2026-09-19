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

/**
 * Instructions that mean "be on this page" rather than "click this thing".
 *
 * A real journey spans routes — product, cart, checkout — and the harness
 * only navigated once, at the start. Everything after that went through
 * `observe`, which searches the accessibility tree for an element to act on
 * and finds nothing for "Go to /checkout". Worse, it *sometimes* found a
 * matching link, so the same journey passed or failed depending on whether
 * the page happened to have one. Navigation is now deterministic: no
 * inference, no variance, and free.
 */
const NAVIGATION = /^(?:go|navigate|head|proceed)\s+(?:to|back to)\s+(?:the\s+)?(\/\S*)|^(?:open|visit|load)\s+(?:the\s+)?(\/\S*)/i;

export function navigationTarget(instruction: string): string | null {
  const match = instruction.trim().match(NAVIGATION);
  const path = match?.[1] ?? match?.[2];
  return path ? path.replace(/[.,;]$/, "") : null;
}

/** The Action a navigation records, so replay reproduces it exactly. */
function gotoAction(path: string, instruction: string): Action {
  return { method: "goto", description: instruction, selector: "", arguments: [path] };
}

function replayAction(assignment: Assignment, index: number): Action {
  const action = assignment.journey[index]?.action;
  if (!action) throw new Error(`Replay requires a persisted action for step ${index}`);
  return action;
}

const NO_INFERENCE = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 0,
};

/**
 * One retry on a failed plan.
 *
 * The PRD's rule: escalate on `observe`, never on `act`. A failed `act` may
 * already have clicked before the error surfaced, so retrying repeats the
 * side effect; `observe` only plans, so retrying is free. Pages that are
 * still hydrating are the common case, and losing a whole assignment to one
 * early look is expensive.
 */
async function observeWithRetry(
  session: BrowserSession,
  instruction: string,
  index: number,
): Promise<Awaited<ReturnType<BrowserSession["stagehand"]["observe"]>>> {
  const first = await session.stagehand.observe(instruction);
  if (first.data[0]) return first;
  await session.page.waitForTimeout(800);
  void index;
  return session.stagehand.observe(instruction);
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
    emit: send,
    writeScreenshot,
    config = loadBrowserConfig(),
    sessionFactory = launchBrowserSession,
    now = Date.now,
    settleMs = 400,
  } = options;
  const emit: RunAssignmentOptions["emit"] = (event) => send({ ...event, side });

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

      // Navigation is resolved before any inference: it is deterministic,
      // costs nothing, and is the one instruction `observe` cannot serve.
      const navigateTo =
        mode === "plan"
          ? navigationTarget(journeyStep.instruction)
          : replayAction(assignment, index).method === "goto"
            ? (replayAction(assignment, index).arguments?.[0] ?? null)
            : null;

      if (navigateTo !== null) {
        const navStartedAt = now();
        await session.page.goto(new URL(navigateTo, targetUrl).toString(), {
          waitUntil: "domcontentloaded",
        });
        action = gotoAction(navigateTo, journeyStep.instruction);
        await emit({
          ...eventBase(assignment, now),
          type: "step.executed",
          index,
          action,
          usage: NO_INFERENCE,
          durationMs: now() - navStartedAt,
        });
      } else if (mode === "plan") {
        const planStartedAt = now();
        const observed = await observeWithRetry(session, journeyStep.instruction, index);
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

      if (navigateTo === null) {
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
      }

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

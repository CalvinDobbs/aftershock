import {
  ActionSchema,
  AssignmentResultSchema,
  type Action,
  type AgentEvent,
  type Assignment,
  type AssignmentStepResult,
} from "@aftershock/schema";

import { loadBrowserConfig, type BrowserConfig } from "./config.js";
import { collectSessionEvidence } from "./evidence.js";
import { launchBrowserSession, type BrowserSession, type BrowserSessionFactory } from "./session.js";

export interface RunAssignmentOptions {
  assignment: Assignment;
  targetUrl: string;
  mode: "plan" | "replay";
  side: "preview" | "base" | "fix";
  emit: (event: AgentEvent) => void | Promise<void>;
  config?: BrowserConfig;
  sessionFactory?: BrowserSessionFactory;
  now?: () => number;
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
    config = loadBrowserConfig(),
    sessionFactory = launchBrowserSession,
    now = Date.now,
  } = options;

  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  let session: BrowserSession | undefined;

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

    const steps: AssignmentStepResult[] = [];

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
      const [snapshot, screenshot, url, evidence] = await Promise.all([
        session.page.snapshot(),
        session.page.screenshot(),
        session.page.url(),
        collectSessionEvidence(session.browserbase, session.sessionId),
      ]);
      const result = {
        index,
        instruction: journeyStep.instruction,
        action,
        snapshot: {
          url,
          formattedTree: snapshot.formattedTree,
          screenshot: Uint8Array.from(screenshot),
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
    await emit({
      ...eventBase(assignment, now),
      type: "session.failed",
      ...(session ? { sessionId: session.sessionId } : {}),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (session) await closeSession(session, assignment, emit, now, startedAtMs);
  }
}

import type {
  Assignment,
  AssignmentResult,
  DifferentialResult,
} from "@aftershock/schema/browser";
import type { TestCharter } from "@aftershock/schema";
import {
  GitHubClient,
  dispatchOrder,
  inferCharter,
  smokeCharter,
  mapRoutes,
  openAiModel,
  sessionBudget,
  toAssignments,
  type CharterModel,
  type CriticalJourney,
} from "@aftershock/scout";

import { runObservableAssignment } from "./assignment-runner.js";
import { runObservableDifferential } from "./differential-runner.js";
import type { RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

/**
 * The Director, in the shape the PRD describes: one commit in, a fleet of
 * browsers out.
 *
 * Scout reads the diff and writes the charter, the charter becomes
 * assignments, and the assignments are dispatched against a semaphore.
 * Differential pairs go first because they hold two slots and are the most
 * valuable, and a pair is dispatched atomically or not at all — a half
 * dispatched pair is useless and wastes a slot.
 */

export interface CommitRunOptions {
  runId: string;
  repo: string;
  base: string;
  head: string;
  prNumber?: number;

  /** Deployment of the commit under test. */
  previewUrl: string;
  /** Deployment of the base branch. Null skips every differential pair. */
  baseUrl: string | null;

  criticalJourney?: CriticalJourney;
  fallbackRoutes?: string[];
  routeSamples?: Record<string, string>;
  /** Steps that put the app into the state a route needs. See toAssignments. */
  routeSetup?: Record<string, string[]>;
  maxConcurrent?: number;

  eventStream: RunEventStream;
  screenshotRepository: ScreenshotRepository;
  github?: GitHubClient;
  model?: CharterModel;
}

/**
 * Work that did not run.
 *
 * Coverage gaps are reported, never silent. `stage` matters as much as the
 * reason: an assertion dropped by the charter is a Scout problem, one dropped
 * at dispatch is a capacity problem, and one dropped at run time is a flaky
 * browser. They need different fixes, so they are distinguishable here.
 */
export interface SkippedWork {
  /** The assertion this came from. Assignments inherit the assertion's id. */
  id: string;
  stage: "charter" | "dispatch" | "run";
  reason: string;
}

export interface CommitRunOutcome {
  charter: TestCharter;
  assignments: Assignment[];
  conformance: AssignmentResult[];
  differential: DifferentialResult[];
  /** Anything that could not run, and why. The run degrades, it does not abort. */
  skipped: SkippedWork[];
}

/** A differential holds two slots; everything else holds one. */
const cost = (assignment: Assignment) => (assignment.archetype === "differential" ? 2 : 1);

export async function runFromCommit(options: CommitRunOptions): Promise<CommitRunOutcome> {
  const {
    runId,
    previewUrl,
    baseUrl,
    eventStream,
    screenshotRepository,
    github = new GitHubClient({ ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}) }),
  } = options;

  const intent = await github.readIntent({
    repo: options.repo,
    base: options.base,
    head: options.head,
    ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}),
  });

  const surfaces = mapRoutes(intent.files, {
    ...(options.fallbackRoutes ? { fallbackRoutes: options.fallbackRoutes } : {}),
  });

  const charterInput = {
    runId,
    intent,
    surfaces,
    ...(options.criticalJourney ? { criticalJourney: options.criticalJourney } : {}),
  };

  // Constructing the model can throw on a missing key, which is outside
  // inferCharter's own fallback. Scout is allowed to fail — the differential
  // oracle needs no intent — so a missing OPENAI_API_KEY degrades the run
  // rather than aborting it.
  let charter: TestCharter;
  try {
    charter = await inferCharter(charterInput, { model: options.model ?? openAiModel() });
  } catch {
    charter = smokeCharter(charterInput);
  }

  const { assignments, skipped } = toAssignments(charter, {
    runId,
    ...(options.routeSamples ? { routeSamples: options.routeSamples } : {}),
    ...(options.routeSetup ? { routeSetup: options.routeSetup } : {}),
  });

  // Risk drives the fleet: a one-line CSS change does not deserve the same
  // number of browsers as a change to payment logic.
  // Explicit option wins, then the environment, then the risk-derived budget:
  // a one-line CSS change does not deserve the fleet a payment change gets.
  const configured = Number.parseInt(process.env.MAX_CONCURRENT ?? "", 10);
  const [maxConcurrent, budgetSource] =
    options.maxConcurrent !== undefined
      ? ([options.maxConcurrent, "the request"] as const)
      : Number.isInteger(configured) && configured > 0
        ? ([configured, "MAX_CONCURRENT"] as const)
        : ([sessionBudget(charter.riskScore), "the risk score"] as const);

  const conformance: AssignmentResult[] = [];
  const differential: DifferentialResult[] = [];
  const allSkipped: SkippedWork[] = skipped.map((s) => ({
    id: s.assertionId,
    stage: "charter" as const,
    reason: s.reason,
  }));

  const runOne = async (assignment: Assignment): Promise<void> => {
    if (assignment.archetype === "differential") {
      if (!baseUrl) {
        // Base URL resolution failed. Differential is the stronger oracle, so
        // losing it matters — but the run continues with conformance rather
        // than failing, and the reason is surfaced.
        allSkipped.push({
          id: assignment.id,
          stage: "dispatch",
          reason: "no base deployment to compare against",
        });
        return;
      }
      differential.push(
        await runObservableDifferential({
          assignment,
          previewUrl,
          baseUrl,
          claims: charter.intent.claims,
          eventStream,
          screenshotRepository,
        }),
      );
      return;
    }

    conformance.push(
      await runObservableAssignment({
        assignment,
        targetUrl: previewUrl,
        mode: "plan",
        side: "preview",
        eventStream,
        screenshotRepository,
      }),
    );
  };

  await dispatch(dispatchOrder(assignments), maxConcurrent, runOne, allSkipped, budgetSource);

  // Coverage gaps go on the event stream, not just into a return value the
  // HTTP caller never sees. A run that quietly tested less than it claimed is
  // worse than one that failed loudly.
  //
  // Run-stage skips are excluded: the harness already emitted `session.failed`
  // for those, and repeating them reads as two separate problems.
  for (const gap of allSkipped.filter((g) => g.stage !== "run")) {
    await eventStream.publish({
      runId,
      assignmentId: gap.id,
      timestamp: new Date().toISOString(),
      type: "session.failed",
      message: `skipped at ${gap.stage}: ${gap.reason}`,
    });
  }

  return { charter, assignments, conformance, differential, skipped: allSkipped };
}

/**
 * The semaphore.
 *
 * Assignments are started as slots free rather than all at once, so the fleet
 * size is a configuration value and never an assumption. An assignment that
 * could never fit is skipped with a reason instead of deadlocking the queue
 * behind it, which is what would happen to a differential pair on a plan that
 * only allows one concurrent session.
 */
export async function dispatch(
  queue: Assignment[],
  maxConcurrent: number,
  run: (assignment: Assignment) => Promise<void>,
  skipped: SkippedWork[],
  /** Named in skip reasons so a capacity problem points at its own cause. */
  budgetSource = "MAX_CONCURRENT",
): Promise<void> {
  const pending = [...queue];
  const inFlight = new Set<Promise<void>>();
  let free = Math.max(1, maxConcurrent);

  while (pending.length > 0 || inFlight.size > 0) {
    let started = false;

    while (pending.length > 0) {
      const next = pending[0]!;
      const need = cost(next);

      if (need > Math.max(1, maxConcurrent)) {
        pending.shift();
        skipped.push({
          id: next.id,
          stage: "dispatch",
          reason: `needs ${need} concurrent sessions, ${budgetSource} allows ${maxConcurrent}`,
        });
        continue;
      }

      if (need > free) break;

      pending.shift();
      free -= need;
      started = true;

      const task = run(next)
        .catch((error: unknown) => {
          // One agent dying is normal with several browsers in flight. The
          // run degrades rather than aborting.
          skipped.push({
            id: next.id,
            stage: "run",
            reason: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          free += need;
          inFlight.delete(task);
        });
      inFlight.add(task);
    }

    if (inFlight.size === 0 && !started && pending.length > 0) {
      // Nothing running and nothing startable would spin forever.
      for (const stuck of pending.splice(0)) {
        skipped.push({ id: stuck.id, stage: "dispatch", reason: "no slot ever became available" });
      }
      break;
    }

    if (inFlight.size > 0) await Promise.race(inFlight);
  }
}

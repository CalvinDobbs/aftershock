import type { Server } from "node:http";
import { join } from "node:path";

import {
  createSessionReplayService,
  runAssignment,
  runDifferential,
  type RunAssignmentOptions,
  type RunDifferentialOptions,
} from "@aftershock/browser";
import { AssignmentSchema } from "@aftershock/schema/browser";
import type { RunEvent } from "@aftershock/schema";

import { runObservableAssignment } from "./assignment-runner.js";
import { runObservableDifferential } from "./differential-runner.js";
import { RunEventStream, type EventRepository } from "./event-stream.js";
import { JsonlEventRepository } from "./jsonl-event-repository.js";
import { runFromCommit } from "./commit-run.js";
import { noiseCanary } from "./noise-canary.js";
import {
  createObservabilityServer,
  type CommitRunRequest,
  type DemoRun,
} from "./observability-api.js";
import { FileScreenshotRepository } from "./screenshot-repository.js";

export interface ObservabilityRuntimeOptions {
  dataDirectory: string;
  browserbaseApiKey: string;
  /** Shauraya can supply Postgres without editing this module. */
  eventRepository?: EventRepository;
  emitPipelineEvent?: (runId: string, event: RunEvent) => void | Promise<void>;
  onCommitRunComplete?: (runId: string, outcome: Awaited<ReturnType<typeof runFromCommit>>) => void | Promise<void>;
}

export interface ObservabilityRuntime {
  eventStream: RunEventStream;
  screenshotRepository: FileScreenshotRepository;
  server: Server;
  runAssignment(
    options: Omit<RunAssignmentOptions, "emit" | "writeScreenshot">,
  ): ReturnType<typeof runAssignment>;
  runDifferential(
    options: Omit<RunDifferentialOptions, "emit" | "writeScreenshot">,
  ): ReturnType<typeof runDifferential>;
  startDemoRun(): DemoRun | undefined;
  startNoiseCanary(): DemoRun | undefined;
  /** Scout reads the commit, the Director dispatches the fleet. */
  startCommitRun(request: CommitRunRequest): { runId: string };
}

export function createObservabilityRuntime(
  options: ObservabilityRuntimeOptions,
): ObservabilityRuntime {
  const eventStream = new RunEventStream(
    options.eventRepository ?? new JsonlEventRepository(join(options.dataDirectory, "traces")),
  );
  const screenshotRepository = new FileScreenshotRepository(
    join(options.dataDirectory, "screenshots"),
  );
  let demoActive = false;
  let demoCounter = 0;
  const startDemoRun = (): DemoRun | undefined => {
    if (demoActive) return undefined;
    demoActive = true;
    const assignment = AssignmentSchema.parse({
      id: "smoke-stagehand",
      runId: `demo-${Date.now()}-${demoCounter++}`,
      archetype: "conformance",
      route: "/",
      objective: "Open the top story discussion",
      journey: [{ instruction: "Click the comments link for the top story" }],
    });
    void runObservableAssignment({
      assignment,
      targetUrl: "https://news.ycombinator.com",
      mode: "plan",
      side: "preview",
      eventStream,
      screenshotRepository,
    }).then(
      () => {
        demoActive = false;
      },
      () => {
        demoActive = false;
      },
    );
    return { runId: assignment.runId, assignmentId: assignment.id };
  };

  /**
   * The noise canary: the same journey, the same URL, compared against itself.
   *
   * A page differs from itself on every load — timestamps, ids, nonces — so
   * this run must finish with zero unclaimed deltas. If it finds something,
   * the normalisation rules have a hole, and every differential finding the
   * product reports is suspect. It is the cheapest possible check on the one
   * risk the PRD rates highest, and it costs two sessions.
   */
  let canaryActive = false;
  let canaryCounter = 0;
  const startNoiseCanary = (): DemoRun | undefined => {
    if (canaryActive) return undefined;
    const canary = noiseCanary(`canary-${Date.now()}-${canaryCounter++}`);
    const { assignment } = canary;

    // Claimed only once the assignment is known good. Setting it earlier
    // meant a bad AFTERSHOCK_CANARY_STEP latched the flag and every later
    // request answered 409 until the process restarted.
    canaryActive = true;
    void runObservableDifferential({
      ...canary,
      eventStream,
      screenshotRepository,
    }).then(
      () => {
        canaryActive = false;
      },
      () => {
        canaryActive = false;
      },
    );
    return { runId: assignment.runId, assignmentId: assignment.id };
  };

  /**
   * One commit in, a fleet out. Returns as soon as the run has an id, because
   * a real run takes minutes and the caller follows it on the event stream.
   */
  let commitCounter = 0;
  const startCommitRun = (request: CommitRunRequest): { runId: string } => {
    const runId = `run-${Date.now()}-${commitCounter++}`;
    void runFromCommit({
      runId,
      repo: request.repo,
      base: request.base,
      head: request.head,
      ...(request.prNumber !== undefined ? { prNumber: request.prNumber } : {}),
      previewUrl: request.previewUrl,
      baseUrl: request.baseUrl ?? null,
      ...(request.fallbackRoutes ? { fallbackRoutes: request.fallbackRoutes } : {}),
      ...(request.routeSamples ? { routeSamples: request.routeSamples } : {}),
      ...(request.routeSetup ? { routeSetup: request.routeSetup } : {}),
      // Rebuilt rather than spread: zod infers `route?: string | undefined`
      // and the interface asks for `route?: string`, which
      // exactOptionalPropertyTypes treats as different types.
      ...(request.criticalJourney
        ? {
            criticalJourney: {
              description: request.criticalJourney.description,
              steps: request.criticalJourney.steps,
              ...(request.criticalJourney.route
                ? { route: request.criticalJourney.route }
                : {}),
            },
          }
        : {}),
      ...(request.maxConcurrent !== undefined ? { maxConcurrent: request.maxConcurrent } : {}),
      eventStream,
      screenshotRepository,
      ...(options.emitPipelineEvent ? {
        emitPipelineEvent: (event: RunEvent) => options.emitPipelineEvent!(runId, event),
      } : {}),
    }).then(async (outcome) => {
      await options.onCommitRunComplete?.(runId, outcome);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`run ${runId} failed:`, error);

      // A run can die before any browser opens — a GitHub 404, a rate limit,
      // a model outage. Without this the run id has no traces at all, so it
      // never appears in /api/runs and its stream stays empty forever, which
      // contradicts the 202 "follow it on the stream" contract.
      void eventStream.publish({
        runId,
        assignmentId: "director",
        timestamp: new Date().toISOString(),
        type: "session.failed",
        message: `run failed before dispatch: ${message}`,
      });
    });
    return { runId };
  };

  const server = createObservabilityServer({
    eventStream,
    replayService: createSessionReplayService(options.browserbaseApiKey),
    screenshotRepository,
    demoRunLauncher: startDemoRun,
    noiseCanaryLauncher: startNoiseCanary,
    commitRunLauncher: startCommitRun,
  });

  return {
    eventStream,
    screenshotRepository,
    server,
    runAssignment: (assignmentOptions) =>
      runObservableAssignment({ ...assignmentOptions, eventStream, screenshotRepository }),
    runDifferential: (differentialOptions) =>
      runObservableDifferential({ ...differentialOptions, eventStream, screenshotRepository }),
    startDemoRun,
    startNoiseCanary,
    startCommitRun,
  };
}

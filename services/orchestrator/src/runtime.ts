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

import { runObservableAssignment } from "./assignment-runner.js";
import { runObservableDifferential } from "./differential-runner.js";
import { RunEventStream } from "./event-stream.js";
import { JsonlEventRepository } from "./jsonl-event-repository.js";
import { createObservabilityServer, type DemoRun } from "./observability-api.js";
import { FileScreenshotRepository } from "./screenshot-repository.js";

export interface ObservabilityRuntimeOptions {
  dataDirectory: string;
  browserbaseApiKey: string;
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
}

export function createObservabilityRuntime(
  options: ObservabilityRuntimeOptions,
): ObservabilityRuntime {
  const eventStream = new RunEventStream(
    new JsonlEventRepository(join(options.dataDirectory, "traces")),
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
    // The target has to be static. A site whose content changes between two
    // loads produces real differences, and the canary would then be measuring
    // the internet rather than the noise filter.
    const target = process.env.AFTERSHOCK_CANARY_URL || "https://example.com";
    const instruction =
      process.env.AFTERSHOCK_CANARY_STEP || "Click the More information link";
    const assignment = AssignmentSchema.parse({
      id: "noise-canary",
      runId: `canary-${Date.now()}-${canaryCounter++}`,
      archetype: "differential",
      route: "/",
      objective: "Compare a deployment against itself and expect nothing",
      journey: [{ instruction }],
    });

    // Claimed only once the assignment is known good. Setting it earlier
    // meant a bad AFTERSHOCK_CANARY_STEP latched the flag and every later
    // request answered 409 until the process restarted.
    canaryActive = true;
    void runObservableDifferential({
      assignment,
      previewUrl: target,
      baseUrl: target,
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

  const server = createObservabilityServer({
    eventStream,
    replayService: createSessionReplayService(options.browserbaseApiKey),
    screenshotRepository,
    demoRunLauncher: startDemoRun,
    noiseCanaryLauncher: startNoiseCanary,
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
  };
}

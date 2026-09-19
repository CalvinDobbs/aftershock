import type { Server } from "node:http";
import { join } from "node:path";

import {
  createSessionReplayService,
  runAssignment,
  type RunAssignmentOptions,
} from "@aftershock/browser";
import { AssignmentSchema } from "@aftershock/schema/browser";

import { runObservableAssignment } from "./assignment-runner.js";
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
  startDemoRun(): DemoRun | undefined;
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

  const server = createObservabilityServer({
    eventStream,
    replayService: createSessionReplayService(options.browserbaseApiKey),
    screenshotRepository,
    demoRunLauncher: startDemoRun,
  });

  return {
    eventStream,
    screenshotRepository,
    server,
    runAssignment: (assignmentOptions) =>
      runObservableAssignment({ ...assignmentOptions, eventStream, screenshotRepository }),
    startDemoRun,
  };
}

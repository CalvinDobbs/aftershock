import type { Server } from "node:http";
import { join } from "node:path";

import {
  createSessionReplayService,
  runAssignment,
  type RunAssignmentOptions,
} from "@aftershock/browser";

import { runObservableAssignment } from "./assignment-runner.js";
import { RunEventStream } from "./event-stream.js";
import { JsonlEventRepository } from "./jsonl-event-repository.js";
import { createObservabilityServer } from "./observability-api.js";
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
  const server = createObservabilityServer({
    eventStream,
    replayService: createSessionReplayService(options.browserbaseApiKey),
    screenshotRepository,
  });

  return {
    eventStream,
    screenshotRepository,
    server,
    runAssignment: (assignmentOptions) =>
      runObservableAssignment({ ...assignmentOptions, eventStream, screenshotRepository }),
  };
}

import { runAssignment, type RunAssignmentOptions } from "@aftershock/browser";

import type { RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

export interface ObservableAssignmentOptions
  extends Omit<RunAssignmentOptions, "emit" | "writeScreenshot"> {
  eventStream: RunEventStream;
  screenshotRepository: ScreenshotRepository;
}

export function runObservableAssignment(options: ObservableAssignmentOptions) {
  const { eventStream, screenshotRepository, ...assignmentOptions } = options;
  return runAssignment({
    ...assignmentOptions,
    emit: async (event) => {
      await eventStream.publish(event);
    },
    writeScreenshot: (capture) => screenshotRepository.put(capture),
  });
}

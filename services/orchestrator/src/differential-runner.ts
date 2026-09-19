import { runDifferential, type RunDifferentialOptions } from "@aftershock/browser";

import type { RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

export interface ObservableDifferentialOptions
  extends Omit<RunDifferentialOptions, "emit" | "writeScreenshot"> {
  eventStream: RunEventStream;
  screenshotRepository: ScreenshotRepository;
}

/**
 * A differential pair, with its telemetry persisted and streamed.
 *
 * Both sides publish to the same run, so the room pairs the panes by the
 * `side` on each `session.opened`. Every comparison and every finding lands on
 * the same sequenced stream as the steps that produced them.
 */
export function runObservableDifferential(options: ObservableDifferentialOptions) {
  const { eventStream, screenshotRepository, ...differentialOptions } = options;
  return runDifferential({
    ...differentialOptions,
    emit: async (event) => {
      await eventStream.publish(event);
    },
    writeScreenshot: (capture) => screenshotRepository.put(capture),
  });
}

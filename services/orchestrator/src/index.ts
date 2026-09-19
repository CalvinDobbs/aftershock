/**
 * `orchestrator` — the Director.
 *
 * Owns the browser runtime: session dispatch, the evidence pipeline, and the
 * observability API the dashboard reads. Every assignment run emits a sequenced
 * `AgentEvent` (see `@aftershock/schema/browser`) that is persisted as JSONL and
 * replayed to the frontend over SSE, so a finished run is as viewable as a live
 * one.
 *
 * Commit runs dispatch through a weighted semaphore, then the Critic replays
 * candidates and returns findings plus unpublished issue drafts. Product-stage
 * events use an injectable sink, separate from browser telemetry. The API run
 * persistence bridge and repair integrations are still to land.
 */
export {
  InMemoryEventRepository,
  RunEventStream,
  type EventListener,
  type EventRepository,
} from "./event-stream.js";
export { JsonlEventRepository } from "./jsonl-event-repository.js";
export { resolveDataDirectory } from "./data-directory.js";
export {
  dispatch,
  runFromCommit,
  type CommitRunOptions,
  type CommitRunOutcome,
  type SkippedWork,
} from "./commit-run.js";
export {
  CommitRunRequestSchema,
  createObservabilityHandler,
  createObservabilityServer,
  type DemoRun,
  type CommitRunLauncher,
  type CommitRunRequest,
  type DemoRunLauncher,
  type ObservabilityApiOptions,
} from "./observability-api.js";
export {
  runObservableAssignment,
  type ObservableAssignmentOptions,
} from "./assignment-runner.js";
export {
  runObservableDifferential,
  type ObservableDifferentialOptions,
} from "./differential-runner.js";
export {
  createObservabilityRuntime,
  type ObservabilityRuntime,
  type ObservabilityRuntimeOptions,
} from "./runtime.js";
export {
  FileScreenshotRepository,
  type ScreenshotRepository,
} from "./screenshot-repository.js";

export { runRepairChain, type RepairServices } from "./repair-chain.js";
export { repairServicesFromEnv, parsePreviewCommand } from "./repair-services.js";

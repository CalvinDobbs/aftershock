/**
 * `orchestrator` — the Director.
 *
 * Owns the browser runtime: session dispatch, the evidence pipeline, and the
 * observability API the dashboard reads. Every assignment run emits a sequenced
 * `AgentEvent` (see `@aftershock/schema/browser`) that is persisted as JSONL and
 * replayed to the frontend over SSE, so a finished run is as viewable as a live
 * one.
 *
 * Still to land: the stage machine and the concurrency semaphore sized to
 * MAX_CONCURRENT, dispatching differential pairs first — they need two slots and
 * a half-dispatched pair is useless — then conformance, and emitting one
 * `RunEvent` per stage completion for the dashboard's progressive reveal.
 *
 * Every session is wrapped in try/finally and a reaper sweeps every 60s for
 * anything older than AGENT_TIMEOUT_MS. Leaked sessions are the fastest way to
 * burn the 100-hour grant.
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

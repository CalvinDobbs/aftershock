export { loadBrowserConfig, type BrowserConfig } from "./config.js";
export {
  drainPageEvidence,
  EVIDENCE_KEY,
  INSTRUMENT_SCRIPT,
  type EvidencePage,
} from "./instrument.js";
export {
  AssignmentFailedError,
  runAssignment,
  type RunAssignmentOptions,
  type ScreenshotCapture,
  type ScreenshotWriter,
} from "./harness.js";
export { launchBrowserSession, type BrowserSession, type BrowserSessionFactory } from "./session.js";
export {
  createSessionReplayService,
  type RecordingDownload,
  type ReplayPage,
  type ReplayPlaylist,
  type SessionReplay,
  type SessionReplayService,
} from "./replay.js";
export {
  claimCovering,
  compareResults,
  compareSnapshots,
  findingsFrom,
  type ComparisonOutcome,
  type CompareOptions,
} from "./comparator.js";
export {
  isReplayable,
  runDifferential,
  withRecordedActions,
  type RunDifferentialOptions,
} from "./differential.js";
export {
  NOISE_RULES,
  normalise,
  normaliseTreeLine,
  normaliseUrl,
  pathAndQuery,
  rulesFired,
  volatileReason,
  type NoiseRule,
} from "./normalise.js";

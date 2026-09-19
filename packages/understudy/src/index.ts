/**
 * `understudy` — Stage 5, patch generation via Codex.
 *
 * Codex is a runtime component of the product here, not a build-time
 * assistant: it is handed a bounded brief and edits a real checkout, and what
 * comes back is read from git rather than from the model. A patch that broke
 * its constraints is returned rejected rather than dropped, because the run
 * has to be able to say what it tried.
 */
export {
  parseSummary,
  writePatch,
  type WritePatchDeps,
  type WritePatchInput,
} from "./understudy.js";
export { branchName, buildBrief, commitMessage, retryBrief } from "./brief.js";
export {
  failuresFrom,
  repair,
  unverifiedBody,
  type RepairLoopDeps,
  type RepairLoopInput,
  type RepairOutcome,
} from "./repair.js";
export {
  publishPatch,
  verifiedBody,
  type PatchGitHub,
  type PublishDeps,
  type PublishInput,
} from "./publish.js";
export {
  changedLineCount,
  changedPaths,
  violations,
  DEFAULT_CONSTRAINTS,
  type Constraints,
} from "./constraints.js";
export {
  codexRunner,
  gitDiff,
  readChangedFiles,
  type CodexRunner,
  type CodexRunnerOptions,
  type CodexSession,
  type CodexTurn,
  type DiffReader,
} from "./codex.js";

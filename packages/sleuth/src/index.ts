/**
 * `sleuth` — Stage 4, root cause localisation.
 *
 * Takes a confirmed issue and the commit under test, and returns ranked
 * hypotheses about where the bug lives. It reports that it cannot find the
 * cause rather than inventing a plausible file, because a wrong location
 * sends Understudy somewhere it cannot help.
 */
export {
  buildPrompt,
  diagnose,
  inconclusiveDiagnosis,
  INCONCLUSIVE_BELOW,
  type DiagnoseDeps,
  type DiagnoseInput,
  type DiagnosisModel,
} from "./diagnose.js";
export { keywords, rankSuspects, type Suspect } from "./suspects.js";

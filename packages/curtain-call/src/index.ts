/**
 * `curtain-call` — Stage 6, verification.
 *
 * Replays the assignments that failed against the patch preview, exercises the
 * issue's fix checklist, and re-runs the differential suite against the
 * original base. All three must pass; anything less opens as an unverified
 * draft that says why.
 */
export {
  checklistAssignment,
  verificationLabels,
  verify,
  type VerifyDeps,
  type VerifyInput,
} from "./verify.js";

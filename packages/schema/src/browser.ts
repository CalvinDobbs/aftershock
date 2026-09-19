import { z } from "zod";

export const AssignmentArchetypeSchema = z.enum([
  "conformance",
  "differential",
  "explorer",
  "adversary",
]);

export const ActionSchema = z.object({
  selector: z.string(),
  description: z.string(),
  method: z.string().optional(),
  arguments: z.array(z.string()).optional(),
});

export const JourneyStepSchema = z.object({
  instruction: z.string().min(1),
  action: ActionSchema.optional(),
});

export const AssignmentSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  archetype: AssignmentArchetypeSchema,
  assertionId: z.string().optional(),
  route: z.string().startsWith("/"),
  objective: z.string().min(1),
  journey: z.array(JourneyStepSchema).min(1),
});

export const NetworkRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().int().optional(),
  durationMs: z.number().nonnegative().optional(),
  errorText: z.string().optional(),
  /**
   * The application cancelled this itself — an effect cleanup, a superseded
   * search. Recorded, but never a failure: whether a cancellation happens is
   * a race, and racing evidence produces findings that will not reproduce.
   */
  aborted: z.boolean().optional(),
});

export const NetworkSummarySchema = z.object({
  requestCount: z.number().int().nonnegative(),
  /**
   * The calls the app made, bounded. Failures alone are not enough: the
   * decisive evidence in a diagnosis is often a request that *succeeded*
   * followed by one that never happened — "the validate call returned 200
   * and then nothing asked for a new total" localises a bug to client state
   * before anyone opens a file.
   */
  requests: z.array(NetworkRequestSchema).default([]),
  failedRequests: z.array(NetworkRequestSchema),
  /**
   * False when the runtime could not observe the network at all, so an empty
   * list reads as "not captured" rather than "nothing happened". Silence and
   * absence of evidence are different claims.
   *
   * Defaults to false on purpose. Evidence recorded before this flag existed
   * came from a path that measurably observed nothing, and defaulting to true
   * would reparse all of it as a genuine "the app made no requests".
   */
  captured: z.boolean().default(false),
});

export const ConsoleEntrySchema = z.object({
  level: z.string(),
  text: z.string(),
  timestamp: z.number(),
});

export const StepSnapshotSchema = z.object({
  url: z.string().url(),
  formattedTree: z.string(),
  screenshot: z.instanceof(Uint8Array),
  network: NetworkSummarySchema,
  console: z.array(ConsoleEntrySchema),
});

export const AssignmentStepResultSchema = z.object({
  index: z.number().int().nonnegative(),
  instruction: z.string(),
  action: ActionSchema,
  snapshot: StepSnapshotSchema,
  durationMs: z.number().nonnegative(),
});

export const FindingClassSchema = z.enum([
  "hard_failure",
  "unclaimed_delta",
  "assertion_violation",
  "explorer_report",
]);

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

export const RawFindingSchema = z.object({
  class: FindingClassSchema,
  severity: SeveritySchema,
  signature: z.string().min(1),
  summary: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
  evidence: z.array(z.string()),
});

export const AssignmentResultSchema = z.object({
  assignmentId: z.string(),
  sessionId: z.string(),
  steps: z.array(AssignmentStepResultSchema),
  findings: z.array(RawFindingSchema),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
});

/**
 * Differential execution.
 *
 * Two sessions run the *same* recorded Actions — one against the preview
 * deployment, one against the base — and every observable is compared after
 * each step. A difference falls into exactly one of four buckets, and which
 * bucket decides whether it is a regression:
 *
 *   match     identical, or within tolerance. Ignored.
 *   claimed   differs, and the diff said it would. Expected; shown as green.
 *   noise     timestamps, nonces, ids, ordering. Normalised away before
 *             comparison, never reported.
 *   unclaimed differs, and nothing in the diff predicted it. This is a
 *             regression, by construction.
 *
 * The base branch is the oracle, so no statement of intent is required for
 * this to work — which is what makes it the stronger of the two oracles.
 */

export const DeltaClassificationSchema = z.enum(["match", "claimed", "noise", "unclaimed"]);

/** Which observable differed. Kept coarse so findings cluster sensibly. */
export const DeltaChannelSchema = z.enum([
  "url",
  "tree",
  "text",
  "network",
  "console",
  "status",
]);

export const SnapshotDeltaSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  channel: DeltaChannelSchema,
  /** What differed, in terms a person can read: a node path, a URL, a key. */
  field: z.string(),
  base: z.string(),
  preview: z.string(),
  classification: DeltaClassificationSchema,
  /**
   * Why it was classified that way. Every classification is auditable — a
   * comparator that cannot explain itself cannot be trusted or tuned.
   */
  reason: z.string(),
});

export const DifferentialResultSchema = z.object({
  assignmentId: z.string(),
  previewSessionId: z.string(),
  baseSessionId: z.string(),
  /** Every delta, including the ones that were dismissed. */
  deltas: z.array(SnapshotDeltaSchema),
  /** How many raw differences were dropped as noise, for the run summary. */
  noiseFiltered: z.number().int().nonnegative(),
  findings: z.array(RawFindingSchema),
  /** The complete captured journey, usable by Critic and Curtain Call without planning. */
  recordedAssignment: AssignmentSchema.optional(),
  /** Both sides finished the complete requested journey. Old records omit this. */
  completed: z.boolean().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
});

export type DeltaChannel = z.infer<typeof DeltaChannelSchema>;
export type DeltaClassification = z.infer<typeof DeltaClassificationSchema>;
export type DifferentialResult = z.infer<typeof DifferentialResultSchema>;
export type SnapshotDelta = z.infer<typeof SnapshotDeltaSchema>;

const EventEnvelopeSchema = z.object({
  runId: z.string(),
  assignmentId: z.string(),
  timestamp: z.string().datetime(),
  /** Explicit attribution when preview and base steps interleave. */
  side: z.enum(["preview", "base", "fix"]).optional(),
});

const InferenceUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  reasoningTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  inferenceTimeMs: z.number().nonnegative(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  EventEnvelopeSchema.extend({
    type: z.literal("session.opened"),
    side: z.enum(["preview", "base", "fix"]),
    sessionId: z.string(),
    liveViewUrl: z.string().url().optional(),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("step.planned"),
    index: z.number().int().nonnegative(),
    instruction: z.string(),
    action: ActionSchema,
    actionId: z.string().optional(),
    cacheStatus: z.string(),
    usage: InferenceUsageSchema,
    durationMs: z.number().nonnegative(),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("step.executed"),
    index: z.number().int().nonnegative(),
    action: ActionSchema,
    actionId: z.string().optional(),
    usage: InferenceUsageSchema,
    durationMs: z.number().nonnegative(),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("step.captured"),
    index: z.number().int().nonnegative(),
    url: z.string().url(),
    screenshotId: z.string().optional(),
    network: NetworkSummarySchema,
    consoleErrors: z.array(ConsoleEntrySchema),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("step.compared"),
    index: z.number().int().nonnegative(),
    deltas: z.array(SnapshotDeltaSchema),
    noiseFiltered: z.number().int().nonnegative(),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("finding.raised"),
    finding: RawFindingSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("session.closed"),
    sessionId: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("session.failed"),
    sessionId: z.string().optional(),
    message: z.string(),
  }),
]);

export const AgentTraceEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  event: AgentEventSchema,
});

export const RunStatusSchema = z.enum(["running", "completed", "failed"]);
export const RunSummarySchema = z.object({
  runId: z.string().min(1),
  status: RunStatusSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assignmentCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});

export type Action = z.infer<typeof ActionSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type AssignmentResult = z.infer<typeof AssignmentResultSchema>;
export type AssignmentStepResult = z.infer<typeof AssignmentStepResultSchema>;
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;
export type NetworkRequest = z.infer<typeof NetworkRequestSchema>;
export type NetworkSummary = z.infer<typeof NetworkSummarySchema>;
export type RawFinding = z.infer<typeof RawFindingSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type StepSnapshot = z.infer<typeof StepSnapshotSchema>;

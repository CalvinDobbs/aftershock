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

export const NetworkSummarySchema = z.object({
  requestCount: z.number().int().nonnegative(),
  failedRequests: z.array(
    z.object({
      method: z.string(),
      url: z.string(),
      status: z.number().int().optional(),
      errorText: z.string().optional(),
    }),
  ),
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

const EventEnvelopeSchema = z.object({
  runId: z.string(),
  assignmentId: z.string(),
  timestamp: z.string().datetime(),
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
export type NetworkSummary = z.infer<typeof NetworkSummarySchema>;
export type RawFinding = z.infer<typeof RawFindingSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type StepSnapshot = z.infer<typeof StepSnapshotSchema>;

import { createHash } from "node:crypto";
import { normalise } from "@aftershock/browser";
import { Finding, type TestCharter } from "@aftershock/schema";
import type { Assignment, AssignmentResult, DifferentialResult, RawFinding } from "@aftershock/schema/browser";

export interface JudgeInput {
  runId: string;
  charter: TestCharter;
  conformance: AssignmentResult[];
  differential: DifferentialResult[];
  /** Resolved routes and setup steps, when available from the Director. */
  assignments?: Assignment[];
}

export interface Reproduction {
  findings: RawFinding[];
  /** Set only when the same failure was actually observed on base. */
  preExisting?: boolean;
}

export interface JudgeOptions {
  /** Replays captured Actions in fresh sessions; never asks a model to re-plan. */
  reproduce?: (input: {
    assignmentId: string;
    finding: RawFinding;
    attempt: number;
  }) => Promise<Reproduction>;
  threshold?: number;
}

const BASE = { hard_failure: 0.9, unclaimed_delta: 0.75, assertion_violation: 0.65 } as const;
const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1 } as const;
const signatureOf = (finding: RawFinding) => normalise(finding.signature);
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Collect, cluster, reproduce, score. GitHub writes belong to the Director. */
export async function judge(input: JudgeInput, options: JudgeOptions = {}): Promise<Finding[]> {
  const threshold = options.threshold ?? 0.7;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Critic threshold must be between 0 and 1");
  }
  const groups = new Map<string, { assignmentId: string; raw: RawFinding; route: string }[]>();
  for (const result of [...input.conformance, ...input.differential]) {
    if (result.findings.length === 0) continue;
    const assignment = input.assignments?.find((a) => a.id === result.assignmentId);
    const assertion = input.charter.assertions.find((a) => a.id === (assignment?.assertionId ?? result.assignmentId));
    const route = assignment?.route ?? assertion?.route;
    if (!route) throw new Error(`No route for finding assignment ${result.assignmentId}`);
    for (const raw of result.findings) {
      // Explorers must be promoted by a conformance/differential run first.
      if (raw.class === "explorer_report") continue;
      const key = `${route}\n${signatureOf(raw)}`;
      const group = groups.get(key) ?? [];
      group.push({ assignmentId: result.assignmentId, raw, route });
      groups.set(key, group);
    }
  }

  const findings: Finding[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => SEVERITY[b.raw.severity] - SEVERITY[a.raw.severity]);
    const { raw, route, assignmentId } = group[0]!;
    if (raw.class === "explorer_report") continue;
    const assignmentIds = [...new Set(group.map((item) => item.assignmentId))];
    const assignment = input.assignments?.find((a) => a.id === assignmentId);
    const assertion = input.charter.assertions.find((a) => a.id === (assignment?.assertionId ?? assignmentId));
    const result = input.conformance.find((r) => r.assignmentId === assignmentId);
    const differential = input.differential.find((r) => r.assignmentId === assignmentId);
    const sourceDeltas = differential?.deltas.filter((d) => d.stepIndex === raw.stepIndex && d.classification === "unclaimed") ?? [];
    let confidence: number = BASE[raw.class];
    const baseConfidence = confidence;
    const modifiers: Finding["modifiers"] = [];
    let reproCount = 1;
    let reproAttempts = 1;
    let veto: Finding["status"] | undefined;
    const adjust = (label: string, value: number) => {
      const next = round(Math.max(0, Math.min(1, value)));
      modifiers.push({ label, delta: round(next - confidence) });
      confidence = next;
    };
    const reproduce = async () => {
      if (!options.reproduce) {
        modifiers.push({ label: "Reproduction unavailable; needs review", delta: 0 });
        veto = "low_confidence";
        return;
      }
      try {
        const replay = await options.reproduce({ assignmentId, finding: raw, attempt: reproAttempts + 1 });
        reproAttempts += 1;
        if (replay.preExisting) {
          adjust("Same failure observed on base; not a regression", 0);
          veto = "pre_existing";
        } else if (replay.findings.some((f) => f.class === raw.class
          && signatureOf(f) === signatureOf(raw) && normalise(f.summary) === normalise(raw.summary))) {
          reproCount += 1;
          adjust(`Reproduced on attempt ${reproAttempts} (×1.15)`, confidence * 1.15);
        } else if (replay.findings.length === 0) {
          adjust("Did not reproduce (×0.30)", confidence * 0.3);
          veto = "flaky";
        } else {
          adjust("Different failure mode (×0.60); needs review", confidence * 0.6);
          veto = "low_confidence";
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown error";
        modifiers.push({ label: `Reproduction could not complete; needs review (${reason})`, delta: 0 });
        veto = "low_confidence";
      }
    };

    if (raw.class !== "hard_failure") await reproduce();
    if (veto !== "pre_existing") {
      if (assignmentIds.length > 1) {
        adjust("Independent assignments corroborate (+0.10 each, maximum +0.20)",
          confidence + Math.min(0.2, (assignmentIds.length - 1) * 0.1));
      }
      const surface = input.charter.surfaces.find((s) => s.route === route);
      if (surface && surface.confidence < 0.5) adjust("Low-confidence route (−0.15)", confidence - 0.15);
      if (!surface || surface.reason.startsWith("fallback")) {
        adjust("Route not traced to the diff (−0.20)", confidence - 0.2);
      }
      if (!veto && reproAttempts === 2 && confidence >= 0.55 && confidence < threshold && confidence <= 0.7) {
        await reproduce();
      }
    }
    const expected = raw.class === "assertion_violation"
      ? assertion?.statement ?? "The cited assertion holds"
      : sourceDeltas.map((d) => `${d.field}: ${d.base}`).join("; ") || "The journey completes without this failure";
    findings.push(Finding.parse({
      id: `finding-${createHash("sha256").update(`${input.runId}\n${key}`).digest("hex").slice(0, 16)}`,
      runId: input.runId, assignmentIds, class: raw.class,
      status: veto ?? (confidence >= threshold ? "confirmed" : "low_confidence"),
      severity: raw.severity, title: raw.summary, route, signature: signatureOf(raw),
      expected,
      expectedSource: raw.class === "assertion_violation"
        ? assertion?.derivedFrom ?? "Assertion source unavailable"
        : differential ? `Base session ${differential.baseSessionId}` : "Captured runtime failure",
      actual: raw.summary, baseConfidence, confidence, modifiers, reproCount, reproAttempts,
      repro: assignment?.journey.map((s) => s.instruction)
        ?? (result?.steps.length ? result.steps.map((s) => s.instruction) : assertion?.steps ?? []),
      evidence: [...new Set(group.flatMap((item) => item.raw.evidence))],
      ...(differential ? { deltas: sourceDeltas.map(({ field, base, preview, classification }) => ({ field, base, preview, classification })) } : {}),
      filed: false,
    }));
  }
  return findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.confidence - a.confidence || a.id.localeCompare(b.id));
}

/** Keep discarded findings visible; only the top three survivors reach GitHub. */
export function selectIssues(findings: Finding[], limit = 3): Finding[] {
  return findings.filter((f) => f.status === "confirmed" && !f.filed)
    .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(3, limit)));
}

import type { Finding, Issue } from "@aftershock/schema";

/** GitHub assigns number/url after filing; never invent a published Issue. */
export type IssueDraft = Pick<Issue, "runId" | "findingId" | "title" | "body" | "labels" | "fixChecklist">;

export async function authorIssue(finding: Finding): Promise<IssueDraft> {
  if (finding.status !== "confirmed") throw new Error("Only confirmed findings can become issues");
  const fixChecklist = [finding.expected, "The original journey still completes", "The base comparison introduces no new regression"];
  const body = [
    `## ${finding.title}`,
    `**Found by** Aftershock · run \`${finding.runId}\` · confidence ${finding.confidence.toFixed(2)} · severity ${finding.severity}`,
    "### What should happen", finding.expected,
    `> Source: ${finding.expectedSource}`,
    "### What actually happens", finding.actual,
    "### Reproduction",
    `Observed ${finding.reproCount} of ${finding.reproAttempts} completed attempts.`,
    finding.repro.map((step, i) => `${i + 1}. ${step}`).join("\n") || "See the captured runtime failure.",
    "### Evidence",
    ...(finding.evidence?.map((item) => `- ${item}`) ?? []),
    ...(finding.deltas?.map((d) => `- ${d.field}: base \`${d.base}\`, preview \`${d.preview}\``) ?? []),
    "### Confidence",
    `Base: ${finding.baseConfidence.toFixed(2)}`,
    ...finding.modifiers.map((m) => `- ${m.label}: ${m.delta >= 0 ? "+" : ""}${m.delta.toFixed(4)}`),
    "### Fix checklist",
    ...fixChecklist.map((item) => `- [ ] ${item}`),
  ].join("\n\n");
  return { runId: finding.runId, findingId: finding.id, title: finding.title, body,
    labels: ["aftershock", `severity:${finding.severity}`], fixChecklist };
}

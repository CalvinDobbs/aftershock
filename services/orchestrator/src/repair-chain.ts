import { Issue, type Finding, type RunDetail, type RunEvent, type Patch } from "@aftershock/schema";
import { diagnose } from "@aftershock/sleuth";
import { repair, publishPatch, type RepairLoopDeps, type PatchGitHub } from "@aftershock/understudy";
import { verify, type VerifyDeps } from "@aftershock/curtain-call";
import type { CommitIntent, CharterModel } from "@aftershock/scout";
import type { Assignment, AssignmentResult } from "@aftershock/schema/browser";
import type { IssueDraft } from "@aftershock/critic";

export interface RepairServices {
  github: PatchGitHub & { createIssue(input: { repo: string; title: string; body: string; labels?: string[] }): Promise<{ number: number; html_url: string }> };
  /** False keeps the patch and verification local; issues and previews still run. */
  publishRepairs?: boolean;
  model: CharterModel;
  codex: RepairLoopDeps["codex"];
  readDiff?: RepairLoopDeps["readDiff"];
  /** Must return an isolated checkout of intent.headSha, never the shared main checkout. */
  prepareCheckout(input: { intent: CommitIntent; runId: string; issue: Issue }): Promise<string>;
  /** Deploy this exact attempt and return its public URL before verification. */
  previewForPatch(input: { patch: Patch; workingDirectory: string; intent: CommitIntent }): Promise<string>;
  /** Required when the trigger supplies a commit SHA instead of a branch name. */
  baseBranch?: string;
  readFiles?: Parameters<typeof publishPatch>[1]["readFiles"];
}
export type RepairFields = Pick<RunDetail, "issues" | "diagnosis" | "patch" | "verification" | "pullRequest">;
export async function runRepairChain(input: { runId: string; intent: CommitIntent; baseBranch: string; baseUrl: string | null;
  findings: Finding[]; drafts: IssueDraft[]; failed: { assignment: Assignment; before: AssignmentResult }[];
  regressionSuite: Assignment[]; emit(event: RunEvent): Promise<void>; services?: RepairServices; browser: VerifyDeps }): Promise<RepairFields> {
  const state: RepairFields = { issues: [], diagnosis: null, patch: null, verification: null, pullRequest: null };
  const skip = async (stages: ("sleuth" | "understudy" | "curtain_call")[], note: string) => {
    for (const stage of stages) await input.emit({ type: "stage.skip", stage, note });
  };
  const services = input.services;
  if (!services || !input.drafts.length) {
    await skip(["sleuth", "understudy", "curtain_call"], input.drafts.length ? "Confirmed issue drafts retained; repair services are not configured." : "No confirmed issue to repair.");
    return state;
  }
  const baseBranch = services.baseBranch ?? input.baseBranch;
  if (/^[0-9a-f]{40}$/i.test(baseBranch)) {
    await skip(["sleuth", "understudy", "curtain_call"], "Repair target branch must be configured for a SHA-based trigger.");
    return state;
  }
  // File up to three; the room schema represents one repair, so repair the highest ranked issue.
  for (const draft of input.drafts.slice(0, 3)) {
    const filed = await services.github.createIssue({ repo: input.intent.repo, title: draft.title, body: draft.body, labels: draft.labels });
    const issue = Issue.parse({ ...draft, id: `issue-${filed.number}`, number: filed.number, url: filed.html_url });
    state.issues.push(issue);
    const finding = input.findings.find(f => f.id === draft.findingId);
    if (finding) finding.filed = true;
    await input.emit({ type: "issue.filed", issue });
  }
  const issue = state.issues[0]!;
  const finding = input.findings.find(f => f.id === issue.findingId)!;
  await input.emit({ type: "stage.start", stage: "sleuth" });
  state.diagnosis = await diagnose({ issue, intent: input.intent, route: finding.route,
    evidence: { network: finding.evidence ?? [] } }, { model: services.model });
  await input.emit({ type: "sleuth.complete", diagnosis: state.diagnosis });
  if (state.diagnosis.inconclusive) {
    await skip(["understudy", "curtain_call"], "Diagnosis is inconclusive; no justified patch target."); return state;
  }
  await input.emit({ type: "stage.start", stage: "understudy" });
  const workingDirectory = await services.prepareCheckout({ intent: input.intent, runId: input.runId, issue });
  const failed = input.failed.filter(f => finding.assignmentIds.includes(f.assignment.id));
  if (!failed.length) {
    await skip(["understudy", "curtain_call"], "No complete recorded failing journey is available for verification."); return state;
  }
  const outcome = await repair({ issue, diagnosis: state.diagnosis, intent: input.intent, workingDirectory, runId: input.runId }, {
    codex: services.codex, ...(services.readDiff ? { readDiff: services.readDiff } : {}),
    verify: async patch => {
      state.patch = patch;
      await input.emit({ type: "understudy.complete", patch });
      await input.emit({ type: "stage.start", stage: "curtain_call" });
      let verification;
      try {
        const fixUrl = await services.previewForPatch({ patch, workingDirectory, intent: input.intent });
        patch.previewUrl = fixUrl;
        verification = await verify({ patch, issue, failed, fixUrl, baseUrl: input.baseUrl,
          route: finding.route, runId: input.runId, regressionSuite: input.regressionSuite }, input.browser);
        // Missing baseline/suite is unverified, even though the legacy verifier skips that gate.
        if (!input.baseUrl || !input.regressionSuite.length) verification = { ...verification, regressionSuitePassed: false, passed: false };
      } catch {
        verification = { patchId: patch.id, rows: [], checklist: issue.fixChecklist.map(item => ({ item, passed: false })), regressionSuitePassed: false, passed: false };
      }
      state.verification = verification;
      await input.emit({ type: "curtaincall.complete", verification });
      if (!verification.passed && patch.attempt < 2) await input.emit({ type: "stage.start", stage: "understudy" });
      return verification;
    },
  });
  state.patch = outcome.patch;
  state.verification = outcome.verification;
  await input.emit({ type: "understudy.complete", patch: outcome.patch });
  if (!outcome.verification) await skip(["curtain_call"], outcome.patch.rejectedFor ?? "No valid patch was produced.");
  if (services.publishRepairs === false) return state;
  const published = await publishPatch({ outcome, issue, repo: input.intent.repo, baseBranch,
    headSha: input.intent.headSha, workingDirectory, runId: input.runId }, {
    github: services.github, ...(services.readFiles ? { readFiles: services.readFiles } : {}),
  });
  if (published.pullRequest) {
    state.pullRequest = published.pullRequest;
    await input.emit({ type: "pr.opened", pullRequest: published.pullRequest });
  }
  return state;
}

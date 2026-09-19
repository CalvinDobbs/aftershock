import type {
  Assignment,
  AssignmentResult,
  DifferentialResult,
} from "@aftershock/schema/browser";
import { RunDetail, type Commit, type Finding, type Run, type RunEvent, type Stage, type TestCharter } from "@aftershock/schema";
import { AssignmentFailedError, isReplayable, withRecordedActions } from "@aftershock/browser";
import { authorIssue, judge, selectIssues, type IssueDraft } from "@aftershock/critic";
import {
  GitHubClient,
  dispatchOrder,
  inferCharter,
  smokeCharter,
  mapRoutes,
  openAiModel,
  sessionBudget,
  toAssignments,
  type CharterModel,
  type CriticalJourney,
} from "@aftershock/scout";

import { runObservableAssignment } from "./assignment-runner.js";
import { runObservableDifferential } from "./differential-runner.js";
import type { RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";
import { runRepairChain, type RepairServices } from "./repair-chain.js";
import { gitIntent } from "./git-intent.js";
import { gradeConformance, cleanEvidence } from "./conformance.js";
import { githubSource, sourceRoutes, type SourceSnapshot } from "./source-routes.js";
import { initialRun, queuedAssignment, completedAssignment } from "./pipeline-projection.js";

/**
 * The Director, in the shape the PRD describes: one commit in, a fleet of
 * browsers out.
 *
 * Scout reads the diff and writes the charter, the charter becomes
 * assignments, and the assignments are dispatched against a semaphore.
 * Differential pairs go first because they hold two slots and are the most
 * valuable, and a pair is dispatched atomically or not at all — a half
 * dispatched pair is useless and wastes a slot.
 */

export interface CommitRunOptions {
  runId: string;
  repo: string;
  base: string;
  head: string;
  prNumber?: number;

  /** Deployment of the commit under test. */
  previewUrl: string;
  /** Deployment of the base branch. Null skips every differential pair. */
  baseUrl: string | null;

  criticalJourney?: CriticalJourney;
  fallbackRoutes?: string[];
  routeSamples?: Record<string, string>;
  /** Steps that put the app into the state a route needs. See toAssignments. */
  routeSetup?: Record<string, string[]>;
  maxConcurrent?: number;

  eventStream: RunEventStream;
  screenshotRepository: ScreenshotRepository;
  github?: GitHubClient;
  model?: CharterModel;
  repairServices?: RepairServices;
  sourceSnapshot?: (repo: string, ref: string) => Promise<SourceSnapshot>;
  /** Shauraya's API/persistence consumes these product events, separate from browser telemetry. */
  emitPipelineEvent?: (event: RunEvent) => void | Promise<void>;
  commitMetadata?: Pick<Commit, "author" | "branch">;
  /** API owner supplies its public evidence URL; default is the runtime path. */
  screenshotUrl?: (id: string) => string;
}

/**
 * Work that did not run.
 *
 * Coverage gaps are reported, never silent. `stage` matters as much as the
 * reason: an assertion dropped by the charter is a Scout problem, one dropped
 * at dispatch is a capacity problem, and one dropped at run time is a flaky
 * browser. They need different fixes, so they are distinguishable here.
 */
export interface SkippedWork {
  /** The assertion this came from. Assignments inherit the assertion's id. */
  id: string;
  stage: "charter" | "dispatch" | "run";
  reason: string;
}

export interface CommitRunOutcome {
  charter: TestCharter;
  assignments: Assignment[];
  conformance: AssignmentResult[];
  differential: DifferentialResult[];
  /** Anything that could not run, and why. The run degrades, it does not abort. */
  skipped: SkippedWork[];
  findings: Finding[];
  /** Unpublished: the Director's GitHub integration supplies real issue numbers/URLs. */
  issueDrafts: IssueDraft[];
  detail: RunDetail;
}

/** A differential holds two slots; everything else holds one. */
const cost = (assignment: Assignment) => (assignment.archetype === "differential" ? 2 : 1);

export async function runFromCommit(options: CommitRunOptions): Promise<CommitRunOutcome> {
  const run = initialRun(options);
  try {
    await options.emitPipelineEvent?.({ type: "run.snapshot", run: structuredClone(run) });
    return await executeCommitRun(options, run);
  } catch (error) {
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    for (const stage of run.stages) {
      if (stage.status === "running") { stage.status = "failed"; stage.finishedAt = run.finishedAt; }
    }
    await options.emitPipelineEvent?.({ type: "run.snapshot", run: structuredClone(run) });
    await options.emitPipelineEvent?.({ type: "run.failed",
      reason: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function executeCommitRun(options: CommitRunOptions, run: Run): Promise<CommitRunOutcome> {
  const {
    runId,
    previewUrl,
    baseUrl,
    eventStream,
    screenshotRepository,
    github = new GitHubClient({ ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}) }),
  } = options;

  const publish = async (event: RunEvent) => {
    const completed: Partial<Record<RunEvent["type"], Stage>> = {
      "scout.complete": "scout", "cast.complete": "cast", "critic.complete": "critic",
      "sleuth.complete": "sleuth", "understudy.complete": "understudy", "curtaincall.complete": "curtain_call",
    };
    const stageName = event.type === "stage.start" || event.type === "stage.skip" ? event.stage : completed[event.type];
    const stage = run.stages.find((s) => s.stage === stageName);
    if (stage) {
      const now = new Date().toISOString();
      stage.status = event.type === "stage.start" ? "running" : event.type === "stage.skip" ? "skipped" : "complete";
      if (event.type === "stage.start") stage.startedAt = now;
      else stage.finishedAt = now;
      if (event.type === "stage.skip") stage.note = event.note;
    }
    await options.emitPipelineEvent?.(structuredClone(event));
  };
  await publish({ type: "stage.start", stage: "scout" });

  const intent = await github.readIntent({
    repo: options.repo,
    base: options.base,
    head: options.head,
    ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}),
  }).catch(async error => {
    if (options.github) throw error;
    const read = await gitIntent(options.repo, options.base, options.head);
    return { ...read, ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}) };
  });
  run.commit = { ...run.commit, sha: intent.headSha, message: intent.messages.at(-1) ?? "No commit message",
    filesChanged: intent.files.length,
    additions: intent.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: intent.files.reduce((sum, file) => sum + file.deletions, 0),
    ...(intent.prTitle ? { prTitle: intent.prTitle } : {}) };
  await publish({ type: "run.snapshot", run });

  let surfaces = mapRoutes(intent.files, {
    ...(options.fallbackRoutes ? { fallbackRoutes: options.fallbackRoutes } : {}),
  });

  try {
    const load = options.sourceSnapshot ?? (!options.github ? githubSource : undefined);
    if (load) {
      const source = await load(options.repo, intent.headSha);
      intent.headSha = source.sha;
      run.commit.sha = source.sha;
      surfaces = sourceRoutes(intent, source.files, surfaces);
    }
  } catch { /* Preserve the honest fallback map when source is unavailable. */ }
  const charterInput = {
    runId,
    intent,
    surfaces,
    ...(options.criticalJourney ? { criticalJourney: options.criticalJourney } : {}),
  };

  // Constructing the model can throw on a missing key, which is outside
  // inferCharter's own fallback. Scout is allowed to fail — the differential
  // oracle needs no intent — so a missing OPENAI_API_KEY degrades the run
  // rather than aborting it.
  let charter: TestCharter;
  try {
    const model = options.model ?? openAiModel();
    charter = await inferCharter(charterInput, { model: { complete: input => model.complete({ ...input,
      user: input.user + "\nProject journey configuration (use these exact paths and sample values; setup is prepended automatically):\n" + JSON.stringify({ routeSamples: options.routeSamples, routeSetup: options.routeSetup, criticalJourney: options.criticalJourney }) }) } });
  } catch {
    charter = smokeCharter(charterInput);
  }
  run.riskScore = charter.riskScore;
  await publish({ type: "scout.complete", charter });
  await publish({ type: "stage.start", stage: "cast" });

  const { assignments, skipped } = toAssignments(charter, {
    runId,
    ...(options.routeSamples ? { routeSamples: options.routeSamples } : {}),
    ...(options.routeSetup ? { routeSetup: options.routeSetup } : {}),
  });
  const productAssignments = new Map(assignments.map((assignment) => [assignment.id, queuedAssignment(assignment)]));
  await publish({ type: "cast.dispatch", assignments: [...productAssignments.values()] });

  // Risk drives the fleet: a one-line CSS change does not deserve the same
  // number of browsers as a change to payment logic.
  // Explicit option wins, then the environment, then the risk-derived budget:
  // a one-line CSS change does not deserve the fleet a payment change gets.
  const configured = Number.parseInt(process.env.MAX_CONCURRENT ?? "", 10);
  const [maxConcurrent, budgetSource] =
    options.maxConcurrent !== undefined
      ? ([options.maxConcurrent, "the request"] as const)
      : Number.isInteger(configured) && configured > 0
        ? ([configured, "MAX_CONCURRENT"] as const)
        : ([sessionBudget(charter.riskScore), "the risk score"] as const);

  const conformance: AssignmentResult[] = [];
  const differential: DifferentialResult[] = [];
  const allSkipped: SkippedWork[] = skipped.map((s) => ({
    id: s.assertionId,
    stage: "charter" as const,
    reason: s.reason,
  }));

  const runOne = async (assignment: Assignment): Promise<void> => {
    if (assignment.archetype === "differential" && !baseUrl) {
      allSkipped.push({ id: assignment.id, stage: "dispatch", reason: "no base deployment to compare against" });
      return;
    }
    const product = productAssignments.get(assignment.id)!;
    product.status = "running";
    product.startedAt = new Date().toISOString();
    await publish({ type: "agent.update", assignment: product });
    let result: AssignmentResult | DifferentialResult | undefined;
    let failure: string | undefined;
    try {
    if (assignment.archetype === "differential") {
      result = await runObservableDifferential({
          assignment,
          previewUrl,
          baseUrl: baseUrl!,
          claims: charter.intent.claims,
          eventStream,
          screenshotRepository,
        });
      differential.push(result);
      return;
    }

    result = await runObservableAssignment({
        assignment,
        targetUrl: previewUrl,
        mode: "plan",
        side: "preview",
        eventStream,
        screenshotRepository,
      });
    if (assignment.archetype === "conformance") {
      const assertion = charter.assertions.find(a => a.id === assignment.assertionId);
      if (assertion) result = await gradeConformance(result, assignment, assertion, options.model ?? openAiModel());
    }
    conformance.push(result);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      if (error instanceof AssignmentFailedError) {
        result = error.result;
        const assertion = charter.assertions.find(a => a.id === assignment.assertionId);
        if (assertion && assignment.archetype === "conformance") {
          result = await gradeConformance(result, assignment, assertion, options.model ?? openAiModel());
          conformance.push(result);
        }
      }
      throw error;
    } finally {
      const projected = completedAssignment(assignment, await eventStream.history(runId), result, failure, options.screenshotUrl);
      productAssignments.set(assignment.id, projected);
      await publish({ type: "agent.update", assignment: projected });
    }
  };

  await dispatch(dispatchOrder(assignments), maxConcurrent, runOne, allSkipped, budgetSource);

  // Coverage gaps go on the event stream, not just into a return value the
  // HTTP caller never sees. A run that quietly tested less than it claimed is
  // worse than one that failed loudly.
  //
  // Run-stage skips are excluded: the harness already emitted `session.failed`
  // for those, and repeating them reads as two separate problems.
  for (const gap of allSkipped.filter((g) => g.stage !== "run")) {
    const assignment = productAssignments.get(gap.id);
    if (assignment) {
      assignment.status = "skipped";
      assignment.finishedAt = new Date().toISOString();
      assignment.trace.push({ seq: assignment.trace.length, at: assignment.finishedAt, content: gap.reason });
      await publish({ type: "agent.update", assignment });
    }
    await eventStream.publish({
      runId,
      assignmentId: gap.id,
      timestamp: new Date().toISOString(),
      type: "session.failed",
      message: `skipped at ${gap.stage}: ${gap.reason}`,
    });
  }
  await publish({ type: "cast.complete" });
  await publish({ type: "stage.start", stage: "critic" });
  const findings = await judge({ runId, charter, assignments, conformance, differential }, {
    reproduce: async ({ assignmentId, finding, attempt }) => {
      const original = assignments.find((a) => a.id === assignmentId);
      if (!original) throw new Error(`Missing assignment ${assignmentId}`);
      const pair = differential.find((r) => r.assignmentId === assignmentId);
      const captured = conformance.find((r) => r.assignmentId === assignmentId);
      const recorded = pair?.recordedAssignment ?? (captured ? withRecordedActions(original, captured) : null);
      if (!recorded || !isReplayable(recorded) || recorded.journey.length !== original.journey.length) {
        throw new Error(`No complete recorded journey for ${assignmentId}`);
      }
      const assignment = { ...recorded, id: `${assignmentId}-repro-${attempt}` };
      if (pair) {
        if (!baseUrl) throw new Error("Differential reproduction needs a base deployment");
        const replay = await runObservableDifferential({ assignment, previewUrl, baseUrl,
          claims: charter.intent.claims, eventStream, screenshotRepository });
        if (!replay.completed) throw new Error("Reproduction did not complete on both deployments");
        return { findings: replay.findings };
      }
      const assertion = charter.assertions.find(a => a.id === original.assertionId);
      if (!assertion) throw new Error("Missing cited assertion");
      const evaluate = async (url: string, side: "preview" | "base") => {
        let replay: AssignmentResult;
        try {
          replay = await runObservableAssignment({ assignment, targetUrl: url,
            mode: "replay", side, eventStream, screenshotRepository });
        } catch (error) {
          if (!(error instanceof AssignmentFailedError)) throw error;
          replay = error.result;
        }
        return gradeConformance(replay, assignment, assertion, options.model ?? openAiModel());
      };
      const replay = await evaluate(previewUrl, "preview");
      const quotes = finding.evidence.filter(e => /^step \d+: /.test(e)).map(e => e.replace(/^step \d+: /, ""));
      const same = (r: AssignmentResult) => r.evaluation?.status === "failed" && quotes.length > 0
        && quotes.every(q => r.steps.some(s => cleanEvidence(s.snapshot.formattedTree).includes(q)));
      const base = baseUrl ? await evaluate(baseUrl, "base") : undefined;
      if (replay.evaluation?.status === "inconclusive") throw new Error(`Replay grading inconclusive: ${replay.evaluation.reason}`);
      return { findings: same(replay) ? [finding] : replay.findings, preExisting: base ? same(base) : false };
    },
  });
  await publish({ type: "critic.complete", findings });
  const issueDrafts = await Promise.all(selectIssues(findings).map(authorIssue));
  const recordedFailures = assignments.flatMap(assignment => {
    const pair = differential.find(r => r.assignmentId === assignment.id);
    const captured = conformance.find(r => r.assignmentId === assignment.id);
    const before = pair?.previewResult ?? captured;
    const recorded = pair?.recordedAssignment ?? (captured ? withRecordedActions(assignment, captured) : null);
    return before && recorded && isReplayable(recorded) && recorded.journey.length === assignment.journey.length
      && before.findings.length ? [{ assignment: recorded, before }] : [];
  });
  const repairFields = await runRepairChain({ runId, intent, baseBranch: options.head, baseUrl, findings,
    drafts: issueDrafts, failed: recordedFailures,
    regressionSuite: differential.flatMap(d => d.recordedAssignment ? [d.recordedAssignment] : []),
    emit: publish, ...(options.repairServices ? { services: options.repairServices } : {}),
    browser: {
      screenshotUrlFor: result => {
        const id = result.steps.at(-1)?.screenshotId;
        return id ? (options.screenshotUrl?.(id) ?? `/api/evidence/screenshots/${id}`) : null;
      },
      runDifferential: async input => {
        const result = await runObservableDifferential({ ...input, claims: charter.intent.claims, eventStream, screenshotRepository });
        if (!result.completed) throw new Error("Verification comparison incomplete");
        return result;
      },
      runAssignment: async input => {
        // Checklist assertions reuse a captured failing journey to establish real state.
        const original = input.assignment.id.startsWith("check-")
          ? recordedFailures.find(f => f.assignment.route === input.assignment.route)?.assignment : input.assignment;
        if (!original) throw new Error("No recorded journey for the checklist");
        if (original.archetype === "differential") {
          if (!baseUrl) throw new Error("Verification requires a baseline");
          const pair = await runObservableDifferential({ assignment: { ...original, id: input.assignment.id },
            previewUrl: input.targetUrl, baseUrl, claims: charter.intent.claims, eventStream, screenshotRepository });
          if (!pair.completed || !pair.previewResult) throw new Error("Verification comparison incomplete");
          return { ...pair.previewResult, findings: pair.findings };
        }
        const assignment = { ...original, id: input.assignment.id };
        const result = await runObservableAssignment({ ...input, assignment, mode: "replay", eventStream, screenshotRepository });
        const assertion = charter.assertions.find(a => a.id === original.assertionId);
        if (!assertion) throw new Error("Missing verification assertion");
        const graded = await gradeConformance(result, assignment, assertion, options.model ?? openAiModel());
        if (graded.evaluation?.status === "inconclusive") throw new Error("Verification assertion inconclusive");
        return graded;
      },
    },
  });
  const incomplete = [...productAssignments.values()].filter((a) => a.status === "errored" || a.status === "skipped").length + skipped.length;
  if (incomplete || assignments.length === 0) {
    run.stages.find((s) => s.stage === "cast")!.note = `${incomplete} incomplete assignments; ${assignments.length} assignments planned. Coverage is partial.`;
  }
  run.status = findings.some((f) => f.status === "confirmed") || incomplete || assignments.length === 0 ? "complete" : "no_findings";
  run.finishedAt = new Date().toISOString();
  await publish({ type: "run.complete", run });
  const detail = RunDetail.parse({ run, charter, assignments: [...productAssignments.values()], findings,
    ...repairFields });
  return { charter, assignments, conformance, differential, skipped: allSkipped, findings, issueDrafts, detail };
}

/**
 * The semaphore.
 *
 * Assignments are started as slots free rather than all at once, so the fleet
 * size is a configuration value and never an assumption. An assignment that
 * could never fit is skipped with a reason instead of deadlocking the queue
 * behind it, which is what would happen to a differential pair on a plan that
 * only allows one concurrent session.
 */
export async function dispatch(
  queue: Assignment[],
  maxConcurrent: number,
  run: (assignment: Assignment) => Promise<void>,
  skipped: SkippedWork[],
  /** Named in skip reasons so a capacity problem points at its own cause. */
  budgetSource = "MAX_CONCURRENT",
): Promise<void> {
  const pending = [...queue];
  const inFlight = new Set<Promise<void>>();
  let free = Math.max(1, maxConcurrent);

  while (pending.length > 0 || inFlight.size > 0) {
    let started = false;

    while (pending.length > 0) {
      const next = pending[0]!;
      const need = cost(next);

      if (need > Math.max(1, maxConcurrent)) {
        pending.shift();
        skipped.push({
          id: next.id,
          stage: "dispatch",
          reason: `needs ${need} concurrent sessions, ${budgetSource} allows ${maxConcurrent}`,
        });
        continue;
      }

      if (need > free) break;

      pending.shift();
      free -= need;
      started = true;

      const task = run(next)
        .catch((error: unknown) => {
          // One agent dying is normal with several browsers in flight. The
          // run degrades rather than aborting.
          skipped.push({
            id: next.id,
            stage: "run",
            reason: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          free += need;
          inFlight.delete(task);
        });
      inFlight.add(task);
    }

    if (inFlight.size === 0 && !started && pending.length > 0) {
      // Nothing running and nothing startable would spin forever.
      for (const stuck of pending.splice(0)) {
        skipped.push({ id: stuck.id, stage: "dispatch", reason: "no slot ever became available" });
      }
      break;
    }

    if (inFlight.size > 0) await Promise.race(inFlight);
  }
}

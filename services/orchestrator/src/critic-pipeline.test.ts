import { afterEach, describe, expect, it, vi } from "vitest";
import { RunDetail, RunEvent, type RunEvent as PipelineEvent } from "@aftershock/schema";
import { DifferentialResultSchema } from "@aftershock/schema/browser";
import { GitHubClient } from "@aftershock/scout";
import { runFromCommit } from "./commit-run.js";
import { InMemoryEventRepository, RunEventStream } from "./event-stream.js";
import { runObservableDifferential } from "./differential-runner.js";

vi.mock("./differential-runner.js", () => ({ runObservableDifferential: vi.fn() }));
const raw = { class: "unclaimed_delta", severity: "high", signature: "cart::total", summary: "Cart total changed to $NaN", stepIndex: 0, evidence: ["base $84.00", "preview $NaN"] };
const events: PipelineEvent[] = [];

function setup() {
  events.length = 0;
  vi.spyOn(GitHubClient.prototype, "readIntent").mockResolvedValue({ repo: "demo/shop", baseSha: "base", headSha: "head", messages: ["Refactor cart"],
    files: [{ filename: "app/cart/page.tsx", status: "modified", additions: 1, deletions: 1, patch: "+ badFormat(total)" }] });
  vi.mocked(runObservableDifferential).mockImplementation(async ({ assignment }) => DifferentialResultSchema.parse({
    assignmentId: assignment.id, previewSessionId: "preview", baseSessionId: "base", completed: true,
    recordedAssignment: { ...assignment, journey: [{ instruction: "Open /cart", action: { method: "goto", selector: "", description: "Open /cart", arguments: ["/cart"] } }] },
    deltas: [{ stepIndex: 0, channel: "text", field: "Total", base: "$84.00", preview: "$NaN", classification: "unclaimed", reason: "not claimed" }],
    noiseFiltered: 0, findings: [raw], startedAt: "2026-09-19T10:00:00Z", finishedAt: "2026-09-19T10:00:01Z",
  }));
  return {
    runId: "run-test", repo: "demo/shop", base: "main", head: "feature",
    previewUrl: "https://preview.example", baseUrl: "https://base.example", maxConcurrent: 2,
    criticalJourney: { route: "/cart", description: "Open cart", steps: ["Open /cart"] },
    model: { complete: async () => ({ summary: "Refactor cart", claims: [], confidence: 0.9, assertions: [], blastRadius: ["cart"], riskScore: 0.5 }) },
    eventStream: new RunEventStream(new InMemoryEventRepository()),
    screenshotRepository: { put: async () => "shot", get: async () => null },
    emitPipelineEvent: (event: PipelineEvent) => { events.push(RunEvent.parse(event)); },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("Director and Critic integration", () => {
  it("finishes without false success when the base deployment is unavailable", async () => {
    const outcome = await runFromCommit({ ...setup(), baseUrl: null });
    expect(outcome.detail.assignments[0]?.status).toBe("skipped");
    expect(outcome.detail.run.status).toBe("complete");
    expect(outcome.detail.run.stages.find((s) => s.stage === "cast")?.note).toContain("partial");
    expect(events.at(-1)?.type).toBe("run.complete");
  });
  it("emits failure when GitHub fails before browser dispatch", async () => {
    const options = setup();
    vi.mocked(GitHubClient.prototype.readIntent).mockRejectedValueOnce(new Error("GitHub unavailable"));
    await expect(runFromCommit(options)).rejects.toThrow("GitHub unavailable");
    expect(events.at(-1)).toEqual({ type: "run.failed", reason: "GitHub unavailable" });
  });

  it("replays captured actions and emits a real critic completion with an issue draft", async () => {
    const outcome = await runFromCommit(setup());
    expect(vi.mocked(runObservableDifferential)).toHaveBeenCalledTimes(2);
    const replay = vi.mocked(runObservableDifferential).mock.calls[1]![0];
    expect(replay.assignment.id).toBe("D1-repro-2");
    expect(replay.assignment.journey[0]?.action?.method).toBe("goto");
    expect(outcome.findings[0]).toMatchObject({ status: "confirmed", confidence: 0.8625, reproCount: 2, filed: false });
    expect(outcome.issueDrafts).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["run.snapshot", "stage.start", "run.snapshot", "scout.complete", "stage.start", "cast.dispatch", "agent.update", "agent.update", "cast.complete", "stage.start", "critic.complete", "stage.skip", "stage.skip", "stage.skip", "run.complete"]);
    expect(RunDetail.safeParse(outcome.detail).success).toBe(true);
    expect(outcome.detail.assignments[0]?.status).toBe("failed");
    expect(outcome.detail.run.stages.filter((s) => s.status === "running")).toEqual([]);
    // Events delivered earlier must remain historical snapshots, not mutated objects.
    const dispatched = events.find((e) => e.type === "cast.dispatch");
    expect(dispatched?.type === "cast.dispatch" && dispatched.assignments[0]?.status).toBe("queued");
  });

  it("withholds an issue when the second run is clean", async () => {
    const options = setup();
    const first = vi.mocked(runObservableDifferential).getMockImplementation()!;
    vi.mocked(runObservableDifferential).mockImplementation(async (opts) => {
      const result = await first(opts);
      return opts.assignment.id.includes("repro") ? { ...result, findings: [] } : result;
    });
    const outcome = await runFromCommit(options);
    expect(outcome.findings[0]?.status).toBe("flaky");
    expect(outcome.issueDrafts).toEqual([]);
  });

  it("does not mistake a failed replay for a clean reproduction", async () => {
    const options = setup();
    const first = vi.mocked(runObservableDifferential).getMockImplementation()!;
    vi.mocked(runObservableDifferential).mockImplementation(async (opts) => {
      const result = await first(opts);
      return opts.assignment.id.includes("repro") ? { ...result, completed: false, findings: [] } : result;
    });
    const outcome = await runFromCommit(options);
    expect(outcome.findings[0]).toMatchObject({ status: "low_confidence", reproAttempts: 1 });
    expect(outcome.issueDrafts).toEqual([]);
  });

  it("does not re-plan when recorded actions are missing", async () => {
    const options = setup();
    const first = vi.mocked(runObservableDifferential).getMockImplementation()!;
    vi.mocked(runObservableDifferential).mockImplementation(async (opts) => {
      const { recordedAssignment: _recorded, ...result } = await first(opts);
      return result;
    });
    const outcome = await runFromCommit(options);
    expect(vi.mocked(runObservableDifferential)).toHaveBeenCalledTimes(1);
    expect(outcome.findings[0]?.status).toBe("low_confidence");
    expect(outcome.issueDrafts).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { Finding, type TestCharter } from "@aftershock/schema";
import { AssignmentResultSchema, DifferentialResultSchema, type RawFinding } from "@aftershock/schema/browser";
import { judge, selectIssues, type JudgeInput } from "./judge.js";
import { authorIssue } from "./author-issue.js";

const charter: TestCharter = {
  runId: "run-test", intent: { summary: "Coupon", claims: [], confidence: 0.9 },
  surfaces: [{ route: "/checkout", confidence: 0.95, reason: "direct: app/checkout/page.tsx" }],
  assertions: [{ id: "A1", type: "conformance", route: "/checkout", statement: "SAVE20 reduces $84.00 to $67.20",
    derivedFrom: "PR #142 and useCartTotal.ts:12", severity: "high", steps: ["Open /checkout", "Apply SAVE20"] }],
  blastRadius: ["checkout"], riskScore: 0.8,
};
const raw: RawFinding = { class: "assertion_violation", severity: "high", signature: "coupon::total", summary: "Coupon leaves total at $84.00", stepIndex: 1, evidence: ["before $84.00", "after $84.00"] };
const result = (findings = [raw], assignmentId = "A1") => AssignmentResultSchema.parse({ assignmentId, sessionId: "session-test", steps: [], findings,
  startedAt: "2026-09-19T10:00:00Z", finishedAt: "2026-09-19T10:00:01Z" });
const input = (findings = [raw]): JudgeInput => ({ runId: charter.runId, charter: structuredClone(charter), conformance: [result(findings)], differential: [] });

describe("Critic", () => {
  it("confirms a reproduced assertion with auditable arithmetic and source", async () => {
    const reproduce = vi.fn(async () => ({ findings: [raw] }));
    const [finding] = await judge(input(), { reproduce });
    expect(finding).toMatchObject({ status: "confirmed", baseConfidence: 0.65, confidence: 0.7475,
      reproCount: 2, reproAttempts: 2, filed: false, expectedSource: "PR #142 and useCartTotal.ts:12" });
    expect(reproduce).toHaveBeenCalledWith({ assignmentId: "A1", finding: raw, attempt: 2 });
    expect(Finding.safeParse(finding).success).toBe(true);
  });

  it("keeps flakes out even with independent corroboration", async () => {
    const data = input();
    data.charter.assertions.push({ ...charter.assertions[0]!, id: "A2" });
    data.conformance.push(result([raw], "A2"));
    const [finding] = await judge(data, { reproduce: async () => ({ findings: [] }) });
    expect(finding?.status).toBe("flaky");
    expect(finding?.reproCount).toBe(1);
    expect(selectIssues([finding!])).toEqual([]);
  });

  it("kills a failure also observed on base", async () => {
    const [finding] = await judge(input(), { reproduce: async () => ({ findings: [raw], preExisting: true }) });
    expect(finding).toMatchObject({ status: "pre_existing", confidence: 0 });
  });

  it("requires review when reproduction finds a different failure", async () => {
    const [finding] = await judge(input(), { reproduce: async () => ({ findings: [{ ...raw, signature: "other" }] }) });
    expect(finding).toMatchObject({ status: "low_confidence", confidence: 0.39, reproCount: 1, reproAttempts: 2 });
  });

  it("does not corroborate a different wrong value just because the field signature matches", async () => {
    const [finding] = await judge(input(), { reproduce: async () => ({ findings: [{ ...raw, summary: "Coupon leaves total at $0.00" }] }) });
    expect(finding).toMatchObject({ status: "low_confidence", confidence: 0.39, reproCount: 1 });
  });

  it("does not count a crashed replay as a completed attempt or confirm it", async () => {
    const [finding] = await judge(input(), { reproduce: async () => { throw new Error("browser died"); } });
    expect(finding).toMatchObject({ status: "low_confidence", reproCount: 1, reproAttempts: 1 });
  });

  it("never confirms a differential just because reproduction was not configured", async () => {
    const [finding] = await judge(input([{ ...raw, class: "unclaimed_delta" }]));
    expect(finding).toMatchObject({ status: "low_confidence", confidence: 0.75 });
  });

  it("does not require reproduction of a hard failure", async () => {
    const reproduce = vi.fn();
    const [finding] = await judge(input([{ ...raw, class: "hard_failure" }]), { reproduce });
    expect(finding?.confidence).toBe(0.9);
    expect(finding?.status).toBe("confirmed");
    expect(reproduce).not.toHaveBeenCalled();
  });

  it("normalises signatures and counts each independent assignment only once", async () => {
    const data = input([raw, raw]);
    for (let n = 2; n <= 4; n++) {
      data.charter.assertions.push({ ...charter.assertions[0]!, id: `A${n}` });
      data.conformance.push(result([raw], `A${n}`));
    }
    const findings = await judge(data, { reproduce: async () => ({ findings: [raw] }) });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.assignmentIds).toHaveLength(4);
    expect(findings[0]?.confidence).toBe(0.9475);
  });

  it("clusters volatile IDs but not different routes", async () => {
    const data = input([{ ...raw, signature: "error 2026-09-19T10:00:00Z" }, { ...raw, signature: "error 2026-09-19T10:01:00Z" }]);
    data.charter.assertions.push({ ...charter.assertions[0]!, id: "A2", route: "/cart" });
    data.conformance.push(result([raw], "A2"));
    const findings = await judge(data);
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => f.route))).toEqual(new Set(["/checkout", "/cart"]));
  });

  it("only runs a third confirmation in the borderline band", async () => {
    const data = input();
    data.charter.surfaces = [{ route: "/checkout", confidence: 0.4, reason: "direct: checkout" }];
    const reproduce = vi.fn(async () => ({ findings: [raw] }));
    const [finding] = await judge(data, { reproduce });
    expect(reproduce).toHaveBeenCalledTimes(2);
    expect(finding).toMatchObject({ reproCount: 3, reproAttempts: 3, confidence: 0.687125, status: "low_confidence" });
    expect(finding!.baseConfidence + finding!.modifiers.reduce((n, m) => n + m.delta, 0)).toBeCloseTo(finding!.confidence);
  });

  it("rejects explorer reports until promoted", async () => {
    expect(await judge(input([{ ...raw, class: "explorer_report" }]))).toEqual([]);
  });

  it("preserves resolved dynamic routes and setup steps", async () => {
    const data = input();
    data.assignments = [{ id: "A1", runId: data.runId, assertionId: "A1", archetype: "conformance", route: "/products/scarf",
      objective: "test", journey: [{ instruction: "Open /products/scarf" }, { instruction: "Add to cart" }] }];
    const [finding] = await judge(data);
    expect(finding?.route).toBe("/products/scarf");
    expect(finding?.repro).toEqual(["Open /products/scarf", "Add to cart"]);
  });

  it("uses actual base evidence for differential expectations", async () => {
    const data = input([]);
    data.differential = [DifferentialResultSchema.parse({ assignmentId: "A1", previewSessionId: "preview", baseSessionId: "base",
      startedAt: "2026-09-19T10:00:00Z", finishedAt: "2026-09-19T10:00:01Z", noiseFiltered: 0,
      findings: [{ ...raw, class: "unclaimed_delta" }],
      deltas: [{ stepIndex: 1, channel: "text", field: "Total", base: "$84.00", preview: "$8400", classification: "unclaimed", reason: "not claimed" }] })];
    const [finding] = await judge(data);
    expect(finding?.expected).toBe("Total: $84.00");
    expect(finding?.expectedSource).toBe("Base session base");
  });

  it("caps filing at three highest-severity confirmed issues", async () => {
    const findings = await judge(input(Array.from({ length: 5 }, (_, i) => ({ ...raw, class: "hard_failure", signature: `error-${i}`, severity: i === 4 ? "critical" : "low" }))));
    expect(selectIssues(findings)).toHaveLength(3);
    expect(selectIssues(findings, 100)).toHaveLength(3);
    expect(selectIssues(findings)[0]?.severity).toBe("critical");
  });

  it("returns no findings for a clean run", async () => {
    expect(await judge(input([]))).toEqual([]);
  });
});

describe("issue authoring", () => {
  it("returns a reviewable draft without inventing a GitHub issue number or URL", async () => {
    const [finding] = await judge(input(), { reproduce: async () => ({ findings: [raw] }) });
    const draft = await authorIssue(finding!);
    expect(draft.body).toContain("$67.20");
    expect(draft.body).toContain("PR #142 and useCartTotal.ts:12");
    expect(draft.body).toContain("2 of 2");
    expect(draft.body).toContain("Apply SAVE20");
    expect(draft).not.toHaveProperty("number");
    expect(draft).not.toHaveProperty("url");
  });

  it("refuses a low-confidence issue", async () => {
    const [finding] = await judge(input());
    await expect(authorIssue(finding!)).rejects.toThrow("confirmed");
  });
});

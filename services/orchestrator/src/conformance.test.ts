import { describe, expect, it } from "vitest";
import { gradeConformance } from "./conformance.js";
import { AssignmentSchema, AssignmentResultSchema } from "@aftershock/schema/browser";
const assignment = AssignmentSchema.parse({ id: "A1", runId: "r", archetype: "conformance", route: "/checkout", objective: "Discount total", journey: [{ instruction: "Apply SAVE20" }] });
const assertion = { statement: "SAVE20 reduces $84 to $67.20", severity: "high" as const, derivedFrom: "PR: coupons apply a percentage discount" };
const result = AssignmentResultSchema.parse({ assignmentId: "A1", sessionId: "s", steps: [{ index: 0, instruction: "Apply SAVE20", action: { selector: "button", description: "Apply" }, snapshot: { url: "https://shop.test", formattedTree: 'Coupon applied SAVE20 Total $84.00', screenshot: new Uint8Array(), network: { requestCount: 0, failedRequests: [] }, console: [] }, durationMs: 1 }], findings: [], startedAt: new Date(0).toISOString(), finishedAt: new Date(10).toISOString() });
const model = (value: unknown) => ({ complete: async () => value });
describe("conformance evidence grading", () => {
 it("raises a sourced violation supported by captured values", async () => { const r = await gradeConformance(result, assignment, assertion, model({ status: "failed", reason: "84 x .8 = 67.2, but total stayed 84", evidence: [{ stepIndex: 0, lineIndex: 0 }, { stepIndex: 0, lineIndex: 0 }] })); expect(r.findings[0]?.class).toBe("assertion_violation"); expect(r.evaluation?.status).toBe("failed"); });
 it("rejects fabricated evidence instead of failing the product", async () => { const r = await gradeConformance(result, assignment, assertion, model({ status: "failed", reason: "wrong", evidence: [{ stepIndex: 0, lineIndex: 99 }] })); expect(r.evaluation?.status).toBe("inconclusive"); expect(r.findings).toEqual([]); });
 it("does not pass empty evidence or a model outage", async () => { for (const m of [model({ status: "passed", reason: "fine", evidence: [] }), { complete: async () => { throw Error("outage"); } }]) expect((await gradeConformance(result, assignment, assertion, m)).evaluation?.status).toBe("inconclusive"); });
 it("records a supported pass", async () => { expect((await gradeConformance(result, assignment, assertion, model({ status: "passed", reason: "observed", evidence: [{ stepIndex: 0, lineIndex: 0 }] }))).evaluation?.status).toBe("passed"); });
});

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorIssue, judge } from "@aftershock/critic";
import { AssignmentSchema } from "@aftershock/schema/browser";
import type { TestCharter } from "@aftershock/schema";
import { createObservabilityRuntime } from "./runtime.js";
import { resolveDataDirectory } from "./data-directory.js";

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
if (!browserbaseApiKey) throw new Error("BROWSERBASE_API_KEY is required");
const baseUrl = process.env.MERIDIAN_BASE_URL || "https://demo-site-hazel-beta.vercel.app";
const previewUrl = process.env.MERIDIAN_PREVIEW_URL || "https://demo-site-36dnpbk4c-doalnikhilgmailcoms-projects.vercel.app";
const runId = `meridian-smoke-${Date.now()}`;
const dataDirectory = resolveDataDirectory();
const runtime = createObservabilityRuntime({ browserbaseApiKey, dataDirectory });
const assignment = AssignmentSchema.parse({
  id: "D-cart", runId, archetype: "differential", route: "/cart", assertionId: "D-cart",
  objective: "The cart retains the baseline price when coupon support is added elsewhere",
  journey: [
    { instruction: "Open /products/wool-scarf?reset=1" },
    { instruction: "Click the Add to cart button" },
    { instruction: "Open /cart" },
  ],
});
const charter: TestCharter = {
  runId, intent: { summary: "Coupon feature at checkout", claims: [], confidence: 1 },
  surfaces: [{ route: "/cart", confidence: 0.95, reason: "import graph: cart uses changed lib/money.ts" }],
  assertions: [{ id: assignment.id, type: "differential", route: "/cart", journey: assignment.objective,
    steps: assignment.journey.map((s) => s.instruction), severity: "critical",
    rationale: "The unchanged cart must retain baseline prices" }],
  blastRadius: ["cart", "checkout"], riskScore: 0.8,
};

const clean = await runtime.runDifferential({ assignment: { ...assignment, id: "clean-cart" }, previewUrl: baseUrl, baseUrl });
assert.equal(clean.completed, true, "Clean baseline journey must finish on both sides");
assert.equal(clean.findings.length, 0, "Baseline compared with itself must be clean");
console.log(JSON.stringify({ phase: "baseline", runId, findings: clean.findings.length }));

const pair = await runtime.runDifferential({ assignment, previewUrl, baseUrl });
assert.equal(pair.completed, true, "Buggy comparison must finish on both sides");
assert.ok(pair.recordedAssignment, "Actions must be retained for reproduction");
assert.ok(pair.deltas.some((d) => d.base.includes("$84.00") && d.preview.includes("$NaN")), "Must observe the planted value regression");
const findings = await judge({ runId, charter, assignments: [assignment], conformance: [], differential: [pair] }, {
  reproduce: async ({ attempt }) => {
    const replay = await runtime.runDifferential({ assignment: { ...pair.recordedAssignment!, id: `D-cart-repro-${attempt}` }, previewUrl, baseUrl });
    assert.equal(replay.completed, true, "Reproduction must complete, not just return no findings");
    return { findings: replay.findings };
  },
});
const confirmed = findings.filter((f) => f.status === "confirmed");
assert.equal(confirmed.length, 1, "Only the planted price regression should be confirmed");
assert.ok(confirmed[0]!.actual.includes("$NaN") && confirmed[0]!.reproCount >= 2, "Critic must reproduce the planted regression");
const reportDirectory = join(dataDirectory, runId);
await mkdir(reportDirectory, { recursive: true });
await writeFile(join(reportDirectory, "findings.json"), JSON.stringify(findings, null, 2));
for (const finding of findings.filter((f) => f.status === "confirmed")) {
  const draft = await authorIssue(finding);
  await writeFile(join(reportDirectory, `${finding.id}.md`), draft.body);
}
console.log(JSON.stringify({ phase: "critic", runId, reportDirectory, findings: findings.map(({ title, confidence, status, reproCount, reproAttempts }) => ({ title, confidence, status, reproCount, reproAttempts })) }));

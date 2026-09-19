import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RunDetail, RunEvent } from "@aftershock/schema";
import { createObservabilityRuntime } from "./runtime.js";
import { resolveDataDirectory } from "./data-directory.js";
import type { CommitRunOutcome } from "./commit-run.js";

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
if (!browserbaseApiKey) throw new Error("BROWSERBASE_API_KEY is required");
const events: RunEvent[] = [];
let complete!: (outcome: CommitRunOutcome) => void;
let fail!: (reason: Error) => void;
const finished = new Promise<CommitRunOutcome>((resolve, reject) => { complete = resolve; fail = reject; });
const dataDirectory = resolveDataDirectory();
const runtime = createObservabilityRuntime({ browserbaseApiKey, dataDirectory,
  emitPipelineEvent: (_runId, event) => {
    events.push(RunEvent.parse(event));
    if (event.type === "stage.start" || event.type === "stage.skip") console.log(JSON.stringify(event));
    if (event.type === "run.failed") fail(new Error(event.reason));
  },
  onCommitRunComplete: (_runId, outcome) => complete(outcome),
});
await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
const address = runtime.server.address();
assert.ok(address && typeof address !== "string");
const timer = setTimeout(() => fail(new Error("Live Director test timed out after 6 minutes")), 360_000);
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/api/runs/from-commit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: "Nikhil-Doal/demo_site", base: "main", head: "feat/coupon-codes", prNumber: 2,
      previewUrl: process.env.MERIDIAN_PREVIEW_URL || "https://demo-site-36dnpbk4c-doalnikhilgmailcoms-projects.vercel.app",
      baseUrl: process.env.MERIDIAN_BASE_URL || "https://demo-site-hazel-beta.vercel.app",
      routeSamples: { slug: "wool-scarf" },
      fallbackRoutes: ["/cart", "/checkout"],
      routeSetup: { "/checkout": ["Open /products/wool-scarf?reset=1", "Click the Add to cart button", "Open /checkout"] },
      criticalJourney: { route: "/cart", description: "Add a scarf and inspect the cart subtotal without a coupon",
        steps: ["Open /products/wool-scarf?reset=1", "Click the Add to cart button", "Open /cart"] },
    }),
  });
  assert.equal(response.status, 202);
  const { run: { runId } } = await response.json() as { run: { runId: string } };
  assert.equal(typeof runId, "string");
  console.log(JSON.stringify({ runId, accepted: true }));
  const outcome = await finished;
  const detail = RunDetail.parse(outcome.detail);
  assert.equal(detail.run.id, runId);
  const stored = await fetch(`http://127.0.0.1:${address.port}/runs/${runId}`).then(r => r.json());
  assert.deepEqual(RunDetail.parse(stored), detail);
  const stream = await fetch(`http://127.0.0.1:${address.port}/api/runs/${runId}/events/stream`).then(r => r.text());
  assert.ok(stream.includes('"type":"critic.complete"'));
  assert.ok(stream.includes('"type":"run.complete"'));
  assert.equal(events[0]?.type, "run.snapshot");
  assert.equal(events.at(-1)?.type, "run.complete");
  assert.ok(events.some((e) => e.type === "cast.dispatch"));
  assert.ok(events.some((e) => e.type === "critic.complete"));
  assert.ok(detail.assignments.some((a) => a.steps.some((s) => s.screenshotUrl && s.baseScreenshotUrl)), "Real paired evidence must reach product assignments");
  assert.ok(outcome.differential.some((pair) => pair.completed && pair.deltas.some((d) => d.preview.includes("$NaN"))), "The live commit must observe the planted cart regression");
  assert.ok(detail.findings.some(f => f.class === "unclaimed_delta" && f.status === "confirmed" && f.actual.includes("$NaN")), "Cart regression must survive Critic");
  assert.ok(detail.findings.some(f => f.class === "assertion_violation" && f.status === "confirmed" && f.actual.includes("84.00")), "Coupon total violation must survive Critic");
  const directory = join(dataDirectory, runId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "detail.json"), JSON.stringify(detail, null, 2));
  await writeFile(join(directory, "pipeline-events.json"), JSON.stringify(events, null, 2));
  console.log(JSON.stringify({ runId, directory, events: events.length,
    assignments: detail.assignments.map(({ id, status, steps }) => ({ id, status, steps: steps.length })),
    findings: detail.findings.map(({ title, status, confidence }) => ({ title, status, confidence })) }));
} finally {
  clearTimeout(timer);
  await new Promise<void>((resolve, reject) => runtime.server.close((error) => error ? reject(error) : resolve()));
}

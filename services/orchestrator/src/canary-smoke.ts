import assert from "node:assert/strict";
import { createObservabilityRuntime } from "./runtime.js";
import { resolveDataDirectory } from "./data-directory.js";
import { noiseCanary } from "./noise-canary.js";

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
if (!browserbaseApiKey) throw new Error("BROWSERBASE_API_KEY is required");
const runtime = createObservabilityRuntime({
  browserbaseApiKey,
  dataDirectory: resolveDataDirectory(),
});

for (let attempt = 1; attempt <= 3; attempt++) {
  const canary = noiseCanary(`canary-smoke-${Date.now()}-${attempt}`);
  const result = await runtime.runDifferential(canary);
  const history = await runtime.eventStream.history(canary.assignment.runId);
  // Empty findings alone also occurs when no browser managed to run.
  assert.equal(history.filter(({ event }) => event.type === "session.failed").length, 0);
  assert.equal(history.filter(({ event }) => event.type === "session.closed").length, 2);
  assert.ok(history.filter(({ event }) => event.type === "step.captured").length >= 2);
  assert.equal(result.findings.length, 0);
  console.log(JSON.stringify({ attempt, runId: canary.assignment.runId,
    findings: result.findings.length, noiseFiltered: result.noiseFiltered,
    previewSessionId: result.previewSessionId, baseSessionId: result.baseSessionId }));
}

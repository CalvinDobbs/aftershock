import { AssignmentSchema } from "@aftershock/schema/browser";

import { resolveDataDirectory } from "./data-directory.js";
import { createObservabilityRuntime } from "./runtime.js";

const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) throw new Error("BROWSERBASE_API_KEY is required");

const rawTimeout = process.env.AGENT_TIMEOUT_MS ?? "120000";
const timeoutMs = Number.parseInt(rawTimeout, 10);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error(`Invalid AGENT_TIMEOUT_MS: ${rawTimeout}`);
}

const runId = `observability-smoke-${Date.now()}`;
const assignmentId = "smoke-stagehand";
const dataDirectory = resolveDataDirectory(
  process.env.AFTERSHOCK_DATA_DIR ?? ".aftershock/smoke",
);

const runtime = createObservabilityRuntime({ dataDirectory, browserbaseApiKey: apiKey });
const controller = new AbortController();

let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let listening = false;
let timeout: ReturnType<typeof setTimeout> | undefined;

try {
  await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  listening = true;
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a port");
  const base = `http://127.0.0.1:${address.port}`;

  timeout = setTimeout(() => controller.abort(), timeoutMs);

  const sseResponse = await fetch(
    `${base}/api/runs/${encodeURIComponent(runId)}/events/stream`,
    { signal: controller.signal },
  );
  if (!sseResponse.ok || !sseResponse.body) {
    throw new Error(`SSE request failed with status ${sseResponse.status}`);
  }
  reader = sseResponse.body.getReader();

  const decoder = new TextDecoder();
  let buffer = "";
  let dataCount = 0;
  let sawClosed = false;
  const readFrames = (async () => {
    while (!sawClosed) {
      const { value, done } = await reader!.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        dataCount += 1;
        const trace = JSON.parse(dataLine.slice("data: ".length));
        if (trace.event?.runId === runId && trace.event?.type === "session.closed") {
          sawClosed = true;
        }
      }
    }
  })();

  const assignment = AssignmentSchema.parse({
    id: assignmentId,
    runId,
    archetype: "conformance",
    route: "/",
    objective: "Open the top story discussion",
    journey: [{ instruction: "Click the comments link for the top story" }],
  });

  const result = await runtime.runAssignment({
    assignment,
    targetUrl: "https://news.ycombinator.com",
    mode: "plan",
    side: "preview",
  });
  await readFrames;
  if (!sawClosed) throw new Error("SSE stream ended before session.closed");

  const historyResponse = await fetch(`${base}/api/runs/${encodeURIComponent(runId)}/events`);
  if (!historyResponse.ok) throw new Error(`history request failed: ${historyResponse.status}`);
  const { traces } = (await historyResponse.json()) as {
    traces: { event: { type: string; screenshotId?: string } }[];
  };
  if (traces.length !== dataCount) {
    throw new Error(`history count ${traces.length} does not match SSE data count ${dataCount}`);
  }

  const captured = traces.find((trace) => trace.event.type === "step.captured");
  const screenshotId = captured?.event?.screenshotId;
  if (typeof screenshotId !== "string") {
    throw new Error("step.captured did not include a screenshotId");
  }
  const screenshotUrl = `${base}/api/evidence/screenshots/${screenshotId}`;
  const screenshotResponse = await fetch(screenshotUrl);
  if (screenshotResponse.status !== 200) {
    throw new Error(`screenshot request failed: ${screenshotResponse.status}`);
  }
  if (screenshotResponse.headers.get("content-type") !== "image/png") {
    throw new Error("screenshot response had an unexpected content type");
  }
  const screenshotBody = await screenshotResponse.arrayBuffer();
  if (screenshotBody.byteLength === 0) throw new Error("screenshot response was empty");

  console.log(JSON.stringify({
    runId,
    assignmentId,
    traceCount: traces.length,
    screenshotUrl,
    sessionUrl: `https://www.browserbase.com/sessions/${result.sessionId}`,
    replayUrl: `${base}/api/sessions/${result.sessionId}/replay`,
  }));
} finally {
  if (timeout !== undefined) clearTimeout(timeout);
  controller.abort();
  if (reader) await reader.cancel().catch(() => undefined);
  if (listening) {
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
}

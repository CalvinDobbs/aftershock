import { createServer, type RequestListener, type Server } from "node:http";

import { z } from "zod";

import type { AgentTraceEvent } from "@aftershock/schema/browser";
import type { SessionReplayService } from "@aftershock/browser";

import type { RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

export interface DemoRun {
  runId: string;
  assignmentId: string;
}

export type DemoRunLauncher = () => DemoRun | undefined;

/**
 * The real trigger: one commit in, a run out.
 *
 * Both the webhook and the dashboard's manual control converge here rather
 * than each owning a pipeline, so the path that gets demoed is the path that
 * gets tested.
 */
export const CommitRunRequestSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo"),
  base: z.string().min(1),
  head: z.string().min(1),
  prNumber: z.number().int().positive().optional(),
  previewUrl: z.string().url(),
  /** Omit when base URL resolution failed; differential pairs are then skipped. */
  baseUrl: z.string().url().nullable().optional(),
  // Routes must be absolute or nothing can resolve them, and the run would
  // answer 202 then dispatch zero assignments.
  fallbackRoutes: z.array(z.string().startsWith("/", "routes must start with /")).optional(),
  routeSamples: z.record(z.string(), z.string()).optional(),
  criticalJourney: z
    .object({
      description: z.string().min(1),
      steps: z.array(z.string().min(1)).min(1),
      route: z.string().startsWith("/", "routes must start with /").optional(),
    })
    .optional(),
  maxConcurrent: z.number().int().positive().optional(),
});
export type CommitRunRequest = z.infer<typeof CommitRunRequestSchema>;

export type CommitRunLauncher = (request: CommitRunRequest) => { runId: string };

export interface ObservabilityApiOptions {
  eventStream: RunEventStream;
  replayService: SessionReplayService;
  screenshotRepository: ScreenshotRepository;
  demoRunLauncher?: DemoRunLauncher;
  /** Runs a deployment against itself; healthy means it finds nothing. */
  noiseCanaryLauncher?: DemoRunLauncher;
  /** Starts a real run from a commit. Absent until Scout is configured. */
  commitRunLauncher?: CommitRunLauncher;
}

/**
 * Reads a JSON body without letting a malformed one become a 5xx.
 *
 * Webhooks retry on 5xx, so answering 502 to unparseable JSON turns one bad
 * payload into an infinite loop. Returns a marker the caller turns into 400.
 */
const INVALID_JSON = Symbol("invalid-json");

async function readJson(req: Parameters<RequestListener>[0]): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return INVALID_JSON;
  }
}

function sendJson(res: Parameters<RequestListener>[1], status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res: Parameters<RequestListener>[1], error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
}

function writeTrace(res: Parameters<RequestListener>[1], trace: AgentTraceEvent): void {
  res.write(`id: ${trace.sequence}\nevent: ${trace.event.type}\ndata: ${JSON.stringify(trace)}\n\n`);
}

export function createObservabilityHandler(options: ObservabilityApiOptions): RequestListener {
  const {
    eventStream,
    replayService,
    screenshotRepository,
    demoRunLauncher,
    noiseCanaryLauncher,
    commitRunLauncher,
  } = options;

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const segments = url.pathname.split("/").filter((part) => part.length > 0).map(decodeURIComponent);

      if (req.method === "GET" && segments.length === 2 && segments[0] === "api" && segments[1] === "runs") {
        sendJson(res, 200, { runs: await eventStream.runs() });
        return;
      }

      if (
        req.method === "POST" &&
        segments.length === 3 &&
        segments[0] === "api" &&
        segments[1] === "demo" &&
        segments[2] === "runs"
      ) {
        if (!demoRunLauncher) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        const run = await demoRunLauncher();
        if (!run) {
          sendJson(res, 409, { error: "A demo run is already active" });
          return;
        }
        sendJson(res, 202, { run });
        return;
      }

      if (
        req.method === "POST" &&
        segments.length === 3 &&
        segments[0] === "api" &&
        segments[1] === "runs" &&
        segments[2] === "from-commit"
      ) {
        if (!commitRunLauncher) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        const body = await readJson(req);
        if (body === INVALID_JSON) {
          sendJson(res, 400, { error: "Invalid request", issues: ["body: not valid JSON"] });
          return;
        }
        const parsed = CommitRunRequestSchema.safeParse(body);
        if (!parsed.success) {
          // Say what was wrong. A 400 with no detail is a debugging session.
          sendJson(res, 400, {
            error: "Invalid request",
            issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
          });
          return;
        }
        // Accepted, not completed: a run takes minutes, so the caller follows
        // it on the event stream rather than holding a connection open.
        sendJson(res, 202, { run: commitRunLauncher(parsed.data) });
        return;
      }

      if (
        req.method === "POST" &&
        segments.length === 3 &&
        segments[0] === "api" &&
        segments[1] === "demo" &&
        segments[2] === "canary"
      ) {
        if (!noiseCanaryLauncher) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        const run = await noiseCanaryLauncher();
        if (!run) {
          sendJson(res, 409, { error: "A canary run is already active" });
          return;
        }
        sendJson(res, 202, { run });
        return;
      }

      if (
        req.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "runs" &&
        segments[3] === "events"
      ) {
        const traces = await eventStream.history(segments[2]!);
        sendJson(res, 200, { traces });
        return;
      }

      if (
        req.method === "GET" &&
        segments.length === 5 &&
        segments[0] === "api" &&
        segments[1] === "runs" &&
        segments[3] === "events" &&
        segments[4] === "stream"
      ) {
        const runId = segments[2]!;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write(": connected\n\n");

        let lastSent = -1;
        let historyDone = false;
        const buffered: AgentTraceEvent[] = [];
        const send = (trace: AgentTraceEvent) => {
          if (trace.sequence <= lastSent) return;
          lastSent = trace.sequence;
          writeTrace(res, trace);
        };
        const unsubscribe = eventStream.subscribe(runId, (trace) => {
          if (historyDone) send(trace);
          else buffered.push(trace);
        });
        res.on("close", unsubscribe);

        try {
          for (const trace of await eventStream.history(runId)) send(trace);
          for (const trace of buffered.sort((left, right) => left.sequence - right.sequence)) {
            send(trace);
          }
          historyDone = true;
        } catch (error) {
          unsubscribe();
          sendError(res, error);
        }
        return;
      }

      if (
        req.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "evidence" &&
        segments[2] === "screenshots"
      ) {
        const body = await screenshotRepository.get(segments[3]!);
        if (body === undefined) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "private, max-age=31536000, immutable",
        });
        res.end(body);
        return;
      }

      if (
        req.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "sessions" &&
        segments[3] === "replay"
      ) {
        sendJson(res, 200, await replayService.retrieve(segments[2]!));
        return;
      }

      if (
        req.method === "GET" &&
        segments.length === 6 &&
        segments[0] === "api" &&
        segments[1] === "sessions" &&
        segments[3] === "replay" &&
        segments[5] === "playlist"
      ) {
        const playlist = await replayService.retrievePlaylist(segments[2]!, segments[4]!);
        res.writeHead(200, {
          "content-type": playlist.contentType,
          "cache-control": "no-store",
        });
        res.end(playlist.body);
        return;
      }

      if (
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "sessions" &&
        segments[3] === "recording-downloads"
      ) {
        if (req.method === "POST") {
          const downloads = await replayService.requestDownloads(segments[2]!);
          sendJson(res, 202, { downloads });
          return;
        }
        if (req.method === "GET") {
          const downloads = await replayService.listDownloads(segments[2]!);
          sendJson(res, 200, { downloads });
          return;
        }
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function createObservabilityServer(options: ObservabilityApiOptions): Server {
  return createServer(createObservabilityHandler(options));
}

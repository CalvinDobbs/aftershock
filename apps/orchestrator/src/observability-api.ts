import { createServer, type RequestListener, type Server } from "node:http";

import type { AgentTraceEvent } from "@aftershock/schema";
import type { SessionReplayService } from "@aftershock/browser";

import type { RunEventStream } from "./event-stream.js";
import type { ScreenshotRepository } from "./screenshot-repository.js";

export interface DemoRun {
  runId: string;
  assignmentId: string;
}

export type DemoRunLauncher = () => DemoRun | undefined;

export interface ObservabilityApiOptions {
  eventStream: RunEventStream;
  replayService: SessionReplayService;
  screenshotRepository: ScreenshotRepository;
  demoRunLauncher?: DemoRunLauncher;
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
  const { eventStream, replayService, screenshotRepository, demoRunLauncher } = options;

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

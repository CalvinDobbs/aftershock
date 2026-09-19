import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunEvent } from "@aftershock/schema";
import type { PipelineJournal } from "./pipeline-journal.js";

export async function servePipeline(req: IncomingMessage, res: ServerResponse, journal: PipelineJournal): Promise<boolean> {
  if (req.method !== "GET") return false;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (path === "/runs") { json(200, await journal.summaries()); return true; }
  const detailMatch = path.match(/^\/(?:api\/)?runs\/([^/]+)(?:\/detail)?$/);
  if (detailMatch) { const detail = await journal.detail(decodeURIComponent(detailMatch[1]!)); json(detail ? 200 : 404, detail ?? { error: "Run not found" }); return true; }
  const streamMatch = path.match(/^\/(?:api\/)?runs\/([^/]+)\/events(?:\/stream)?$/);
  if (!streamMatch) return false;
  const id = decodeURIComponent(streamMatch[1]!);
  if (!(await journal.detail(id))) return false; // legacy demo/canary streams keep their browser vocabulary
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(": connected\n\n");
  let last = -1;
  let ready = false;
  const buffered: { event: RunEvent; index: number }[] = [];
  const send = (event: RunEvent, index: number) => {
    if (index <= last || res.destroyed) return;
    last = index;
    res.write(`id: ${index}\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === "run.complete" || event.type === "run.failed") res.end();
  };
  const unsubscribe = journal.subscribe(id, (event,index) => ready ? send(event,index) : buffered.push({event,index}));
  res.on("close", unsubscribe);
  try {
    const history = await journal.history(id);
    history.forEach(send);
    buffered.sort((a,b) => a.index-b.index).forEach(({event,index}) => send(event,index));
    ready = true;
  } catch { unsubscribe(); res.end(); }
  return true;
}

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { PipelineJournal } from "./pipeline-journal.js";
import { initialRun } from "./pipeline-projection.js";
import { servePipeline } from "./pipeline-http.js";
const run = initialRun({ runId: "r", repo: "o/r", head: "h", base: "b", baseUrl: "https://base.test", previewUrl: "https://preview.test" });
it("persists product events and serves room detail/SSE after restart", async () => {
 const dir = await mkdtemp(join(tmpdir(), "pipeline-"));
 const journal = new PipelineJournal(dir);
 await journal.publish("r", { type: "run.snapshot", run });
 await journal.publish("r", { type: "run.complete", run: { ...run, status: "no_findings", finishedAt: new Date().toISOString() } });
 const restored = new PipelineJournal(dir);
 const server = createServer(async (req,res) => { if (!await servePipeline(req,res,restored)) { res.statusCode=404; res.end(); } });
 await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
 const port = (server.address() as {port:number}).port;
 try {
  const detail = await fetch(`http://127.0.0.1:${port}/runs/r`).then(r=>r.json());
  expect(detail.run.status).toBe("no_findings");
  const stream = await fetch(`http://127.0.0.1:${port}/api/runs/r/events/stream`).then(r=>r.text());
  expect(stream).toContain('"type":"run.snapshot"'); expect(stream).toContain('"type":"run.complete"');
  expect(stream).not.toContain('"sequence"');
  expect((await restored.summaries())[0]?.verified).toBe(false);
 } finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
});
it("preserves dispatch history when callers mutate their objects", async () => {
 const journal = new PipelineJournal(await mkdtemp(join(tmpdir(), "pipeline-")));
 const copy = structuredClone(run); await journal.publish("r",{type:"run.snapshot",run:copy}); copy.status="failed";
 expect((await journal.detail("r"))?.run.status).toBe("running");
});

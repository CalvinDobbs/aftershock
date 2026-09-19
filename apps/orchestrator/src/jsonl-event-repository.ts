import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { AgentTraceEventSchema, type AgentTraceEvent } from "@aftershock/schema";

import type { EventRepository } from "./event-stream.js";

export class JsonlEventRepository implements EventRepository {
  constructor(private readonly rootDirectory: string) {}

  async append(trace: AgentTraceEvent): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await appendFile(this.pathFor(trace.event.runId), `${JSON.stringify(trace)}\n`, "utf8");
  }

  async list(runId: string): Promise<AgentTraceEvent[]> {
    let contents: string;
    try {
      contents = await readFile(this.pathFor(runId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return contents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => AgentTraceEventSchema.parse(JSON.parse(line)));
  }

  private pathFor(runId: string): string {
    const name = createHash("sha256").update(runId).digest("hex");
    return join(this.rootDirectory, `${name}.jsonl`);
  }
}

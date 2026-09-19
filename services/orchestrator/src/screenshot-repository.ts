import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ScreenshotCapture } from "@aftershock/browser";

export interface ScreenshotRepository {
  put(capture: ScreenshotCapture): Promise<string>;
  get(id: string): Promise<Uint8Array | undefined>;
}

export class FileScreenshotRepository implements ScreenshotRepository {
  constructor(private readonly rootDirectory: string) {}

  async put(capture: ScreenshotCapture): Promise<string> {
    const id = createHash("sha256")
      .update(JSON.stringify([capture.runId, capture.assignmentId, capture.index]))
      .update(capture.body)
      .digest("hex");
    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(this.pathFor(id), capture.body);
    return id;
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    if (!/^[a-f0-9]{64}$/.test(id)) return undefined;
    try {
      return Uint8Array.from(await readFile(this.pathFor(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private pathFor(id: string): string {
    return join(this.rootDirectory, `${id}.png`);
  }
}

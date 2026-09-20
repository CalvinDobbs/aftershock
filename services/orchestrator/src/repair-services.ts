import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubClient, openAiModel } from "@aftershock/scout";
import { codexRunner } from "@aftershock/understudy";
import type { RepairServices } from "./repair-chain.js";

/** Deployment is a project command; the Director only accepts its ready, public URL. */
export function parsePreviewCommand(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.length || !value.every(v => typeof v === "string" && v.length)) throw new Error("AFTERSHOCK_PREVIEW_COMMAND must be a nonempty JSON string array");
  return value;
}

/** Opt-in runtime wiring. Read-only demo runs work without publishing credentials. */
export function repairServicesFromEnv(env: NodeJS.ProcessEnv = process.env): RepairServices | undefined {
  if (!env.GITHUB_TOKEN || !env.AFTERSHOCK_PREVIEW_COMMAND) return undefined;
  const command = parsePreviewCommand(env.AFTERSHOCK_PREVIEW_COMMAND);
  const exec = promisify(execFile);
  return {
    publishRepairs: env.AFTERSHOCK_PUBLISH_REPAIRS !== "false",
    github: new GitHubClient({ token: env.GITHUB_TOKEN }),
    model: openAiModel({ ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}) }),
    codex: codexRunner({ ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}) }),
    ...(env.AFTERSHOCK_REPAIR_BASE_BRANCH ? { baseBranch: env.AFTERSHOCK_REPAIR_BASE_BRANCH } : {}),
    prepareCheckout: async ({ intent }) => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(intent.repo) || !/^[0-9a-f]{40}$/i.test(intent.headSha)) throw new Error("Repair requires a resolved commit SHA and repository");
      const directory = await mkdtemp(join(tmpdir(), "aftershock-repair-"));
      const git = (args: string[]) => exec("git", args, { cwd: directory, timeout: 120_000, env: { ...env, GIT_TERMINAL_PROMPT: "0" } });
      await git(["init", "--quiet"]);
      await git(["fetch", "--quiet", "--depth=1", "--", `https://github.com/${intent.repo}.git`, intent.headSha]);
      await git(["checkout", "--quiet", "-b", "codex/repair", "FETCH_HEAD"]);
      return directory;
    },
    previewForPatch: async ({ patch, workingDirectory, intent }) => {
      const { stdout } = await exec(command[0]!, command.slice(1), { cwd: workingDirectory, timeout: 600_000,
        maxBuffer: 4*1024*1024, env: { ...env, AFTERSHOCK_PATCH_BRANCH: patch.branch,
          AFTERSHOCK_PATCH_ATTEMPT: String(patch.attempt), AFTERSHOCK_SOURCE_SHA: intent.headSha } });
      const last = stdout.trim().split("\n").at(-1)?.trim();
      if (!last) throw new Error("Preview command returned no URL");
      const url = new URL(last);
      if (url.protocol !== "https:") throw new Error("Preview command must return a public HTTPS URL on its last line");
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Preview is not accessible (${response.status})`);
      return url.toString();
    },
  };
}

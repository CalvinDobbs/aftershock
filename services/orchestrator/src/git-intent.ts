import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommitIntent } from "@aftershock/scout";

/** Public Git fallback: real commit messages and merge-base diff, never fabricated PR text. */
export async function gitIntent(repo: string, base: string, head: string, repositoryUrl = `https://github.com/${repo}.git`): Promise<CommitIntent> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repository name");
  const directory = await mkdtemp(join(tmpdir(), "aftershock-intent-"));
  const exec = promisify(execFile);
  const git = async (args: string[]) => (await exec("git", args, { cwd: directory, timeout: 60_000, maxBuffer: 16*1024*1024 })).stdout;
  await git(["init", "--quiet"]);
  await git(["fetch", "--quiet", "--depth=100", "--", repositoryUrl, base]);
  const baseSha = (await git(["rev-parse", "FETCH_HEAD"])).trim();
  await git(["fetch", "--quiet", "--depth=100", "--", repositoryUrl, head]);
  const headSha = (await git(["rev-parse", "FETCH_HEAD"])).trim();
  const mergeBase = (await git(["merge-base", baseSha, headSha])).trim();
  const names = (await git(["diff", "--name-status", "--no-renames", "-z", mergeBase, headSha])).split("\0").filter(Boolean);
  const files: CommitIntent["files"] = [];
  if (names.length > 500) throw new Error("Diff exceeds bounded read");
  for (let i=0;i<names.length;i+=2) {
    const filename = names[i+1]!;
    const stats = (await git(["diff", "--numstat", mergeBase, headSha, "--", filename])).split("\t");
    const patch = await git(["diff", "--no-ext-diff", "--no-color", mergeBase, headSha, "--", filename]);
    files.push({ filename, status: ({ A:"added",D:"removed",M:"modified" } as Record<string,string>)[names[i]!] ?? "modified",
      additions: Number.parseInt(stats[0]!,10)||0, deletions: Number.parseInt(stats[1]!,10)||0, patch });
  }
  const messages = (await git(["log", "--format=%B%x00", `${mergeBase}..${headSha}`])).split("\0").map(s=>s.trim()).filter(Boolean);
  return { repo, baseSha, headSha, messages, files };
}

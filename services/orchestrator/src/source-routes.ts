import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posix } from "node:path";
import { mapRoutes, type CommitIntent } from "@aftershock/scout";
import type { Surface } from "@aftershock/schema";

export interface SourceSnapshot { sha: string; files: Record<string, string> }
/** Read-only snapshot, pinned to a resolved commit before reading any source. */
async function apiSource(repo: string, ref: string): Promise<SourceSnapshot> {
  const get = async (path: string) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    });
    if (!response.ok) throw new Error(`Source lookup failed (${response.status})`);
    return response.json();
  };
  const commit = await get(`commits/${encodeURIComponent(ref)}`) as { sha: string };
  const tree = await get(`git/trees/${commit.sha}?recursive=1`) as { truncated?: boolean; tree: { path: string; type: string }[] };
  if (tree.truncated) throw new Error("Repository tree is truncated; no import confidence claimed");
  const paths = tree.tree.filter(f => f.type === "blob" && (/\.[jt]sx?$/.test(f.path) || f.path === "tsconfig.json" || f.path === "jsconfig.json") && !/(^|\/)(node_modules|\.next|dist)\//.test(f.path)).map(f => f.path);
  if (paths.length > 250) throw new Error("Source map exceeds bounded scan; retain fallback confidence");
  const files: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += 6) await Promise.all(paths.slice(i, i + 6).map(async path => {
    const file = await get(`contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commit.sha}`) as { content?: string; encoding?: string };
    if (file.encoding === "base64" && file.content) files[path] = Buffer.from(file.content, "base64").toString("utf8");
  }));
  return { sha: commit.sha, files };
}

/** Literal relative imports only; unresolved aliases retain fallback confidence. */
export function sourceRoutes(intent: CommitIntent, files: Record<string, string>, initial: Surface[]): Surface[] {
  const reverse = new Map<string, string[]>();
  let aliases: Record<string, string[]> = {};
  let baseUrl = ".";
  try {
    const config = JSON.parse(files["tsconfig.json"] ?? files["jsconfig.json"] ?? "{}");
    aliases = config.compilerOptions?.paths ?? {};
    baseUrl = config.compilerOptions?.baseUrl ?? ".";
  } catch { /* Unparsed configuration never establishes an alias. */ }
  for (const [path, text] of Object.entries(files)) {
    // Strip comments so a commented-out import cannot establish provenance.
    const source = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?|\brequire\s*\()\s*["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      let stem: string;
      if (specifier.startsWith(".")) stem = posix.normalize(posix.join(posix.dirname(path), specifier));
      else {
        const alias = Object.entries(aliases).find(([key, values]) => values.length === 1 && key.endsWith("*") && specifier.startsWith(key.slice(0,-1)));
        if (!alias) continue;
        stem = posix.normalize(posix.join(baseUrl, alias[1][0]!.replace("*", specifier.slice(alias[0].length-1))));
      }
      const resolved = [stem, ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"].map(e => stem + e)].find(p => p in files);
      if (resolved) reverse.set(resolved, [...(reverse.get(resolved) ?? []), path]);
    }
  }
  const surfaces = new Map(initial.map(s => [s.route, s]));
  for (const changed of intent.files) {
    const queue = [[changed.filename]];
    const seen = new Set<string>();
    while (queue.length) {
      const chain = queue.shift()!;
      const path = chain.at(-1)!;
      if (seen.has(path)) continue;
      seen.add(path);
      if (chain.length > 1) for (const surface of mapRoutes([{ filename: path, status: "modified", additions: 0, deletions: 0 }])) {
        if ((surfaces.get(surface.route)?.confidence ?? 0) < 0.85) surfaces.set(surface.route, {
          route: surface.route, confidence: 0.85, reason: `imports: ${[...chain].reverse().join(" -> ")} (source at ${intent.headSha})`,
        });
      }
      for (const importer of reverse.get(path) ?? []) queue.push([...chain, importer]);
    }
  }
  return [...surfaces.values()].sort((a,b) => b.confidence-a.confidence);
}


/** Git transport remains available when the public REST API is rate limited. */
export async function githubSource(repo: string, ref: string): Promise<SourceSnapshot> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repository name");
  try { return await apiSource(repo, ref); } catch {
    const directory = await mkdtemp(join(tmpdir(), "aftershock-source-"));
    const exec = promisify(execFile);
    const git = async (args: string[]) => (await exec("git", args, { cwd: directory, timeout: 60_000, maxBuffer: 16*1024*1024 })).stdout;
    await git(["init", "--quiet"]);
    await git(["fetch", "--quiet", "--depth=1", "--", `https://github.com/${repo}.git`, ref]);
    const sha = (await git(["rev-parse", "FETCH_HEAD"])).trim();
    const paths = (await git(["ls-tree", "-r", "--name-only", sha])).split("\n")
      .filter(p => /\.[jt]sx?$/.test(p) || p === "tsconfig.json" || p === "jsconfig.json");
    if (paths.length > 250) throw new Error("Source map exceeds bounded scan");
    const files: Record<string,string> = {};
    for (const path of paths) files[path] = await git(["show", `${sha}:${path}`]);
    return { sha, files };
  }
}

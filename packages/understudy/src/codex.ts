import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * The Codex SDK, behind an interface.
 *
 * Codex is the repair engine inside the product, not just a tool used to build
 * it. That makes it a runtime dependency on a real coding agent that edits a
 * real working tree, which is exactly the thing a unit test must not do — so
 * everything below the interface is swappable, and the patch logic is testable
 * without spawning an agent or touching a repository.
 */

export interface CodexTurn {
  /** Whatever the agent said at the end. With an outputSchema, this is JSON. */
  finalResponse: string;
  /** Populated once the first turn starts. Persisted so a retry can resume. */
  threadId: string | null;
  /** Files the agent reported changing. A cross-check on the diff, not the source of truth. */
  changedFiles: string[];
}

export interface CodexSession {
  run(prompt: string, outputSchema?: unknown): Promise<CodexTurn>;
}

export interface CodexRunner {
  /** A fresh thread, or a resumed one when the first attempt left an id. */
  session(input: { workingDirectory: string; resumeThreadId?: string }): CodexSession;
}

export interface CodexRunnerOptions {
  apiKey?: string;
  model?: string;
  /** Codex must be able to edit the checkout, and nothing outside it. */
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
}

/**
 * The real runner.
 *
 * Two settings here are load-bearing in a headless worker and easy to get
 * wrong. `approvalPolicy: "never"` stops the agent waiting for a human that
 * is not there, which otherwise reads as a hang rather than an error. And
 * passing `apiKey` explicitly matters because Codex defaults to a ChatGPT
 * login that does not exist on a server.
 *
 * `sandboxMode: "workspace-write"` is the narrowest setting that still lets it
 * do the job: it must edit the checkout, and it must not touch anything else.
 */
export function codexRunner(options: CodexRunnerOptions = {}): CodexRunner {
  return {
    session(input) {
      // Imported lazily so that requiring this module — which the package
      // index does — never pulls in the Codex CLI on a run that has no repair
      // stage. The dependency is heavy and most runs never reach Understudy.
      const load = import("@openai/codex-sdk");

      let thread: Promise<{
        run(prompt: string, turnOptions?: { outputSchema?: unknown }): Promise<{
          finalResponse: string;
          items: { type: string; changes?: { path: string }[] }[];
        }>;
        readonly id: string | null;
      }> | null = null;

      const open = async () => {
        if (thread) return thread;
        thread = load.then(({ Codex }) => {
          const codex = new Codex({
            ...(options.apiKey ? { apiKey: options.apiKey } : {}),
          });
          const threadOptions = {
            workingDirectory: input.workingDirectory,
            sandboxMode: options.sandboxMode ?? ("workspace-write" as const),
            approvalPolicy: "never" as const,
            ...(options.model ? { model: options.model } : {}),
          };
          return input.resumeThreadId
            ? codex.resumeThread(input.resumeThreadId, threadOptions)
            : codex.startThread(threadOptions);
        });
        return thread;
      };

      return {
        async run(prompt, outputSchema) {
          const active = await open();
          const turn = await active.run(
            prompt,
            outputSchema ? { outputSchema } : undefined,
          );
          const changedFiles = turn.items
            .filter((item) => item.type === "file_change")
            .flatMap((item) => item.changes?.map((change) => change.path) ?? []);
          return { finalResponse: turn.finalResponse, threadId: active.id, changedFiles };
        },
      };
    },
  };
}

const run = promisify(execFile);

export type DiffReader = (workingDirectory: string) => Promise<string>;

/**
 * The patch, read from git rather than from the agent.
 *
 * Asking a model to emit a unified diff means the diff has to apply, and
 * sometimes it does not — a hallucinated context line fails at `git apply`
 * after the work is already done. Letting the agent edit files and then asking
 * git what changed means the patch is real by construction.
 *
 * `--no-color` and `--no-ext-diff` keep the output parseable on a developer
 * machine whose global gitconfig sets a colour or an external diff driver.
 * Both are `git diff` options, so they must follow the `diff` subcommand.
 */
export const gitDiff: DiffReader = async (workingDirectory) => {
  const { stdout } = await run(
    "git",
    ["-c", "core.pager=cat", "diff", "--no-ext-diff", "--no-color", "--"],
    { cwd: workingDirectory, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
};

/** Files as they read after the agent's edits, for the commit. */
export const readChangedFiles = async (
  workingDirectory: string,
  paths: readonly string[],
): Promise<{ path: string; content: string }[]> => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(join(workingDirectory, path), "utf8"),
    })),
  );
};

import { z } from "zod";

/**
 * The read half of the GitHub integration.
 *
 * Scout needs four things from a commit and they all come from one compare
 * call: the diff, the messages the author wrote, the files they touched, and
 * (when there is one) the PR body, which is usually a richer statement of
 * intent than the commit message.
 *
 * A token is optional. Public repos work unauthenticated, which is enough to
 * build and test Scout before the GitHub App exists; the App swaps in here and
 * nothing downstream changes.
 */

export const ChangedFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** Absent on binary files and on very large diffs. */
  patch: z.string().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const CommitIntentSchema = z.object({
  repo: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  messages: z.array(z.string()),
  files: z.array(ChangedFileSchema),
  prNumber: z.number().int().optional(),
  prTitle: z.string().optional(),
  prBody: z.string().optional(),
});
export type CommitIntent = z.infer<typeof CommitIntentSchema>;

const CompareResponseSchema = z.object({
  commits: z.array(z.object({ commit: z.object({ message: z.string() }) })),
  files: z.array(ChangedFileSchema).optional(),
});

const PullResponseSchema = z.object({
  title: z.string(),
  body: z.string().nullable(),
});

export interface GitHubClientOptions {
  token?: string;
  /** Overridable for GitHub Enterprise and for tests. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GitHubClient {
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitHubClientOptions = {}) {
    if (options.token) this.token = options.token;
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub ${path} failed with ${response.status}`);
    }
    return schema.parse(await response.json());
  }

  /**
   * Everything Scout reads, in as few calls as possible. The PR lookup is
   * best-effort: a bare push has no PR, and that only weakens the intent
   * oracle rather than stopping the run.
   */
  async readIntent(input: {
    repo: string;
    base: string;
    head: string;
    prNumber?: number;
  }): Promise<CommitIntent> {
    const compare = await this.get(
      `/repos/${input.repo}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}`,
      CompareResponseSchema,
    );

    let pr: { title: string; body: string | null } | undefined;
    if (input.prNumber !== undefined) {
      pr = await this
        .get(`/repos/${input.repo}/pulls/${input.prNumber}`, PullResponseSchema)
        .catch(() => undefined);
    }

    return CommitIntentSchema.parse({
      repo: input.repo,
      baseSha: input.base,
      headSha: input.head,
      messages: compare.commits.map((c) => c.commit.message),
      files: compare.files ?? [],
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
      ...(pr?.title ? { prTitle: pr.title } : {}),
      ...(pr?.body ? { prBody: pr.body } : {}),
    });
  }
}

/**
 * The diff, trimmed to fit a prompt.
 *
 * Patches are truncated per file rather than the whole diff being cut off at
 * a byte count, so a commit touching twenty files still shows something from
 * the twentieth. Scout reasons about intent, and intent is visible in the
 * shape of a change long before the last line of it.
 */
export function renderDiff(files: readonly ChangedFile[], maxPerFile = 4000): string {
  return files
    .map((file) => {
      const header = `--- ${file.filename} (${file.status}, +${file.additions} -${file.deletions})`;
      if (!file.patch) return `${header}\n[no textual patch]`;
      const patch =
        file.patch.length > maxPerFile
          ? `${file.patch.slice(0, maxPerFile)}\n[...truncated]`
          : file.patch;
      return `${header}\n${patch}`;
    })
    .join("\n\n");
}

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

const RefSchema = z.object({ object: z.object({ sha: z.string() }) });
const CommitSchema = z.object({ tree: z.object({ sha: z.string() }) });
const ShaSchema = z.object({ sha: z.string() });

export const FiledIssueSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
});
export type FiledIssue = z.infer<typeof FiledIssueSchema>;

export const OpenedPullRequestSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
});
export type OpenedPullRequest = z.infer<typeof OpenedPullRequestSchema>;

/** One file as it should read after the commit. Content is written whole. */
export interface FileEdit {
  path: string;
  content: string;
}

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

  private headers(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`GitHub ${path} failed with ${response.status}`);
    }
    return schema.parse(await response.json());
  }

  /**
   * The write half.
   *
   * Every write needs a token — unlike the reads, which work unauthenticated
   * on a public repo. Failing here with a clear message beats a 401 from the
   * API after the work of building the request, because the usual cause is a
   * missing GitHub App installation rather than anything about the request.
   */
  private async write<T>(
    method: "POST" | "PATCH" | "PUT",
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.token) {
      throw new Error(`GitHub ${path} needs a token: writes are never anonymous`);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The body carries GitHub's own reason — "Reference already exists",
      // "Validation Failed" — and losing it turns a five-second fix into a
      // debugging session.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `GitHub ${method} ${path} failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
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

  /** The Critic's output, and the only thing in this system a human is asked to read. */
  async createIssue(input: {
    repo: string;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<FiledIssue> {
    return this.write(
      "POST",
      `/repos/${input.repo}/issues`,
      { title: input.title, body: input.body, labels: input.labels ?? [] },
      FiledIssueSchema,
    );
  }

  /** Where the head commit lives. Used to branch from it and to commit onto it. */
  async headSha(input: { repo: string; branch: string }): Promise<string> {
    const ref = await this.get(
      `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`,
      RefSchema,
    );
    return ref.object.sha;
  }

  async createBranch(input: { repo: string; from: string; name: string }): Promise<string> {
    const sha = await this.headSha({ repo: input.repo, branch: input.from });
    await this.write(
      "POST",
      `/repos/${input.repo}/git/refs`,
      { ref: `refs/heads/${input.name}`, sha },
      z.unknown(),
    );
    return sha;
  }

  /**
   * One commit carrying every edited file.
   *
   * The Contents API would be two calls instead of five, but it commits once
   * per file — so a patch touching three files would land as three commits,
   * two of which do not build. A reviewable patch is one commit, so this goes
   * through the git data API: blobs, a tree on top of the current one, a
   * commit, then move the ref.
   */
  async commitFiles(input: {
    repo: string;
    branch: string;
    message: string;
    files: readonly FileEdit[];
  }): Promise<string> {
    if (input.files.length === 0) throw new Error("commitFiles needs at least one file");

    const parent = await this.headSha({ repo: input.repo, branch: input.branch });
    const parentCommit = await this.get(
      `/repos/${input.repo}/git/commits/${parent}`,
      CommitSchema,
    );

    const tree = await this.write(
      "POST",
      `/repos/${input.repo}/git/trees`,
      {
        base_tree: parentCommit.tree.sha,
        tree: input.files.map((file) => ({
          path: file.path,
          mode: "100644",
          type: "blob",
          content: file.content,
        })),
      },
      ShaSchema,
    );

    const commit = await this.write(
      "POST",
      `/repos/${input.repo}/git/commits`,
      { message: input.message, tree: tree.sha, parents: [parent] },
      ShaSchema,
    );

    await this.write(
      "PATCH",
      `/repos/${input.repo}/git/refs/heads/${encodeURIComponent(input.branch)}`,
      { sha: commit.sha },
      z.unknown(),
    );

    return commit.sha;
  }

  /**
   * Labels go on in a second call.
   *
   * The create-PR endpoint silently ignores a `labels` field — it is an issues
   * field — so a PR created with labels inline comes back unlabelled and the
   * `aftershock:unverified` marker, which is the one label that must never be
   * missing, would be lost without an error.
   */
  async openPullRequest(input: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    labels?: string[];
    draft?: boolean;
  }): Promise<OpenedPullRequest> {
    const pr = await this.write(
      "POST",
      `/repos/${input.repo}/pulls`,
      {
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
        draft: input.draft ?? false,
      },
      OpenedPullRequestSchema,
    );

    if (input.labels?.length) {
      await this.write(
        "POST",
        `/repos/${input.repo}/issues/${pr.number}/labels`,
        { labels: input.labels },
        z.unknown(),
      );
    }

    return pr;
  }

  /** Aftershock's own verification result, posted where a reviewer already looks. */
  async setCommitStatus(input: {
    repo: string;
    sha: string;
    state: "success" | "failure" | "pending" | "error";
    description: string;
    targetUrl?: string;
  }): Promise<void> {
    await this.write(
      "POST",
      `/repos/${input.repo}/statuses/${input.sha}`,
      {
        state: input.state,
        description: input.description.slice(0, 140),
        context: "aftershock/verification",
        ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
      },
      z.unknown(),
    );
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

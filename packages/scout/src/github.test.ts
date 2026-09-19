import { describe, expect, it, vi } from "vitest";

import { GitHubClient, renderDiff } from "./github.js";

function fakeFetch(routes: Record<string, unknown>, status = 200) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const body = routes[path];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const compare = {
  commits: [{ commit: { message: "feat: coupon codes at checkout" } }],
  files: [
    { filename: "app/checkout/page.tsx", status: "modified", additions: 40, deletions: 2, patch: "@@ +1 @@" },
  ],
};

describe("GitHubClient", () => {
  it("reads the diff, the messages and the PR body in one go", async () => {
    const client = new GitHubClient({
      fetchImpl: fakeFetch({
        "/repos/o/r/compare/base...head": compare,
        "/repos/o/r/pulls/142": { title: "Coupon codes", body: "Applies a discount." },
      }),
    });

    const intent = await client.readIntent({ repo: "o/r", base: "base", head: "head", prNumber: 142 });
    expect(intent.messages).toEqual(["feat: coupon codes at checkout"]);
    expect(intent.files).toHaveLength(1);
    expect(intent.prTitle).toBe("Coupon codes");
    expect(intent.prBody).toBe("Applies a discount.");
  });

  it("carries on when there is no pull request", async () => {
    // A bare push has no PR. That weakens the intent oracle; it must not stop
    // the run, because the differential oracle needs no intent at all.
    const client = new GitHubClient({
      fetchImpl: fakeFetch({ "/repos/o/r/compare/base...head": compare }),
    });
    const intent = await client.readIntent({ repo: "o/r", base: "base", head: "head", prNumber: 9 });
    expect(intent.prBody).toBeUndefined();
    expect(intent.messages).toHaveLength(1);
  });

  it("surfaces a failed compare rather than returning an empty diff", async () => {
    const client = new GitHubClient({ fetchImpl: fakeFetch({}) });
    await expect(
      client.readIntent({ repo: "o/r", base: "a", head: "b" }),
    ).rejects.toThrow(/404/);
  });

  it("sends a token only when it has one", async () => {
    const impl = fakeFetch({ "/repos/o/r/compare/a...b": compare });
    await new GitHubClient({ fetchImpl: impl }).readIntent({ repo: "o/r", base: "a", head: "b" });
    const headers = (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!
      .headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

describe("renderDiff", () => {
  it("truncates per file so a late file still shows something", () => {
    const rendered = renderDiff(
      [
        { filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "x".repeat(50) },
        { filename: "b.ts", status: "modified", additions: 1, deletions: 0, patch: "y".repeat(50) },
      ],
      10,
    );
    expect(rendered).toContain("a.ts");
    expect(rendered).toContain("b.ts");
    expect(rendered).toContain("[...truncated]");
    expect(rendered).toContain("yyyyyyyyyy");
  });

  it("says so when a file has no textual patch", () => {
    expect(
      renderDiff([{ filename: "logo.png", status: "added", additions: 0, deletions: 0 }]),
    ).toContain("[no textual patch]");
  });
});

function writeFetch(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = routes[`${method} ${path}`] ?? routes[path];
    if (body === undefined) return new Response("no route", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("GitHubClient writes", () => {
  it("refuses to write without a token rather than sending an anonymous request", async () => {
    const { impl, calls } = writeFetch({});
    const client = new GitHubClient({ fetchImpl: impl });
    await expect(
      client.createIssue({ repo: "o/r", title: "t", body: "b" }),
    ).rejects.toThrow(/never anonymous/);
    expect(calls).toHaveLength(0);
  });

  it("files an issue and returns its number and url", async () => {
    const { impl, calls } = writeFetch({
      "POST /repos/o/r/issues": { number: 143, html_url: "https://github.com/o/r/issues/143" },
    });
    const client = new GitHubClient({ token: "t", fetchImpl: impl });
    const issue = await client.createIssue({
      repo: "o/r",
      title: "Checkout total does not update",
      body: "...",
      labels: ["aftershock", "bug"],
    });
    expect(issue.number).toBe(143);
    expect(issue.html_url).toContain("/issues/143");
    expect(calls[0]!.body).toMatchObject({ labels: ["aftershock", "bug"] });
  });

  it("carries GitHub's own reason into the error", async () => {
    const impl = vi.fn(
      async () => new Response("Reference already exists", { status: 422 }),
    ) as unknown as typeof fetch;
    await expect(
      new GitHubClient({ token: "t", fetchImpl: impl }).createIssue({ repo: "o/r", title: "t", body: "b" }),
    ).rejects.toThrow(/Reference already exists/);
  });

  it("commits every file as one commit, not one commit per file", async () => {
    const { impl, calls } = writeFetch({
      "GET /repos/o/r/git/ref/heads/aftershock%2Ffix-143": { object: { sha: "parentsha" } },
      "GET /repos/o/r/git/commits/parentsha": { tree: { sha: "treesha" } },
      "POST /repos/o/r/git/trees": { sha: "newtree" },
      "POST /repos/o/r/git/commits": { sha: "newcommit" },
      "PATCH /repos/o/r/git/refs/heads/aftershock%2Ffix-143": {},
    });
    const client = new GitHubClient({ token: "t", fetchImpl: impl });
    const sha = await client.commitFiles({
      repo: "o/r",
      branch: "aftershock/fix-143",
      message: "fix: recompute cart total",
      files: [
        { path: "hooks/useCartTotal.ts", content: "a" },
        { path: "components/CouponInput.tsx", content: "b" },
      ],
    });

    expect(sha).toBe("newcommit");
    const commits = calls.filter((c) => c.path === "/repos/o/r/git/commits" && c.method === "POST");
    expect(commits).toHaveLength(1);
    const tree = calls.find((c) => c.path === "/repos/o/r/git/trees")!;
    expect((tree.body as { tree: unknown[] }).tree).toHaveLength(2);
    expect(tree.body).toMatchObject({ base_tree: "treesha" });
  });

  it("refuses an empty commit", async () => {
    const { impl } = writeFetch({});
    await expect(
      new GitHubClient({ token: "t", fetchImpl: impl }).commitFiles({
        repo: "o/r",
        branch: "b",
        message: "m",
        files: [],
      }),
    ).rejects.toThrow(/at least one file/);
  });

  it("labels a pull request in a second call, because the create endpoint drops them", async () => {
    const { impl, calls } = writeFetch({
      "POST /repos/o/r/pulls": { number: 145, html_url: "https://github.com/o/r/pull/145" },
      "POST /repos/o/r/issues/145/labels": {},
    });
    const client = new GitHubClient({ token: "t", fetchImpl: impl });
    const pr = await client.openPullRequest({
      repo: "o/r",
      head: "aftershock/fix-143",
      base: "main",
      title: "fix: recompute cart total",
      body: "...",
      labels: ["aftershock", "aftershock:unverified"],
      draft: true,
    });

    expect(pr.number).toBe(145);
    expect(calls[0]!.body).toMatchObject({ draft: true });
    const labelled = calls.find((c) => c.path === "/repos/o/r/issues/145/labels")!;
    expect(labelled.body).toMatchObject({ labels: ["aftershock", "aftershock:unverified"] });
  });

  it("truncates a long commit status description to what GitHub accepts", async () => {
    const { impl, calls } = writeFetch({ "POST /repos/o/r/statuses/abc": {} });
    await new GitHubClient({ token: "t", fetchImpl: impl }).setCommitStatus({
      repo: "o/r",
      sha: "abc",
      state: "success",
      description: "x".repeat(400),
    });
    expect((calls[0]!.body as { description: string }).description).toHaveLength(140);
  });
});

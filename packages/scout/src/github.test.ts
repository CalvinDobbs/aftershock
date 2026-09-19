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

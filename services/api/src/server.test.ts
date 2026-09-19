import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "./server.js";
import { InMemoryRunStore } from "./runs.js";

const SECRET = "s3cret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

let app: ReturnType<typeof createServer>;
let store: InMemoryRunStore;
let dispatched: unknown[];
let fetchImpl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = new InMemoryRunStore();
  dispatched = [];
  fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    dispatched.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ run: { runId: "orch-1" } }), { status: 202 });
  });
  app = createServer({
    store,
    webhookSecret: SECRET,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    resolvePreview: async () => "https://preview.test",
    resolveBase: async () => "https://base.test",
  });
});

afterEach(async () => {
  await app.close();
});

const hook = (event: string, payload: unknown) => {
  const body = JSON.stringify(payload);
  return app.inject({
    method: "POST",
    url: "/webhooks/github",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": sign(body),
    },
    payload: body,
  });
};

const PUSH = {
  ref: "refs/heads/feat/coupon-codes",
  after: "a3f9c21",
  repository: { full_name: "o/r", default_branch: "main" },
};

describe("the webhook endpoint", () => {
  it("rejects an unsigned delivery", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push" },
      payload: JSON.stringify(PUSH),
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    const body = JSON.stringify(PUSH);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-hub-signature-256": `sha256=${createHmac("sha256", "wrong").update(body).digest("hex")}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 200 even when it declines an event", async () => {
    // A non-2xx makes GitHub retry, and retrying an event we correctly
    // declined is a loop.
    const response = await hook("issue_comment", { action: "created" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "ignored" });
  });

  it("creates a run from a push and starts it once a preview resolves", async () => {
    const response = await hook("push", PUSH);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "created", status: "pending" });

    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).toMatchObject({
      url: "http://127.0.0.1:3001/api/runs/from-commit",
      body: { repo: "o/r", head: "a3f9c21", base: "main", previewUrl: "https://preview.test" },
    });
  });

  it("treats a push and its pull request as one run, not two", async () => {
    // GitHub sends both for the same change. Two runs would double the
    // browser spend and split the evidence across them.
    await hook("push", PUSH);
    await hook("pull_request", {
      action: "opened",
      number: 2,
      pull_request: { head: { sha: "a3f9c21", ref: "feat/coupon-codes" }, base: { ref: "main" } },
      repository: { full_name: "o/r" },
    });

    expect(await store.list()).toHaveLength(1);
    // And the later event's extra knowledge is kept.
    expect((await store.list())[0]!.prNumber).toBe(2);
  });

  it("starts a waiting run when its deployment reports success", async () => {
    const quiet = createServer({
      store,
      webhookSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolvePreview: async () => null,
    });
    const body = JSON.stringify(PUSH);
    await quiet.inject({
      method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) },
      payload: body,
    });
    expect(dispatched).toHaveLength(0);
    expect((await store.list())[0]!.status).toBe("pending");

    const ds = JSON.stringify({
      deployment_status: { state: "success", environment_url: "https://late.test" },
      deployment: { sha: "a3f9c21" },
      repository: { full_name: "o/r" },
    });
    await quiet.inject({
      method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "deployment_status", "x-hub-signature-256": sign(ds) },
      payload: ds,
    });

    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    expect((await store.list())[0]!.status).toBe("running");
    await quiet.close();
  });
});

describe("project configuration", () => {
  it("applies per-repo setup the webhook could never carry", async () => {
    // A push cannot say "checkout needs a seeded cart". Without this the
    // webhook produces worse runs than a manual curl.
    const configured = createServer({
      store,
      webhookSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolvePreview: async () => "https://preview.test",
      projects: {
        "o/r": {
          baseUrl: "https://base-from-config.test",
          fallbackRoutes: ["/cart"],
          routeSamples: { slug: "wool-scarf" },
          routeSetup: { "/checkout": ["Go to /products/wool-scarf", "Click add to cart"] },
          criticalJourney: { description: "buy something", steps: ["Click add to cart"], route: "/cart" },
        },
      },
    });

    const body = JSON.stringify(PUSH);
    await configured.inject({
      method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) },
      payload: body,
    });

    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).toMatchObject({
      body: {
        baseUrl: "https://base-from-config.test",
        fallbackRoutes: ["/cart"],
        routeSetup: { "/checkout": ["Go to /products/wool-scarf", "Click add to cart"] },
        criticalJourney: { route: "/cart" },
      },
    });
    await configured.close();
  });

  it("keeps the Director's own run id so the stream is addressable", async () => {
    // The two services name the same run differently. Losing the mapping
    // makes the event stream unreachable for a run we started ourselves.
    await hook("push", PUSH);
    await vi.waitFor(async () => expect((await store.list())[0]!.orchestratorRunId).toBe("orch-1"));
  });
});

describe("composing the Director's detail under this service's ids", () => {
  const detail = {
    run: { id: "orch-1", repo: "o/r", commit: { sha: "a3f9c21", message: "feat: coupons", author: "maya", branch: "feat/coupon-codes", filesChanged: 6, additions: 1, deletions: 1 },
      previewUrl: "https://preview.test", baseUrl: "https://base.test", baseBranch: "main", status: "complete",
      riskScore: 0.7, startedAt: "2026-09-19T14:00:00.000Z", finishedAt: "2026-09-19T14:03:00.000Z", stages: [] },
    charter: null, assignments: [], findings: [], issues: [], diagnosis: null, patch: null,
    verification: { patchId: "p", rows: [], checklist: [], regressionSuitePassed: true, passed: true }, pullRequest: null,
  };
  const summary = { id: "orch-1", repo: "o/r", sha: "a3f9c21", message: "feat: coupons", branch: "feat/coupon-codes",
    author: "maya", status: "complete", agentCount: 4, findingsConfirmed: 2, findingsRaised: 4, durationMs: 180000,
    startedAt: "2026-09-19T14:00:00.000Z", prNumber: 145, verified: true };

  function withDirector() {
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/runs/from-commit")) {
        dispatched.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ run: { runId: "orch-1" } }), { status: 202 });
      }
      if (u.endsWith("/runs")) return new Response(JSON.stringify([summary]), { status: 200 });
      if (u.endsWith("/runs/orch-1")) return new Response(JSON.stringify(detail), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    return createServer({ store, webhookSecret: SECRET, fetchImpl: impl as unknown as typeof fetch,
      resolvePreview: async () => "https://preview.test" });
  }

  it("serves the Director's RunDetail for a dispatched run, under our id", async () => {
    const srv = withDirector();
    const body = JSON.stringify(PUSH);
    await srv.inject({ method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) }, payload: body });
    await vi.waitFor(async () => expect((await store.list())[0]!.orchestratorRunId).toBe("orch-1"));

    const ours = (await store.list())[0]!.runId;
    const response = await srv.inject({ method: "GET", url: `/runs/${ours}` });
    expect(response.statusCode).toBe(200);
    const got = response.json();
    // The pipeline vocabulary is the Director's; the id the dashboard links by is ours.
    expect(got.verification.passed).toBe(true);
    expect(got.run.commit.author).toBe("maya");
    expect(got.run.id).toBe(ours);
    await srv.close();
  });

  it("lists the Director's richer summary, still under our id", async () => {
    const srv = withDirector();
    const body = JSON.stringify(PUSH);
    await srv.inject({ method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) }, payload: body });
    await vi.waitFor(async () => expect((await store.list())[0]!.orchestratorRunId).toBe("orch-1"));

    const list = (await srv.inject({ method: "GET", url: "/runs" })).json();
    expect(list[0]).toMatchObject({ id: (await store.list())[0]!.runId, author: "maya", agentCount: 4, verified: true });
    await srv.close();
  });

  it("serves an honest pending detail before the Director has the run", async () => {
    // A push whose preview has not deployed exists only here. The dashboard
    // must still be able to open it, and nothing about it should be invented.
    const quiet = createServer({ store, webhookSecret: SECRET,
      fetchImpl: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
      resolvePreview: async () => null });
    const body = JSON.stringify(PUSH);
    await quiet.inject({ method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) }, payload: body });
    const ours = (await store.list())[0]!.runId;

    const got = (await quiet.inject({ method: "GET", url: `/runs/${ours}` })).json();
    expect(got.run.status).toBe("pending");
    expect(got.charter).toBeNull();
    expect(got.assignments).toEqual([]);
    expect(got.run.commit.author).toBe("");
    await quiet.close();
  });
});

describe("the run API the dashboard reads", () => {
  it("lists runs in the summary shape", async () => {
    await hook("push", PUSH);
    const response = await app.inject({ method: "GET", url: "/runs" });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ repo: "o/r", branch: "feat/coupon-codes" });
  });

  it("404s an unknown run rather than inventing one", async () => {
    expect((await app.inject({ method: "GET", url: "/runs/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/runs/nope/events" })).statusCode).toBe(404);
  });

  it("accepts a manual trigger through the same createRun the webhook uses", async () => {
    const response = await app.inject({
      method: "POST", url: "/runs",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ repo: "o/r", sha: "deadbee", previewUrl: "https://manual.test" }),
    });
    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).toMatchObject({ body: { previewUrl: "https://manual.test" } });
  });

  it("rejects a malformed manual trigger with detail", async () => {
    const response = await app.inject({
      method: "POST", url: "/runs",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ repo: "not-a-repo", sha: "" }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues.join(" ")).toContain("owner/repo");
  });

  it("marks a run failed when the Director cannot be reached", async () => {
    const dead = createServer({
      store, webhookSecret: SECRET,
      fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch,
      resolvePreview: async () => "https://preview.test",
    });
    const body = JSON.stringify(PUSH);
    await dead.inject({
      method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) },
      payload: body,
    });
    // Better a run that says it failed than one stuck at "running" forever.
    await vi.waitFor(async () => expect((await store.list())[0]!.status).toBe("failed"));
    await dead.close();
  });
});

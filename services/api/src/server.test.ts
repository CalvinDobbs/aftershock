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

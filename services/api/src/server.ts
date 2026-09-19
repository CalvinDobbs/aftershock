import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { loadProjects, projectFor, type Projects } from "./projects.js";
import { InMemoryRunStore, toSummary, type RunStore } from "./runs.js";
import { handleWebhook, verifySignature } from "./webhook.js";

/** All a URL resolver needs: which commit, on which branch, in which repo. */
export interface RunIdentity {
  repo: string;
  sha: string;
  ref: string;
  baseRef: string;
}

/**
 * `api` — the webhook receiver and the run API.
 *
 * The dashboard is the only consumer of the run endpoints (see
 * `apps/web/lib/api.ts`), and GitHub is the only caller of the webhook. Both
 * converge on `RunStore.create`.
 *
 * This service deliberately does not import the orchestrator. It calls it
 * over HTTP, so the two can be deployed and restarted independently and
 * neither owns the other's files.
 */

export interface ServerOptions {
  store?: RunStore;
  webhookSecret?: string | undefined;
  /** Where the Director lives. */
  orchestratorUrl?: string;
  /** Resolves a preview URL when the webhook payload has none. */
  resolvePreview?: (input: RunIdentity) => Promise<string | null>;
  /** The base deployment a differential compares against. Null skips pairs. */
  resolveBase?: (input: RunIdentity) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /**
   * Per-repo testing configuration. A webhook cannot carry it — a push has
   * no opportunity to say "checkout needs a seeded cart" — so it is read
   * once at boot and applied to every run for that repo.
   */
  projects?: Projects;
  logger?: boolean;
}

const ManualTrigger = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo"),
  sha: z.string().min(1),
  ref: z.string().optional(),
  baseRef: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
  previewUrl: z.string().url().optional(),
  baseUrl: z.string().url().nullable().optional(),
});

export function createServer(options: ServerOptions = {}): FastifyInstance {
  const store = options.store ?? new InMemoryRunStore();
  const orchestratorUrl = options.orchestratorUrl ?? "http://127.0.0.1:3001";
  const projects = options.projects ?? loadProjects();
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: options.logger ?? false,
    // The raw body is needed byte-for-byte to verify the signature; parsing
    // and re-serialising would change it.
    bodyLimit: 5 * 1024 * 1024,
  });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, parsed: JSON.parse(body as string) as unknown });
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  /** Hands a run to the Director. Everything before this is bookkeeping. */
  async function dispatch(runId: string, previewUrl: string): Promise<void> {
    const run = await store.get(runId);
    if (!run) return;

    await store.update(runId, {
      status: "running",
      previewUrl,
      startedAt: new Date().toISOString(),
    });

    const project = projectFor(projects, run.repo);
    const baseUrl =
      run.baseUrl ?? project.baseUrl ?? (await options.resolveBase?.(run).catch(() => null)) ?? null;

    const response = await fetchImpl(`${orchestratorUrl}/api/runs/from-commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: run.repo,
        base: run.baseRef,
        head: run.sha,
        ...(run.prNumber !== undefined ? { prNumber: run.prNumber } : {}),
        previewUrl,
        baseUrl,
        // Without these the webhook path produces worse runs than a manual
        // curl, which is backwards: the webhook is the path that gets demoed.
        ...(project.fallbackRoutes.length > 0 ? { fallbackRoutes: project.fallbackRoutes } : {}),
        ...(Object.keys(project.routeSamples).length > 0 ? { routeSamples: project.routeSamples } : {}),
        ...(Object.keys(project.routeSetup).length > 0 ? { routeSetup: project.routeSetup } : {}),
        ...(project.criticalJourney ? { criticalJourney: project.criticalJourney } : {}),
        ...(project.maxConcurrent !== undefined ? { maxConcurrent: project.maxConcurrent } : {}),
      }),
    }).catch(() => null);

    if (!response?.ok) {
      // The Director is unreachable or refused. Say so on the run rather
      // than leaving it stuck at "running" forever.
      await store.update(runId, { status: "failed", finishedAt: new Date().toISOString() });
      return;
    }

    // The Director names the work with its own id. Keeping it is what lets
    // this service proxy the event stream for a run it started.
    const body = (await response.json().catch(() => null)) as { run?: { runId?: string } } | null;
    if (body?.run?.runId) await store.update(runId, { orchestratorRunId: body.run.runId });
  }

  // --- the run API the dashboard reads ------------------------------------

  app.get("/runs", async () => (await store.list()).map(toSummary));

  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "run not found" });
    // RunDetail is assembled by the Director, which owns the pipeline
    // vocabulary. Until that bridge lands this serves the record it has.
    return { run };
  });

  app.get<{ Params: { id: string } }>("/runs/:id/events", async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "run not found" });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    // Proxied from the Director so the dashboard only ever talks to one
    // origin and no key is exposed. Addressed by the Director's own id: it
    // names its work independently, and the two ids are not the same.
    const upstreamId = run.orchestratorRunId ?? run.runId;
    const upstream = await fetchImpl(`${orchestratorUrl}/api/runs/${upstreamId}/events/stream`, {
      headers: { accept: "text/event-stream" },
    }).catch(() => null);

    if (!upstream?.body) {
      reply.raw.write(`data: ${JSON.stringify({ type: "run.failed", reason: "director unreachable" })}\n\n`);
      reply.raw.end();
      return reply;
    }

    const reader = upstream.body.getReader();
    request.raw.on("close", () => void reader.cancel().catch(() => undefined));
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.raw.write(value);
    }
    reply.raw.end();
    return reply;
  });

  app.post("/runs", async (request, reply) => {
    const body = (request.body as { parsed?: unknown } | undefined)?.parsed;
    const parsed = ManualTrigger.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      });
    }

    // The same createRun the webhook calls. The manual control is not a
    // downgrade from the webhook; it is the same path with a different caller.
    const run = await store.create({
      repo: parsed.data.repo,
      sha: parsed.data.sha,
      ref: parsed.data.ref ?? "",
      baseRef: parsed.data.baseRef ?? "main",
      ...(parsed.data.prNumber !== undefined ? { prNumber: parsed.data.prNumber } : {}),
      ...(parsed.data.previewUrl ? { previewUrl: parsed.data.previewUrl } : {}),
      ...(parsed.data.baseUrl !== undefined ? { baseUrl: parsed.data.baseUrl } : {}),
    });

    const preview = parsed.data.previewUrl ?? (await options.resolvePreview?.(run).catch(() => null));
    if (preview) void dispatch(run.runId, preview);

    return reply.code(202).send({ runId: run.runId });
  });

  app.post<{ Params: { id: string } }>("/runs/:id/ask", async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "run not found" });
    const body = (request.body as { parsed?: { text?: string } } | undefined)?.parsed;
    if (!body?.text?.trim()) return reply.code(400).send({ error: "text is required" });
    // PLACEHOLDER — accepted and recorded, but nothing re-dispatches yet.
    // Needs the Director to expose "re-run this assignment".
    return reply.code(202).send({ accepted: false, reason: "re-run is not wired yet" });
  });

  // --- the trigger ---------------------------------------------------------

  app.post("/webhooks/github", async (request, reply) => {
    const raw = (request.body as { raw?: string } | undefined)?.raw ?? "";
    const signature = request.headers["x-hub-signature-256"];
    const event = String(request.headers["x-github-event"] ?? "");

    if (!verifySignature(raw, typeof signature === "string" ? signature : undefined, options.webhookSecret)) {
      // Fails closed. An unsigned endpoint lets anyone spend our browser hours.
      return reply.code(401).send({ error: "signature verification failed" });
    }

    const payload = (request.body as { parsed?: unknown } | undefined)?.parsed;
    const outcome = await handleWebhook(event, payload, {
      createRun: async (input) => {
        const run = await store.create({
          ...input,
          baseUrl: (await options.resolveBase?.(input).catch(() => null)) ?? null,
        });

        // A push may arrive after the deployment is already live — a redelivery,
        // or a branch that was pushed before the webhook existed. Resolve now
        // rather than waiting for an event that already happened.
        const preview =
          input.previewUrl ?? (await options.resolvePreview?.(input).catch(() => null));
        if (preview && run.status === "pending") void dispatch(run.runId, preview);

        return { runId: run.runId };
      },
      startRun: async ({ runId, previewUrl }) => {
        await dispatch(runId, previewUrl);
      },
      findRun: async (query) => {
        const run = await store.find(query);
        return run ? { runId: run.runId } : null;
      },
    });

    // 200 even when ignored: a non-2xx makes GitHub retry, and retrying an
    // event we correctly declined is a loop.
    return reply.code(200).send(outcome);
  });

  app.get("/health", async () => ({ ok: true }));

  return app;
}

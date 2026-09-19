import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleWebhook, verifySignature, type WebhookDeps } from "./webhook.js";

const sign = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function deps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    createRun: vi.fn().mockResolvedValue({ runId: "run-1" }),
    startRun: vi.fn().mockResolvedValue(undefined),
    findRun: vi.fn().mockResolvedValue({ runId: "run-1" }),
    ...overrides,
  };
}

describe("verifySignature", () => {
  it("accepts a correctly signed body", () => {
    const body = '{"hello":"world"}';
    expect(verifySignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature('{"hello":"evil"}', sign('{"hello":"world"}', "s3cret"), "s3cret")).toBe(false);
  });

  it("fails closed with no secret configured", () => {
    // An unsigned endpoint lets anyone start browser runs on our budget.
    const body = "{}";
    expect(verifySignature(body, sign(body, "s3cret"), undefined)).toBe(false);
    expect(verifySignature(body, undefined, "s3cret")).toBe(false);
  });

  it("does not leak length through a thrown comparison", () => {
    expect(verifySignature("{}", "sha256=short", "s3cret")).toBe(false);
  });
});

describe("push", () => {
  const push = (over: Record<string, unknown> = {}) => ({
    ref: "refs/heads/feat/coupon-codes",
    after: "a3f9c21",
    repository: { full_name: "o/r", default_branch: "main" },
    ...over,
  });

  it("creates a pending run and does no work yet", async () => {
    // The preview does not exist at push time. Creating the run immediately
    // is what makes it appear in the dashboard the instant someone pushes.
    const d = deps();
    const out = await handleWebhook("push", push(), d);
    expect(out).toEqual({ action: "created", runId: "run-1", status: "pending" });
    expect(d.startRun).not.toHaveBeenCalled();
    expect(d.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "o/r", sha: "a3f9c21", baseRef: "main" }),
    );
  });

  it("credits the commit's author, falling back to the pusher", async () => {
    // GitHub sends both. The author wrote the change; the pusher may just have
    // rebased it. The sidebar shows this name before Scout has read anything.
    const d = deps();
    await handleWebhook(
      "push",
      push({ pusher: { name: "calvin" }, head_commit: { author: { name: "Nikhil Doal" } } }),
      d,
    );
    expect(d.createRun).toHaveBeenCalledWith(expect.objectContaining({ author: "Nikhil Doal" }));

    const onlyPusher = deps();
    await handleWebhook("push", push({ pusher: { name: "calvin" } }), onlyPusher);
    expect(onlyPusher.createRun).toHaveBeenCalledWith(expect.objectContaining({ author: "calvin" }));

    const nobody = deps();
    await handleWebhook("push", push(), nobody);
    expect(nobody.createRun).toHaveBeenCalledWith(expect.not.objectContaining({ author: expect.anything() }));
  });

  it("ignores the default branch, which is the baseline", async () => {
    const out = await handleWebhook("push", push({ ref: "refs/heads/main" }), deps());
    expect(out).toMatchObject({ action: "ignored" });
    expect((out as { reason: string }).reason).toContain("baseline");
  });

  it("ignores tags and branch deletions", async () => {
    expect(await handleWebhook("push", push({ ref: "refs/tags/v1" }), deps())).toMatchObject({ action: "ignored" });
    expect(
      await handleWebhook("push", push({ after: "0".repeat(40) }), deps()),
    ).toMatchObject({ action: "ignored", reason: "branch deleted" });
  });
});

describe("pull_request", () => {
  const pr = (action: string) => ({
    action,
    number: 2,
    pull_request: {
      head: { sha: "a3f9c21", ref: "feat/coupon-codes" },
      base: { ref: "main" },
      user: { login: "nikhil" },
    },
    repository: { full_name: "o/r" },
  });

  it("creates a run and carries the PR number and author, which buys a better charter", async () => {
    const d = deps();
    const out = await handleWebhook("pull_request", pr("opened"), d);
    expect(out).toMatchObject({ action: "created" });
    expect(d.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 2, baseRef: "main", author: "nikhil" }),
    );
  });

  it("ignores actions that are not a code change", async () => {
    for (const a of ["labeled", "closed", "assigned", "edited"]) {
      expect(await handleWebhook("pull_request", pr(a), deps())).toMatchObject({ action: "ignored" });
    }
  });
});

describe("deployment_status", () => {
  const ds = (over: Record<string, unknown> = {}) => ({
    deployment_status: { state: "success", environment_url: "https://preview.test" },
    deployment: { sha: "a3f9c21", ref: "feat/coupon-codes" },
    repository: { full_name: "o/r" },
    ...over,
  });

  it("starts the run the push created, now that there is somewhere to point", async () => {
    const d = deps();
    const out = await handleWebhook("deployment_status", ds(), d);
    expect(out).toEqual({ action: "started", runId: "run-1" });
    expect(d.startRun).toHaveBeenCalledWith({ runId: "run-1", previewUrl: "https://preview.test" });
  });

  it("waits for success rather than acting on a build in progress", async () => {
    const d = deps();
    await handleWebhook("deployment_status", ds({ deployment_status: { state: "pending" } }), d);
    expect(d.startRun).not.toHaveBeenCalled();
  });

  it("ignores a deployment no run is waiting on", async () => {
    const d = deps({ findRun: vi.fn().mockResolvedValue(null) });
    const out = await handleWebhook("deployment_status", ds(), d);
    expect(out).toMatchObject({ action: "ignored" });
    expect(d.startRun).not.toHaveBeenCalled();
  });

  it("falls back to target_url when there is no environment_url", async () => {
    const d = deps();
    await handleWebhook(
      "deployment_status",
      ds({ deployment_status: { state: "success", target_url: "https://target.test" } }),
      d,
    );
    expect(d.startRun).toHaveBeenCalledWith(expect.objectContaining({ previewUrl: "https://target.test" }));
  });
});

describe("everything else", () => {
  it("is ignored by name, not silently", async () => {
    const out = await handleWebhook("issue_comment", {}, deps());
    expect(out).toMatchObject({ action: "ignored", reason: "issue_comment is not a trigger" });
  });
});

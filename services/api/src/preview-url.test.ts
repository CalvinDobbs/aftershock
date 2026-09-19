import { describe, expect, it, vi } from "vitest";

import { deterministicHost, resolvePreviewUrl, slugifyRef } from "./preview-url.js";

const base = { repo: "o/r", ref: "feat/coupon-codes", sha: "abc1234" };

describe("slugifyRef", () => {
  it("turns a branch into a host segment", () => {
    expect(slugifyRef("feat/coupon-codes")).toBe("feat-coupon-codes");
    expect(slugifyRef("refs/heads/fix/NaN_bug")).toBe("fix-nan-bug");
  });
});

describe("deterministicHost", () => {
  it("builds the host Vercel actually uses", () => {
    expect(deterministicHost("demo-site", "feat/coupon-codes", "acme-projects")).toBe(
      "https://demo-site-git-feat-coupon-codes-acme-projects.vercel.app",
    );
  });
});

describe("resolvePreviewUrl", () => {
  it("prefers a manually supplied URL over everything", async () => {
    const r = await resolvePreviewUrl({ ...base, manualUrl: "https://manual.test" });
    expect(r).toMatchObject({ url: "https://manual.test", source: "manual" });
  });

  it("uses the deployment_status payload when the platform sends one", async () => {
    const r = await resolvePreviewUrl({ ...base, payloadUrl: "https://from-payload.test" });
    expect(r.source).toBe("payload");
  });

  it("falls through to the commit status, which is what Vercel actually posts", async () => {
    // Measured: GET /deployments?ref=… is empty for this project while the
    // commit status carries the build. The payload path will never fire here.
    const r = await resolvePreviewUrl(base, {
      commitStatusUrl: vi.fn().mockResolvedValue("https://from-status.test"),
    });
    expect(r.source).toBe("commit-status");
    expect(r.attempts).toContain("deployment_status payload: no environment_url");
  });

  it("falls through to the platform API when no status carries a URL", async () => {
    const r = await resolvePreviewUrl(base, {
      commitStatusUrl: vi.fn().mockResolvedValue(null),
      vercelDeploymentUrl: vi.fn().mockResolvedValue("https://from-vercel.test"),
    });
    expect(r.source).toBe("platform-api");
  });

  it("guesses the host only when the guess actually answers", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const r = await resolvePreviewUrl(base, {
      projectSlug: "demo-site",
      teamSlug: "acme-projects",
      probe,
    });
    expect(r.source).toBe("pattern");
    expect(probe).toHaveBeenCalledWith(
      "https://demo-site-git-feat-coupon-codes-acme-projects.vercel.app",
    );
  });

  it("refuses a guessed host that does not respond", async () => {
    // A URL that 404s produces a run full of findings about our own mistake.
    const r = await resolvePreviewUrl(base, {
      projectSlug: "demo-site",
      teamSlug: "acme-projects",
      probe: vi.fn().mockResolvedValue(false),
    });
    expect(r.url).toBeNull();
    expect(r.source).toBe("none");
  });

  it("reports every path it tried when it finds nothing", async () => {
    const r = await resolvePreviewUrl(base, {
      commitStatusUrl: vi.fn().mockResolvedValue(null),
      vercelDeploymentUrl: vi.fn().mockResolvedValue(null),
    });
    expect(r.url).toBeNull();
    expect(r.attempts).toHaveLength(4);
  });

  it("survives a source that throws", async () => {
    const r = await resolvePreviewUrl(base, {
      commitStatusUrl: vi.fn().mockRejectedValue(new Error("rate limited")),
      vercelDeploymentUrl: vi.fn().mockResolvedValue("https://from-vercel.test"),
    });
    expect(r.source).toBe("platform-api");
  });
});

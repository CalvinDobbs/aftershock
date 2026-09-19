import { describe, expect, it, vi } from "vitest";

import { drainPageEvidence, EVIDENCE_KEY, INSTRUMENT_SCRIPT } from "./instrument.js";

const page = (result: unknown) => ({ evaluate: vi.fn().mockResolvedValue(result) });

describe("drainPageEvidence", () => {
  it("splits requests into all and failed, and marks the capture real", async () => {
    const evidence = await drainPageEvidence(
      page({
        installed: true,
        net: [
          { method: "POST", url: "https://app/api/coupon/validate", status: 200, durationMs: 96 },
          { method: "GET", url: "https://app/api/cart", status: 500, durationMs: 12 },
          { method: "GET", url: "https://app/api/x", errorText: "fetch failed" },
        ],
        log: [],
      }),
    );

    expect(evidence.network.captured).toBe(true);
    expect(evidence.network.requestCount).toBe(3);
    // The successful call matters as much as the failures: "validate returned
    // 200 and nothing recalculated" is the whole diagnosis.
    expect(evidence.network.requests).toHaveLength(3);
    expect(evidence.network.failedRequests.map((r) => r.url)).toEqual([
      "https://app/api/cart",
      "https://app/api/x",
    ]);
  });

  it("reports not-captured rather than nothing-happened when the script never ran", async () => {
    // These are different claims. Conflating them is what made every step
    // record requestCount: 0 and look like an app that issued no requests.
    const evidence = await drainPageEvidence(page({ installed: false, net: [], log: [] }));
    expect(evidence.network.captured).toBe(false);
    expect(evidence.network.requestCount).toBe(0);
  });

  it("reports not-captured when the page cannot be evaluated", async () => {
    const evidence = await drainPageEvidence({
      evaluate: vi.fn().mockRejectedValue(new Error("Execution context was destroyed")),
    });
    expect(evidence.network.captured).toBe(false);
  });

  it("passes console entries through with their level", async () => {
    const evidence = await drainPageEvidence(
      page({
        installed: true,
        net: [],
        log: [{ level: "error", text: "Received NaN for children", timestamp: 7 }],
      }),
    );
    expect(evidence.console).toEqual([
      { level: "error", text: "Received NaN for children", timestamp: 7 },
    ]);
  });
});

describe("INSTRUMENT_SCRIPT", () => {
  it("is idempotent, bounded, and namespaced", () => {
    // Init scripts can run more than once per document.
    expect(INSTRUMENT_SCRIPT).toContain(`if (window[KEY]) return;`);
    // A ring, so the newest entry is always kept.
    expect(INSTRUMENT_SCRIPT).toContain("if (list.length > MAX) list.shift();");
    expect(INSTRUMENT_SCRIPT).toContain(JSON.stringify(EVIDENCE_KEY));
  });

  it("covers the failures that never reach console.error", () => {
    expect(INSTRUMENT_SCRIPT).toContain('addEventListener("error"');
    expect(INSTRUMENT_SCRIPT).toContain('addEventListener("unhandledrejection"');
  });

  it("runs as real JavaScript and records a fetch", async () => {
    // Exercised in a fake DOM rather than trusted by inspection: this string
    // is shipped into someone else's page and a syntax error there is silent.
    const calls: unknown[] = [];
    const win: Record<string, unknown> = {
      fetch: async () => ({ status: 204 }),
      XMLHttpRequest: function () {} as unknown,
      addEventListener: () => undefined,
    };
    (win.XMLHttpRequest as { prototype: Record<string, unknown> }).prototype = {
      open: () => undefined,
      send: () => undefined,
    };
    const fakeConsole = { error: () => undefined, warn: () => undefined };
    const doc = { baseURI: "https://app.test/" };

    const run = new Function("window", "console", "document", "URL", INSTRUMENT_SCRIPT);
    run(win, fakeConsole, doc, URL);

    const store = win[EVIDENCE_KEY] as { net: unknown[] };
    expect(store).toBeDefined();

    await (win.fetch as (u: string, i?: RequestInit) => Promise<unknown>)("/api/cart", {
      method: "POST",
    });
    calls.push(...store.net);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://app.test/api/cart",
      status: 204,
    });
  });
});

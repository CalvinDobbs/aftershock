import { describe, expect, it } from "vitest";
import { noiseCanary } from "./noise-canary.js";

describe("noise canary", () => {
  it("stays on the static target instead of following its external link", () => {
    const run = noiseCanary("canary-test", {});
    expect(run.previewUrl).toBe(run.baseUrl);
    expect(run.assignment.journey).toEqual([{ instruction: "Open /" }]);
  });

  it("keeps explicitly configured targets and journeys", () => {
    const run = noiseCanary("custom", {
      AFTERSHOCK_CANARY_URL: "https://demo.example",
      AFTERSHOCK_CANARY_STEP: "Open /cart",
    });
    expect(run.previewUrl).toBe("https://demo.example");
    expect(run.baseUrl).toBe(run.previewUrl);
    expect(run.assignment.journey[0]?.instruction).toBe("Open /cart");
  });
});

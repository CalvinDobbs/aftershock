import { AssignmentSchema } from "@aftershock/schema/browser";

export function noiseCanary(runId: string, env: NodeJS.ProcessEnv = process.env) {
  const target = env.AFTERSHOCK_CANARY_URL || "https://example.com";
  return {
    assignment: AssignmentSchema.parse({
      id: "noise-canary",
      runId,
      archetype: "differential",
      route: "/",
      objective: "Compare a deployment against itself and expect nothing",
      // Stay on the static target. The old link click left example.com and
      // measured Chromium's unstable layout roles in IANA's footer instead.
      journey: [{ instruction: env.AFTERSHOCK_CANARY_STEP || "Open /" }],
    }),
    previewUrl: target,
    baseUrl: target,
  };
}

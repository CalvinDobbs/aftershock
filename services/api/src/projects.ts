import { z } from "zod";

/**
 * Per-project testing configuration.
 *
 * A webhook payload says what changed; it cannot say that this app needs
 * items in a cart before checkout renders anything, or which journey is the
 * one that must never break. That is project knowledge, and it has to live
 * somewhere the trigger can read — a push arrives with no opportunity to
 * pass it by hand.
 *
 * Without this the webhook path produces worse runs than a manual curl,
 * which is exactly backwards: the webhook is the path that gets demoed.
 */

export const ProjectConfigSchema = z.object({
  /** Deployment of the default branch. Null skips every differential pair. */
  baseUrl: z.string().url().nullable().default(null),
  /** Journeys to test when a change only touches shared code. */
  fallbackRoutes: z.array(z.string().startsWith("/")).default([]),
  /** Values for dynamic segments, e.g. `{ slug: "wool-scarf" }`. */
  routeSamples: z.record(z.string(), z.string()).default({}),
  /** Steps that put the app into the state a route needs before asserting. */
  routeSetup: z.record(z.string(), z.array(z.string().min(1))).default({}),
  /** The journey that must never break, tested whether or not the diff touches it. */
  criticalJourney: z
    .object({
      description: z.string().min(1),
      steps: z.array(z.string().min(1)).min(1),
      route: z.string().startsWith("/").optional(),
    })
    .optional(),
  maxConcurrent: z.number().int().positive().optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const ProjectsSchema = z.record(z.string(), ProjectConfigSchema);
export type Projects = z.infer<typeof ProjectsSchema>;

export const EMPTY_PROJECT: ProjectConfig = ProjectConfigSchema.parse({});

/**
 * Reads `AFTERSHOCK_PROJECTS` — a JSON object keyed by `owner/repo`.
 *
 * Malformed config is reported and then ignored rather than crashing the
 * trigger: a typo in one project's setup should not stop every other repo
 * from being tested.
 */
export function loadProjects(raw = process.env.AFTERSHOCK_PROJECTS): Projects {
  if (!raw) return {};
  try {
    const parsed = ProjectsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.error("AFTERSHOCK_PROJECTS is invalid, ignoring:", parsed.error.issues.slice(0, 3));
  } catch (error) {
    console.error("AFTERSHOCK_PROJECTS is not JSON, ignoring:", (error as Error).message);
  }
  return {};
}

export function projectFor(projects: Projects, repo: string): ProjectConfig {
  return projects[repo] ?? EMPTY_PROJECT;
}

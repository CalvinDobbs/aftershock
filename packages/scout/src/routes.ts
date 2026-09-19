import type { Surface } from "@aftershock/schema";

import type { ChangedFile } from "./github.js";

/**
 * Changed files to the URLs they can reach.
 *
 * Before an assertion is worth anything, Scout has to know where to send a
 * browser. Page files map by convention and that is most of the value; shared
 * modules are the hard case, because `components/CartSummary.tsx` could appear
 * anywhere.
 *
 * Confidence is reported rather than hidden, and it travels all the way to the
 * UI, so a developer can see why an agent went where it went — and the Critic
 * can discount a finding on a surface we were only guessing about.
 */

const PAGE_FILE = /(^|\/)(page|route|layout|template)\.(t|j)sx?$/;

/** `app/(shop)/products/[slug]/page.tsx` -> `/products/[slug]` */
function appRouterPath(filename: string): string | null {
  const match = filename.match(/(?:^|\/)app\/(.*)$/);
  if (!match || !PAGE_FILE.test(filename)) return null;

  const segments = match[1]!
    .split("/")
    .slice(0, -1)
    // Route groups `(shop)` and private folders `_components` are not URL
    // segments. Parallel routes `@modal` are not either.
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    .filter((s) => !s.startsWith("_") && !s.startsWith("@"));

  return `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

/** `pages/checkout.tsx` -> `/checkout`, `pages/index.tsx` -> `/` */
function pagesRouterPath(filename: string): string | null {
  const match = filename.match(/(?:^|\/)pages\/(.*)\.(t|j)sx?$/);
  if (!match) return null;
  const path = match[1]!.replace(/\/index$/, "").replace(/^index$/, "");
  if (path.startsWith("api/") || path === "_app" || path === "_document") return null;
  return `/${path}`.replace(/\/+$/, "") || "/";
}

/** A route file that serves JSON, not a page — never worth a browser. */
function isApiRoute(filename: string): boolean {
  // `app/route.ts` is as much a handler as `app/api/x/route.ts` — the segment
  // between them is optional, and requiring it mapped the root handler to `/`
  // as a page with 0.95 confidence.
  return /(?:^|\/)app\/(?:.*\/)?route\.(t|j)sx?$/.test(filename) || /(?:^|\/)pages\/api\//.test(filename);
}

export interface RouteMapOptions {
  /**
   * The app's primary journeys, configured per project. Used when a change
   * touches shared code and nothing else can be inferred — the PRD's third
   * strategy, and the reason a diff to `lib/formatPrice.ts` still gets tested.
   */
  fallbackRoutes?: string[];
}

export function mapRoutes(
  files: readonly ChangedFile[],
  options: RouteMapOptions = {},
): Surface[] {
  const surfaces = new Map<string, Surface>();

  const add = (route: string, confidence: number, reason: string) => {
    const existing = surfaces.get(route);
    // The strongest reason for a route wins; a page file beats a guess.
    if (!existing || existing.confidence < confidence) {
      surfaces.set(route, { route, confidence, reason });
    }
  };

  let sharedChange = false;

  for (const file of files) {
    if (isApiRoute(file.filename)) {
      // Not a surface, but it tells us a route's data changed, which the
      // fallback journeys will exercise.
      sharedChange = true;
      continue;
    }

    const direct = appRouterPath(file.filename) ?? pagesRouterPath(file.filename);
    if (direct) {
      add(direct, 0.95, `direct: ${file.filename} changed`);
      continue;
    }

    // Anything else is shared code. Without the repo's import graph we cannot
    // say which pages render it, so it raises the fallback rather than
    // inventing a route.
    sharedChange = true;
  }

  if (sharedChange || surfaces.size === 0) {
    for (const route of options.fallbackRoutes ?? []) {
      add(route, 0.4, "fallback: primary journey, shared code changed");
    }
  }

  return [...surfaces.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * PLACEHOLDER — the import-graph strategy is missing.
 *
 * The PRD's second strategy walks importers of a changed module up to the
 * nearest page, which is what turns `components/CartSummary.tsx` into `/cart`
 * instead of a fallback. It needs the repository tree and file contents, not
 * just the compare response, so it lands with the GitHub App's contents
 * permission. Until then shared changes are covered by primary journeys at
 * low confidence, which is honest but blunt.
 */
export const IMPORT_GRAPH_IMPLEMENTED = false;

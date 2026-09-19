import type {
  AssignmentResult,
  ConsoleEntry,
  DeltaChannel,
  NetworkSummary,
  RawFinding,
  SnapshotDelta,
  StepSnapshot,
} from "@aftershock/schema/browser";

import {
  isInjectedWidget,
  normalise,
  normaliseTreeLine,
  pathAndQuery,
  volatileReason,
} from "./normalise.js";

/**
 * The second oracle.
 *
 * Runs the *same* recorded Actions against preview and base and compares every
 * observable after each step. It needs no statement of intent, because the
 * base branch defines correct — which is why it catches the class of bug that
 * matters most and that smoke tests miss entirely: the thing you broke
 * somewhere else while building the thing you meant to build.
 *
 * Classification is deliberately asymmetric. Marking a real regression
 * `claimed` hides it forever; marking an expected change `unclaimed` merely
 * sends it to the Critic, which has three more gates to kill it. So a delta is
 * only ever `claimed` on strong evidence, and everything ambiguous stays
 * `unclaimed`.
 */

export interface CompareOptions {
  /**
   * Scout's claims — what the diff said would change. Absent on a run with no
   * charter, in which case nothing is claimed and the oracle still works.
   */
  claims?: string[];
  /**
   * The route this journey is on. Claims are route-scoped — "a coupon input
   * appears on the checkout page" is only satisfied on /checkout — so without
   * it every claim about a page fails to match anything on that page.
   */
  route?: string;
  /** Ceiling on tree deltas per step, so one re-render cannot flood a run. */
  maxTreeDeltas?: number;
}

const DEFAULT_MAX_TREE_DELTAS = 12;
/** Churn is counted, not read, so a sample is enough to keep events small. */
const MAX_NOISE_SAMPLES = 60;

// --- claim matching ---------------------------------------------------------

const STOP = new Set([
  "a", "an", "and", "the", "is", "are", "was", "to", "of", "on", "in", "at",
  "it", "its", "that", "this", "with", "for", "not", "no", "does", "do",
  "should", "shows", "show", "appears", "appear", "page", "when", "then",
]);

function tokens(value: string): Set<string> {
  return new Set(
    normalise(value)
      .toLowerCase()
      .split(/[^a-z0-9$.]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

/**
 * Whether a claim covers this delta.
 *
 * Keyword overlap, not comprehension — a language model would judge this
 * better and the Critic is where that belongs. The threshold is set high
 * because the cost of a false `claimed` is a regression nobody ever sees.
 */
export function claimCovering(
  field: string,
  base: string,
  preview: string,
  claims: readonly string[] = [],
  route = "",
): string | null {
  const subject = tokens(`${field} ${base} ${preview} ${route.replace(/[/_-]+/g, " ")}`);
  if (subject.size === 0) return null;

  for (const claim of claims) {
    const claimed = tokens(claim);
    if (claimed.size === 0) continue;
    let hits = 0;
    for (const t of claimed) if (subject.has(t)) hits += 1;
    // Most of what the claim talks about has to be present in the delta.
    if (hits / claimed.size >= 0.6 && hits >= 2) return claim;
  }
  return null;
}

// --- one comparison ---------------------------------------------------------

function classify(
  channel: DeltaChannel,
  field: string,
  base: string,
  preview: string,
  claims: readonly string[],
  stepIndex: number,
  route = "",
): SnapshotDelta {
  const noise = volatileReason(base, preview);
  if (noise) {
    return { stepIndex, channel, field, base, preview, classification: "noise", reason: noise };
  }

  const claim = claimCovering(field, base, preview, claims, route);
  if (claim) {
    return {
      stepIndex,
      channel,
      field,
      base,
      preview,
      classification: "claimed",
      reason: `claimed: "${claim}"`,
    };
  }

  return {
    stepIndex,
    channel,
    field,
    base,
    preview,
    classification: "unclaimed",
    reason: "nothing in the diff claimed this would change",
  };
}

/** At or above this, two lines are the same element having changed. */
const PAIR_THRESHOLD = 0.5;

/**
 * Pairs a removed line with the added line it most likely became.
 *
 * Pairing matters for readability — `$132.00 → $NaN` is one finding a person
 * can act on, where an unpaired removal and addition are two they have to
 * join up themselves — and it is also what lets the noise check see both
 * halves of an attribute-only change.
 */
function pairLines(removed: string[], added: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  // Tokenising runs the full normalise pass, so it is done once per line
  // rather than once per candidate pair.
  const spare = added.map((line) => ({ line, tokens: tokens(line) }));

  for (const r of removed) {
    const rt = tokens(r);
    let best = -1;
    let bestScore = 0;

    spare.forEach((candidate, i) => {
      const at = candidate.tokens;
      const width = Math.max(rt.size, at.size);
      if (width === 0) return;
      let hits = 0;
      for (const t of rt) if (at.has(t)) hits += 1;
      const score = hits / width;
      if (score >= PAIR_THRESHOLD && score > bestScore) {
        bestScore = score;
        best = i;
      }
    });

    if (best >= 0) pairs.push([r, spare.splice(best, 1)[0]!.line]);
    else pairs.push([r, ""]);
  }

  for (const a of spare) pairs.push(["", a.line]);
  return pairs;
}

function treeDeltas(
  stepIndex: number,
  base: string,
  preview: string,
  claims: readonly string[],
  max: number,
  route: string,
): SnapshotDelta[] {
  const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  const b = lines(base);
  const p = lines(preview);

  // The diff runs on raw lines so that churn is *counted* rather than
  // silently vanishing. Normalising first would make a timestamp that changed
  // between loads simply not exist, and the run could never report how much
  // it dismissed — which is the number that tells you the filter is working.
  //
  // Multiset difference: identical lines cancel out however they moved, so
  // reordering alone is not a delta.
  const counts = new Map<string, number>();
  for (const l of b) counts.set(l, (counts.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of p) {
    const n = counts.get(l) ?? 0;
    if (n > 0) counts.set(l, n - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const [l, n] of counts) for (let i = 0; i < n; i += 1) removed.push(l);

  if (removed.length === 0 && added.length === 0) return [];

  const classified = pairLines(removed, added).map(([from, to]) => {
      const field = fieldOf(from || to) || "tree";

      // Platform chrome, and nodes with no accessible name at all — an
      // unnamed image is unreadable to a person and so cannot be a finding.
      if (
        isInjectedWidget(from) ||
        isInjectedWidget(to) ||
        isAnonymous(from || to)
      ) {
        return {
          stepIndex,
          channel: "tree" as const,
          field,
          base: from || "—",
          preview: to || "—",
          classification: "noise" as const,
          reason: "platform chrome, not the app under test",
        };
      }

      // Attribute-only churn and volatile text: the lines differ literally but
      // mean the same thing, so they are recorded as dismissed, not reported.
      if (from && to && normaliseTreeLine(from) === normaliseTreeLine(to)) {
        return {
          stepIndex,
          channel: "tree" as const,
          field,
          base: from,
          preview: to,
          classification: "noise" as const,
          reason: volatileReason(from, to) ?? "volatile: attributes only",
        };
      }

      // Node ids are stripped from the reported values as well as the field.
      // They carry no meaning for a reader and they are the first thing in a
      // finding summary, where they read as line noise.
      return classify("tree", field, readable(from), readable(to), claims, stepIndex, route);
  });

  // Cap signal and churn separately. Slicing the combined list meant a page
  // with a dozen timestamps could consume the whole budget before the one row
  // that mattered was reached, and the regression vanished silently.
  const signal = classified.filter((d) => d.classification !== "noise");
  const noise = classified.filter((d) => d.classification === "noise");
  return [...signal.slice(0, max), ...noise.slice(0, MAX_NOISE_SAMPLES)];
}

/** A tree line with its per-session node id removed. */
function readable(line: string): string {
  const bare = line.replace(/\[\d+-\d+\]/g, "").trim();
  return bare.length > 0 ? bare : "—";
}

/**
 * A readable handle for a tree line: its role plus accessible name.
 *
 * Stagehand renders nodes as `[0-17] link: Homepage`; the older Playwright
 * shape is `link "Homepage"`. Both are matched, and the node id is dropped so
 * the handle is stable enough to cluster findings by.
 */
function fieldOf(line: string): string {
  const bare = line.replace(/\[\d+-\d+\]/g, "").trim();
  const quoted = bare.match(/^([a-z]+)\s+"([^"]{0,40})"/i);
  if (quoted) return `${quoted[1]} "${quoted[2]}"`;
  const colon = bare.match(/^([a-z]+):\s*(.{0,40})/i);
  if (colon) return `${colon[1]} "${colon[2]!.trim()}"`;
  return bare.slice(0, 48);
}

function networkDeltas(
  stepIndex: number,
  base: NetworkSummary,
  preview: NetworkSummary,
  claims: readonly string[],
  route: string,
): SnapshotDelta[] {
  const out: SnapshotDelta[] = [];

  // One side not observing the network is not the same as that side being
  // healthy. Comparing an empty capture against a real one invents failures
  // on whichever side happened to be looking.
  if (!base.captured || !preview.captured) return out;

  const key = (f: NetworkSummary["failedRequests"][number]) =>
    `${f.method} ${pathAndQuery(f.url)}`;

  const baseFailures = new Set(base.failedRequests.map(key));
  for (const f of preview.failedRequests) {
    const k = key(f);
    if (baseFailures.has(k)) continue;
    // A request that fails only on the preview is the strongest signal the
    // comparator has: the base proves it is meant to work.
    out.push(
      classify(
        "network",
        k,
        "ok on base",
        f.status ? `${f.status}` : (f.errorText ?? "failed"),
        claims,
        stepIndex,
        route,
      ),
    );
  }
  return out;
}

function consoleDeltas(
  stepIndex: number,
  base: ConsoleEntry[],
  preview: ConsoleEntry[],
  claims: readonly string[],
  route: string,
): SnapshotDelta[] {
  const errs = (xs: ConsoleEntry[]) =>
    xs.filter((e) => e.level === "error" || e.level === "warning" || e.level === "warn");
  const baseTexts = new Set(errs(base).map((e) => normalise(e.text)));

  return errs(preview)
    .filter((e) => !baseTexts.has(normalise(e.text)))
    .map((e) =>
      // The field is the message, not the level: keying on the level alone
      // collapsed every distinct console error in a run into one finding
      // named after whichever fired first.
      classify(
        "console",
        `${e.level}: ${normalise(e.text).slice(0, 60)}`,
        "silent on base",
        e.text,
        claims,
        stepIndex,
        route,
      ),
    );
}

export function compareSnapshots(
  stepIndex: number,
  base: StepSnapshot,
  preview: StepSnapshot,
  options: CompareOptions = {},
): SnapshotDelta[] {
  const claims = options.claims ?? [];
  const out: SnapshotDelta[] = [];

  // Two deployments live on different hosts, so only path and query compare.
  const route = options.route ?? "";

  const baseUrl = pathAndQuery(base.url);
  const previewUrl = pathAndQuery(preview.url);
  if (baseUrl !== previewUrl) {
    out.push(classify("url", "final url", baseUrl, previewUrl, claims, stepIndex, route));
  }

  out.push(
    ...treeDeltas(
      stepIndex,
      base.formattedTree,
      preview.formattedTree,
      claims,
      options.maxTreeDeltas ?? DEFAULT_MAX_TREE_DELTAS,
      route,
    ),
  );
  out.push(...networkDeltas(stepIndex, base.network, preview.network, claims, route));
  out.push(...consoleDeltas(stepIndex, base.console, preview.console, claims, route));

  return out;
}

// --- deltas to findings -----------------------------------------------------

/**
 * Values that mean the app failed to compute something, not that it computed
 * a different answer.
 *
 * `$NaN` where a price belongs is not a changed number — it is a broken one,
 * and it is the strongest evidence a differential can produce. It also
 * explains every other delta on that step: when a formatter breaks, every
 * value it formatted vanishes at once.
 */
const CORRUPT_VALUE = /\b(?:NaN|undefined|null|Infinity|\[object Object\])\b/;

export function isCorruptValue(text: string): boolean {
  return CORRUPT_VALUE.test(text);
}

/**
 * A node with a role but no accessible name.
 *
 * Nothing a person can read, so it cannot be a finding on its own. These are
 * almost always injected chrome — the image inside a preview toolbar — and
 * reporting them is noise dressed as a regression.
 */
function isAnonymous(value: string): boolean {
  return /^[a-z]+$/i.test(value.trim());
}

const SEVERITY: Record<DeltaChannel, RawFinding["severity"]> = {
  url: "critical", // the journey went somewhere else
  network: "critical", // a request that only fails here
  status: "critical",
  console: "high",
  tree: "medium",
  text: "medium",
};

function severityFor(delta: SnapshotDelta): RawFinding["severity"] {
  if (delta.channel === "network" && /^4\d\d$/.test(delta.preview)) return "high";
  // A value the app failed to compute outranks a value it merely changed.
  if (isCorruptValue(delta.preview) && !isCorruptValue(delta.base)) return "critical";
  return SEVERITY[delta.channel];
}

/**
 * Clusters unclaimed deltas into findings.
 *
 * One finding per behaviour, not per failing step — the same broken subtotal
 * seen on four consecutive steps is one regression, cited at the step where it
 * first appeared.
 */
export function findingsFrom(deltas: readonly SnapshotDelta[]): RawFinding[] {
  const bySignature = new Map<string, SnapshotDelta[]>();

  /**
   * Once the journey has landed on a different page, everything on that page
   * differs — and none of it is an independent regression. The navigation is
   * the root behaviour and the rest is its consequence, so content deltas at
   * or after a divergence stay as evidence but do not each become a finding.
   *
   * Without this, two pages that simply differ produce a finding per element:
   * a real run against genuinely different deployments raised thirteen where
   * the honest answer is one.
   */
  const divergedAt = deltas
    .filter((d) => d.channel === "url" && d.classification === "unclaimed")
    .reduce<number | null>((min, d) => (min === null ? d.stepIndex : Math.min(min, d.stepIndex)), null);

  /**
   * Steps where the preview produced a corrupt value.
   *
   * A broken formatter takes out every value it touched, so the same step
   * shows the corrupt one appearing and several good ones vanishing. Those
   * disappearances are the same bug, not four more — a real run reported six
   * findings where the honest answer is one.
   */
  const corruptedSteps = new Set(
    deltas
      .filter((d) => d.classification === "unclaimed" && isCorruptValue(d.preview))
      .map((d) => d.stepIndex),
  );

  const downstream = (d: SnapshotDelta) =>
    (divergedAt !== null && d.channel !== "url" && d.stepIndex >= divergedAt) ||
    // A value that simply vanished on a step that also produced a corrupt
    // one is that corruption's shadow.
    (corruptedSteps.has(d.stepIndex) &&
      d.channel === "tree" &&
      d.preview === "—" &&
      !isCorruptValue(d.base));

  for (const d of deltas) {
    if (d.classification !== "unclaimed") continue;
    if (downstream(d)) continue;
    const signature = `differential::${d.channel}::${normalise(d.field)}`;
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), d]);
  }

  return [...bySignature.entries()].map(([signature, group]) => {
    const first = group.reduce((a, b) => (a.stepIndex <= b.stepIndex ? a : b));
    const steps = new Set(group.map((d) => d.stepIndex)).size;
    return {
      class: "unclaimed_delta" as const,
      severity: severityFor(first),
      signature,
      summary: `${first.field} differs from base and nothing in the diff claimed it would: base ${first.base}, preview ${first.preview}`,
      stepIndex: first.stepIndex,
      evidence: [
        `channel: ${first.channel}`,
        `base: ${first.base}`,
        `preview: ${first.preview}`,
        `seen on ${steps} step${steps === 1 ? "" : "s"}`,
      ],
    } satisfies RawFinding;
  });
}

export interface ComparisonOutcome {
  deltas: SnapshotDelta[];
  noiseFiltered: number;
  findings: RawFinding[];
}

/** Compares two completed runs of the same journey, step for step. */
export function compareResults(
  base: AssignmentResult,
  preview: AssignmentResult,
  options: CompareOptions = {},
): ComparisonOutcome {
  const steps = Math.min(base.steps.length, preview.steps.length);
  const deltas: SnapshotDelta[] = [];

  for (let i = 0; i < steps; i += 1) {
    deltas.push(
      ...compareSnapshots(i, base.steps[i]!.snapshot, preview.steps[i]!.snapshot, options),
    );
  }

  // A journey that stops early on one side is itself the finding: the same
  // Actions no longer apply, which means the page changed under them.
  if (base.steps.length !== preview.steps.length) {
    deltas.push({
      stepIndex: steps,
      channel: "status",
      field: "journey length",
      base: `${base.steps.length} steps`,
      preview: `${preview.steps.length} steps`,
      classification: "unclaimed",
      reason: "the same Actions did not complete on both sides",
    });
  }

  return {
    deltas,
    noiseFiltered: deltas.filter((d) => d.classification === "noise").length,
    findings: findingsFrom(deltas),
  };
}

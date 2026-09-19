/**
 * Noise normalisation, written before the comparator on purpose.
 *
 * Two loads of the *same* page differ constantly: timestamps, session ids,
 * nonces, cache-busting query strings, deployment ids. Without a filter the
 * comparator reports thirty deltas a run and nobody reads the output, which is
 * the failure mode that kills QA tooling.
 *
 * The opposite failure is worse and less obvious: normalise too eagerly and
 * you erase the bug. `$84.00` against `$67.20` is the entire coupon finding,
 * and `$132.00` against `$NaN` is the cart regression — so there is
 * deliberately **no general number rule** here. Every rule below targets a
 * shape that is volatile by construction, never a value a human would read.
 *
 * Each rule is named, and `volatileReason` reports which ones fired, so a
 * dismissed delta can always be explained and the rule set can be tuned
 * against real runs rather than guesses.
 */

export interface NoiseRule {
  name: string;
  pattern: RegExp;
  placeholder: string;
}

export const NOISE_RULES: readonly NoiseRule[] = [
  {
    name: "iso-8601",
    pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    placeholder: "<ts>",
  },
  {
    // Milliseconds or seconds since epoch, from 2020 onward. Bounded so an
    // order number or a price in cents cannot match.
    name: "epoch",
    pattern: /\b1[5-9]\d{11}\b|\b1[5-9]\d{8}\b/g,
    placeholder: "<epoch>",
  },
  {
    name: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    placeholder: "<uuid>",
  },
  {
    name: "deployment-id",
    pattern: /\bdpl_[A-Za-z0-9]+\b/g,
    placeholder: "<deployment>",
  },
  {
    // Hex tokens over twelve characters: build hashes, etags, csrf tokens.
    name: "hex-token",
    pattern: /\b[0-9a-f]{12,}\b/gi,
    placeholder: "<hex>",
  },
  {
    // Long opaque base64url blobs: nonces, signed cookies, JWT segments.
    name: "opaque-token",
    pattern: /\b[A-Za-z0-9_-]{24,}\b/g,
    placeholder: "<token>",
  },
  {
    name: "cache-buster",
    pattern: /([?&])(?:v|t|_|ts|cb|nocache)=[^&\s"']+/gi,
    placeholder: "$1<cachebust>",
  },
  {
    name: "relative-time",
    // Longest alternatives first: "minutes" must not be matched as "min".
    pattern:
      /\b(?:just now|an? (?:few )?(?:second|minute|hour|day)s? ago|\d+\s*(?:second|minute|hour|day|week|sec|min|hr|s|m|h|d|w)s?\s+ago)\b/gi,
    placeholder: "<ago>",
  },
  {
    name: "clock-time",
    pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AaPp][Mm])?\b/g,
    placeholder: "<clock>",
  },
];

/** Applies every rule. Whitespace is collapsed last so indentation never differs. */
export function normalise(value: string): string {
  let out = value;
  for (const rule of NOISE_RULES) out = out.replace(rule.pattern, rule.placeholder);
  return out.replace(/\s+/g, " ").trim();
}

/** The rules that actually changed this string, in order. */
export function rulesFired(value: string): string[] {
  const fired: string[] = [];
  for (const rule of NOISE_RULES) {
    // Rules carry the global flag, so lastIndex must not leak between calls.
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(value)) fired.push(rule.name);
    rule.pattern.lastIndex = 0;
  }
  return fired;
}

/**
 * Returns why two differing values are the same thing, or null if the
 * difference is real. Naming the rules is what makes a dismissal auditable.
 */
export function volatileReason(base: string, preview: string): string | null {
  if (base === preview) return null;
  if (normalise(base) !== normalise(preview)) return null;

  const fired = [...new Set([...rulesFired(base), ...rulesFired(preview)])];
  return fired.length > 0 ? `volatile: ${fired.join(", ")}` : "volatile: whitespace";
}

/** Query strings carry cache-busters and tracking; the path is what matters. */
export function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const keep = [...url.searchParams.entries()]
      .filter(([k]) => !/^(v|t|_|ts|cb|nocache|utm_[a-z]+|fbclid|gclid)$/i.test(k))
      .map(([k, v]) => `${k}=${normalise(v)}`)
      .sort();
    return `${url.origin}${url.pathname}${keep.length ? `?${keep.join("&")}` : ""}`;
  } catch {
    return normalise(raw);
  }
}

/**
 * Two deployments live on different hosts, so every URL differs by origin and
 * that is never the finding. Comparing path and query only is what lets the
 * same journey be diffed across preview and base at all.
 */
export function pathAndQuery(raw: string): string {
  try {
    const url = new URL(normaliseUrl(raw));
    return `${url.pathname}${url.search}`;
  } catch {
    return normalise(raw);
  }
}

/**
 * Accessibility-tree lines carry ids and state that churn between loads. This
 * keeps the role and the accessible name — the semantic content — and drops
 * the rest, which is how "attribute-only DOM changes" get ignored.
 */
export function normaliseTreeLine(line: string): string {
  return normalise(
    line
      // Stagehand numbers every node in the accessibility tree as [frame-index].
      // The numbering is per-session and shifts with any earlier change, so two
      // captures of an identical page disagree on every single line. Caught by
      // the noise canary on its first live run.
      .replace(/\[\d+-\d+\]/g, "")
      .replace(/\[ref=[^\]]*\]/g, "")
      .replace(/\[cursor=[^\]]*\]/g, "")
      .replace(/\bid="[^"]*"/g, "")
      .replace(/\bdata-[\w-]+="[^"]*"/g, "")
      .replace(/\baria-(?:describedby|labelledby|controls|owns)="[^"]*"/g, ""),
  );
}

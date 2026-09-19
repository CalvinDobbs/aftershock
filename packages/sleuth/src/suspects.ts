import type { ChangedFile } from "@aftershock/scout";

/**
 * The prime suspect heuristic, as ranking rather than as prompting.
 *
 * The PRD calls the diff "a ranked prior, not just context". Asking a model to
 * search in a given order and hoping it obeys is not a ranking; computing the
 * order here and handing it over as an ordered list is. It also means the
 * ranking is testable without a model, which matters because this is the step
 * that decides whether Sleuth looks in the right place at all.
 *
 * Tiers 3 and 4 of the PRD's search order — modules the changed files import,
 * and modules that import them — need the repository on disk. Sleuth runs
 * before Understudy prepares a checkout, so they are not computed here; see
 * IMPORT_GRAPH_IMPLEMENTED in @aftershock/scout for the same honest gap on the
 * route side.
 */

export interface Suspect {
  file: ChangedFile;
  score: number;
  reasons: string[];
}

/** Route "/checkout" implicates "app/checkout/page.tsx" without an import graph. */
function routeAffinity(filename: string, route: string): boolean {
  const segments = route.split("/").filter((s) => s.length > 0 && !s.startsWith("["));
  if (segments.length === 0) return false;
  const lower = filename.toLowerCase();
  return segments.some((segment) => lower.includes(segment.toLowerCase()));
}

/**
 * Words the failure is described in, minus the ones every bug report contains.
 *
 * A stop list rather than a length cut: "total", "cart" and "price" are short
 * and decisive, and dropping them because they are five characters long loses
 * exactly the signal this is here to find.
 */
const NOISE_WORDS = new Set([
  "the", "and", "not", "was", "for", "with", "that", "this", "when", "then",
  "does", "did", "are", "but", "from", "into", "after", "before", "should",
  "actual", "expected", "page", "app", "test", "value", "error", "issue",
]);

export function keywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !NOISE_WORDS.has(word)),
    ),
  ];
}

/**
 * Ranks the changed files against one failure.
 *
 * Deliberately never returns an empty list when the commit changed anything:
 * a file with no signal still scores zero and stays in the ordering, because
 * the model's job is to explain the behaviour and it cannot do that from a
 * list we pre-emptied. Filtering is the model's to do, with reasons.
 */
export function rankSuspects(input: {
  files: readonly ChangedFile[];
  route: string;
  failure: string;
}): Suspect[] {
  const words = keywords(input.failure);

  return input.files
    .map((file) => {
      const reasons: string[] = [];
      let score = 0;

      // Everything here was touched by the commit under test, which is the
      // whole reason the diff is a prior worth having.
      score += 1;
      reasons.push("changed in this commit");

      if (routeAffinity(file.filename, input.route)) {
        score += 3;
        reasons.push(`path matches the affected route ${input.route}`);
      }

      const patch = file.patch?.toLowerCase() ?? "";
      const hits = words.filter(
        (word) => patch.includes(word) || file.filename.toLowerCase().includes(word),
      );
      if (hits.length > 0) {
        // Capped: a large patch mentions many words by chance, and without a
        // cap the biggest file in the diff always wins regardless of relevance.
        score += Math.min(hits.length, 4);
        reasons.push(`mentions ${hits.slice(0, 4).join(", ")}`);
      }

      // A file the commit only deleted from rarely holds the new behaviour.
      if (file.additions === 0 && file.deletions > 0) {
        score -= 1;
        reasons.push("deletions only");
      }

      return { file, score, reasons };
    })
    .sort((left, right) => right.score - left.score || left.file.filename.localeCompare(right.file.filename));
}

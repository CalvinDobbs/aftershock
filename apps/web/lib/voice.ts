/**
 * How the room says things.
 *
 * The agents report in the vocabulary of the thing they drive: an
 * accessibility tree. That is exactly right for the comparator, which has to
 * diff `StaticText: "$84.00"` against `StaticText: "$NaN"` — and exactly wrong
 * for a person reading the transcript, who gets
 *
 *   Assertion violated: When a coupon is applied, the order summary shows the
 *   discount percent and the discount amount. Observed: StaticText: Coupon
 *   applied. 10% off your order.; StaticText: —; definition; term: Discount
 *
 * where what happened was: the discount row came back empty.
 *
 * Everything here is presentation. No payload is rewritten and nothing is
 * invented — the words all come from the pipeline, they are just unwrapped
 * from their roles and given the shape a colleague would type. Keeping it in
 * the projection is deliberate: the backend stays a machine-readable record
 * and the room stays the only place that knows about English.
 */

/**
 * Accessibility roles that carry no meaning once the value is shown.
 *
 * "StaticText" tells a screen reader how to announce something. To a human
 * reading a sentence it is noise in front of the only part that matters.
 */
const ROLE =
  /^(?:StaticText|generic|heading|paragraph|link|button|textbox|listitem|list|definition|term|image|img|cell|row|table|LayoutTable|LayoutTableRow|LayoutTableCell|RootWebArea|group|separator|status|alert|form|main|navigation|banner|contentinfo|region|article|section|emphasis|strong|code|time|note|complementary|caption|label|combobox|checkbox|radio|option|menuitem|tab|tabpanel|dialog|tooltip|progressbar|slider|spinbutton|switch|toolbar|tree|treeitem|grid|gridcell|columnheader|rowheader)(?:\s+"[^"]*"|\s+'[^']*')?\s*:\s*/i;

/** A value that means "there was nothing there". */
const EMPTY = /^(?:—|-|–|""|''|null|undefined|\(empty\)|\(blank\))$/;

/**
 * A role that arrived with no value at all — `definition` in
 * `…; definition; term: Discount`. It described the node's shape, and the
 * node had nothing in it.
 */
const BARE_ROLE =
  /^(?:StaticText|generic|heading|paragraph|link|button|textbox|listitem|list|definition|term|image|img|cell|row|table|LayoutTable|LayoutTableRow|LayoutTableCell|RootWebArea|group|separator|status|alert|form|main|navigation|banner|contentinfo|region|article|section|emphasis|strong|code|time|note|complementary|caption|label)$/i;

/** Node ids Stagehand stamps per session, e.g. `[12-4]`. Never meaningful. */
const NODE_ID = /\s*\[\d+-\d+\]\s*/g;

const squeeze = (s: string) => s.replace(/\s+/g, ' ').trim();
const stripDot = (s: string) => s.replace(/[.\s]+$/, '');
const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Turn an accessibility readout into the values it was carrying.
 *
 *   `StaticText: Coupon applied.; StaticText: —; definition; term: Discount`
 *   → `"Coupon applied." and nothing where the discount should be`
 *
 * Returns null when there was nothing but empties, so callers can say "nothing
 * at all" in their own words rather than printing a row of dashes.
 */
export function readValues(raw: string): { values: string[]; allEmpty: boolean } {
  const parts = squeeze(raw.replace(NODE_ID, ' '))
    .split(/\s*;\s*/)
    // Roles nest — `StaticText "$84.00": StaticText: $84.00` names the node
    // and then announces it. Peel until there is only a value left.
    .map((p) => {
      let v = squeeze(p);
      for (let i = 0; i < 4 && ROLE.test(v); i++) v = squeeze(v.replace(ROLE, ''));
      return v;
    })
    .map((p) => p.replace(/^["'](.*)["']$/, '$1').trim())
    // A trailing stop belongs to the sentence we are building, not to the
    // value: without this, a quoted value ends up as `order.".`
    .map((p) => (p.length > 1 ? p.replace(/\.$/, '') : p))
    .filter((p) => p.length > 0 && !BARE_ROLE.test(p));

  const meaningful = parts.filter((p) => !EMPTY.test(p));
  // Deduplicate: three cart lines all reading $NaN is one observation.
  const values = [...new Set(meaningful)];
  return { values, allEmpty: values.length === 0 && parts.length > 0 };
}

/** `["a"]` → `a` · `["a","b"]` → `a and b` · `["a","b","c"]` → `a, b and c` */
export function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

/**
 * Strip the machine framing off a finding's headline.
 *
 * `Assertion violated: X. Observed: Y` is two sentences wearing a label. The
 * label is the same on every finding, so it carries no information and costs
 * a line of a truncated title.
 */
export function splitClaim(text: string): { claim: string; observed: string | null } {
  const t = squeeze(text);
  const withoutPrefix = t.replace(
    /^(?:assertion\s+violated|violation|failed|failure|error)\s*[:—-]\s*/i,
    '',
  );
  const m = withoutPrefix.match(/^(.*?)[.\s]*\s(?:observed|actual|got|saw)\s*[:—-]\s*(.*)$/is);
  if (m) return { claim: squeeze(m[1]!), observed: squeeze(m[2]!) };
  return { claim: squeeze(withoutPrefix), observed: null };
}

/**
 * A failure, as a person would report it: what should have happened, then
 * what did, in one breath.
 *
 * Deliberately app-agnostic — it never assumes a cart, a price or a checkout.
 * The claim is whatever the assertion said and the values are whatever the
 * page showed.
 */
export function sayFailure(text: string): string {
  const { claim, observed } = splitClaim(text);
  if (!claim) return squeeze(text);
  if (!observed) return cap(stripDot(claim)) + '.';

  const { values, allEmpty } = readValues(observed);
  const head = `${cap(stripDot(claim))} —`;

  if (allEmpty) return `${head} but nothing rendered there at all.`;
  if (values.length === 0) return `${cap(stripDot(claim))}.`;
  return `${head} what came back was ${list(values.map(quote))}.`;
}

/** Quote a value unless it is already punctuation-wrapped or a bare number. */
const quote = (v: string) => (/^[“"'(]/.test(v) || /^[\d$€£¥]/.test(v) ? v : `“${v}”`);

/**
 * A title short enough to survive a one-line row.
 *
 * Cuts at a sentence boundary where there is one within the budget, so a
 * truncated title still ends like a sentence rather than mid-word.
 */
export function shortTitle(text: string, max = 96): string {
  const { claim } = splitClaim(text);
  const t = cap(squeeze(claim || text));
  if (t.length <= max) return stripDot(t);

  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (stop > max * 0.5) return stripDot(cut.slice(0, stop));
  const space = cut.lastIndexOf(' ');
  return `${stripDot(cut.slice(0, space > 0 ? space : max))}…`;
}

/**
 * A commit's subject line.
 *
 * Git's convention is a subject, a blank line, then the body, and the body is
 * often several paragraphs. Rendered as HTML the newlines collapse, so the
 * whole message arrives as one very long line — which is what the run header
 * and the opening system line were both printing, twice, above a transcript
 * that then has to be read underneath it.
 *
 * The subject is the part written to be read alone. Everything after the first
 * blank line is detail that belongs in the commit, not in a header.
 */
export function subject(message: string, max = 92): string {
  const first = squeeze(message.split(/\n\s*\n/)[0] ?? message).split('\n')[0] ?? '';
  const t = squeeze(first) || squeeze(message);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${stripDot(cut.slice(0, space > 0 ? space : max))}…`;
}

/**
 * The provenance column on the assertion list.
 *
 * Scout writes `components/CouponInput.tsx:54-59` — a location — or sometimes
 * a location plus a description of what is there. The location is the part
 * that is checkable, so a long description is dropped rather than wrapped.
 */
export function shortSource(text: string, max = 46): string {
  const t = squeeze(text);
  const loc = t.match(/^([\w./-]+\.\w+(?::[\d,\s-]+)?)/);
  if (loc) {
    // A colon with no line numbers after it was punctuation introducing the
    // prose we just dropped, not part of the location.
    const head = loc[1]!.trim().replace(/[,:\s]+$/, '');
    // Truncating a path keeps the tail: the filename identifies it, the
    // directory prefix rarely does.
    return head.length <= max ? head : `…${head.slice(-(max - 1))}`;
  }
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * A specification line — a finding's `expected`, or a fix-checklist item — as
 * the values it is actually about.
 *
 * These arrive as a run of `node: value` pairs, one per element the oracle
 * compared, so a three-line regression spells out nine roles to say three
 * numbers. Unparseable input is returned untouched: a spec we do not
 * understand is still better shown than swallowed.
 */
export function saySpec(text: string, max = 6): string {
  const t = squeeze(text);
  if (!ROLE.test(t)) return t;
  const { values, allEmpty } = readValues(t);
  if (allEmpty) return 'nothing at all';
  if (values.length === 0) return t;
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  return list(shown) + (rest > 0 ? ` and ${rest} more` : '');
}

/**
 * One cell of a comparison pane: a single value, or the word for its absence.
 */
export function sayValue(raw: string): string {
  const { values, allEmpty } = readValues(raw);
  if (allEmpty || values.length === 0) return raw.trim() === '' ? '—' : 'nothing';
  return values.length === 1 ? values[0]! : list(values);
}

/**
 * The name of the thing being compared.
 *
 * Deltas identify a node by role plus its base content — `StaticText "$84.00"`
 * — which puts the old value in the row label and then again in the base
 * column. The quoted part alone is what names the row.
 */
export function sayLabel(raw: string): string {
  const t = squeeze(raw);
  // Test ids first: they are quoted too, and a hyphenated id read as a quoted
  // value comes out as `cart-subtotal` rather than as words.
  const testid = t.match(/^\[data-testid="(.+)"\]$/);
  if (testid) return testid[1]!.replace(/[-_]/g, ' ');
  const quoted = t.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) return quoted[1] ?? quoted[2] ?? t;
  const stripped = squeeze(t.replace(ROLE, ''));
  return (stripped || t).replace(/[-_]/g, ' ');
}

/**
 * A sentence for a value that changed into something broken.
 *
 * Used where a finding is about a value rather than a claim — the differential
 * oracle's bread and butter.
 */
export function sayDelta(base: string, preview: string): string {
  const b = readValues(base);
  const p = readValues(preview);
  const was = b.allEmpty || b.values.length === 0 ? 'nothing' : list(b.values.map(quote));
  const now = p.allEmpty || p.values.length === 0 ? 'nothing' : list(p.values.map(quote));
  return `${cap(was)} on main, ${now} here.`;
}

/**
 * Trim an agent's own prose to something that fits a bubble.
 *
 * Keeps whole sentences: a trace cut mid-clause reads as a bug in the room
 * rather than as brevity. `max` is a soft budget — one long sentence is
 * always better than half of one.
 */
export function trim(text: string, max = 300): string {
  const t = squeeze(text);
  if (t.length <= max) return t;
  const sentences = t.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of sentences) {
    if (out && (out + ' ' + s).length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || sentences[0] || t;
}

export { lower, squeeze, stripDot };

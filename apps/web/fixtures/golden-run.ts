import type {
  Assignment,
  Diagnosis,
  Finding,
  Issue,
  Patch,
  PullRequest,
  Run,
  RunDetail,
  RunSummary,
  TestCharter,
  Verification,
} from '@aftershock/schema';

/**
 * The cached golden run (PRD > Demo safety).
 *
 * This is the replay source the dashboard falls back to when NEXT_PUBLIC_API_URL
 * is unset, and the thing DEMO_MODE replays if the network dies on stage. It is
 * the real shape the backend must produce — the frontend reads nothing else.
 *
 * The Cast is deliberately small: three conformance agents and one differential
 * pair. Five Browserbase sessions, four cards. See Archetype in
 * @aftershock/schema for why explorer and adversary are not here.
 */

const T0 = Date.parse('2026-09-19T14:02:11Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

export const RUN_ID = 'run_8f2a';
const REPO = 'meridian-labs/meridian';

export const run: Run = {
  id: RUN_ID,
  repo: REPO,
  commit: {
    sha: 'a3f9c2148d0e6b5f1a7c93de2048bb71fe3c0a92',
    message: 'feat: coupon codes at checkout',
    author: 'maya',
    branch: 'feat/coupon-codes',
    prNumber: 142,
    prTitle: 'Coupon codes at checkout',
    filesChanged: 6,
    additions: 118,
    deletions: 14,
  },
  previewUrl: 'https://meridian-git-feat-coupon-codes.vercel.app',
  baseUrl: 'https://meridian.vercel.app',
  status: 'complete',
  riskScore: 0.72,
  startedAt: at(0),
  finishedAt: at(214),
  stages: [
    { stage: 'trigger', status: 'complete', startedAt: at(0), finishedAt: at(6) },
    { stage: 'scout', status: 'complete', startedAt: at(6), finishedAt: at(19) },
    { stage: 'cast', status: 'complete', startedAt: at(19), finishedAt: at(97) },
    { stage: 'critic', status: 'complete', startedAt: at(97), finishedAt: at(139) },
    { stage: 'sleuth', status: 'complete', startedAt: at(139), finishedAt: at(152) },
    { stage: 'understudy', status: 'complete', startedAt: at(152), finishedAt: at(178) },
    { stage: 'curtain_call', status: 'complete', startedAt: at(178), finishedAt: at(214) },
  ],
};

export const charter: TestCharter = {
  runId: RUN_ID,
  intent: {
    summary:
      'Adds a coupon code field to checkout that applies a percentage discount to the order total.',
    claims: [
      'A coupon input appears on the checkout page',
      'Valid codes reduce the displayed total',
      'Invalid codes surface an error without changing the total',
    ],
    confidence: 0.86,
  },
  surfaces: [
    { route: '/checkout', confidence: 0.95, reason: 'direct: app/checkout/page.tsx changed' },
    { route: '/cart', confidence: 0.55, reason: 'import graph: lib/formatPrice.ts changed' },
    { route: '/products/[slug]', confidence: 0.3, reason: 'fallback: primary journey entry point' },
  ],
  assertions: [
    {
      id: 'A1',
      type: 'conformance',
      route: '/checkout',
      statement: 'Entering coupon SAVE20 reduces the order total by 20 percent',
      severity: 'critical',
      derivedFrom: 'applyDiscount.ts:14 and PR #142 body',
    },
    {
      id: 'A2',
      type: 'conformance',
      route: '/checkout',
      statement: 'An invalid coupon shows an error and leaves the total unchanged',
      severity: 'medium',
      derivedFrom: 'else branch in applyDiscount.ts:22',
    },
    {
      id: 'A3',
      type: 'conformance',
      route: '/checkout',
      statement: 'A coupon input appears on the checkout page and nowhere else',
      severity: 'medium',
      derivedFrom: 'PR #142: "a coupon code field to checkout"',
    },
    {
      id: 'D1',
      type: 'differential',
      route: '/cart',
      journey: 'Add two items to cart, open cart, proceed to checkout, complete order with no coupon',
      severity: 'high',
      rationale: 'Core purchase path, not claimed to change',
    },
  ],
  blastRadius: ['checkout', 'cart', 'pricing'],
  riskScore: 0.72,
};

// --- The Cast ---------------------------------------------------------------

const A1: Assignment = {
  id: 'A1',
  runId: RUN_ID,
  archetype: 'conformance',
  assertionId: 'A1',
  route: '/checkout',
  brief: 'Entering coupon SAVE20 reduces the order total by 20 percent',
  status: 'failed',
  sessionId: 'bb_sess_7c1a9e',
  baseSessionId: null,
  startedAt: at(19),
  finishedAt: at(60),
  durationMs: 41_000,
  steps: [
    { idx: 1, action: { method: 'goto', description: 'open the wool scarf product page', arguments: ['/products/wool-scarf'] }, label: 'Open /products/wool-scarf', screenshotUrl: null, ms: 1840, ok: true },
    { idx: 2, action: { method: 'click', description: 'click the Add to cart button', selector: "button:has-text('Add to cart')" }, label: 'Click Add to cart', screenshotUrl: null, ms: 620, ok: true },
    { idx: 3, action: { method: 'goto', description: 'open checkout', arguments: ['/checkout'] }, label: 'Open /checkout', screenshotUrl: null, ms: 1320, ok: true },
    { idx: 4, action: { method: 'extract', description: 'read the order total before applying a coupon', selector: "[data-testid='order-total']" }, label: 'Read total — $84.00', screenshotUrl: null, ms: 410, ok: true,
      digest: { route: '/checkout', brand: 'MERIDIAN', meta: 'Cart · 1', lines: [{ label: 'Wool scarf, oat', value: '$78.00' }, { label: 'Shipping', value: '$6.00' }], field: { label: 'Coupon code', value: '' }, action: 'Apply', total: { label: 'Total', value: '$84.00' }, flagged: false } },
    { idx: 5, action: { method: 'fill', description: 'type SAVE20 into the coupon field', selector: "input[name='coupon']", arguments: ['SAVE20'] }, label: 'Enter SAVE20', screenshotUrl: null, ms: 380, ok: true },
    { idx: 6, action: { method: 'click', description: 'click the Apply button', selector: "button:has-text('Apply')" }, label: 'Click Apply', screenshotUrl: null, ms: 940, ok: true },
    { idx: 7, action: { method: 'extract', description: 'read the order total after applying the coupon', selector: "[data-testid='order-total']" }, label: 'Read total — $84.00 (expected $67.20)', screenshotUrl: null, ms: 460, ok: false,
      digest: { route: '/checkout', brand: 'MERIDIAN', meta: 'Cart · 1', lines: [{ label: 'Wool scarf, oat', value: '$78.00' }], notice: { text: 'Coupon applied — SAVE20, 20%% off', tone: 'ok' }, field: { label: 'Coupon code', value: 'SAVE20' }, action: 'Apply', total: { label: 'Total', value: '$84.00' }, flagged: true } },
  ],
  network: [
    { method: 'GET', url: '/checkout', status: 200, ms: 214 },
    { method: 'POST', url: '/api/coupon/validate', status: 200, ms: 96, note: '{"valid":true,"percentOff":20}' },
    { method: '—', url: 'no subsequent request to recalculate the cart total', status: 0, ms: 0, note: 'expected /api/cart/recalculate' },
  ],
  console: [],
  trace: [
    { seq: 1, at: at(20), content: 'A1 cites applyDiscount.ts:14, so I need a cart with something in it before I can test anything. Seeding one item.' },
    { seq: 2, at: at(24), content: 'Planned the Apply click once and kept the Action. Every replay from here uses that same object, no model in the loop.' },
    { seq: 3, at: at(52), content: 'Code accepted, success line renders, total does not move. $84.00 before, $84.00 after.' },
    { seq: 4, at: at(57), content: 'Ran it three times in fresh browsers and got the same thing three times. Passing it up — I report what I saw, @Gavel decides what it means.' },
  ],
};

const A2: Assignment = {
  id: 'A2',
  runId: RUN_ID,
  archetype: 'conformance',
  assertionId: 'A2',
  route: '/checkout',
  brief: 'An invalid coupon shows an error and leaves the total unchanged',
  status: 'passed',
  sessionId: 'bb_sess_3d40f2',
  baseSessionId: null,
  startedAt: at(19),
  finishedAt: at(52),
  durationMs: 33_000,
  steps: [
    { idx: 1, action: { method: 'goto', description: 'open checkout with a seeded cart', arguments: ['/checkout'] }, label: 'Open /checkout', screenshotUrl: null, ms: 1510, ok: true },
    { idx: 2, action: { method: 'fill', description: 'type an invalid coupon', selector: "input[name='coupon']", arguments: ['NOTACODE'] }, label: 'Enter NOTACODE', screenshotUrl: null, ms: 340, ok: true },
    { idx: 3, action: { method: 'click', description: 'click Apply', selector: "button:has-text('Apply')" }, label: 'Click Apply', screenshotUrl: null, ms: 880, ok: true },
    { idx: 4, action: { method: 'extract', description: 'read the error message and the total', selector: "[data-testid='coupon-error']" }, label: 'Error shown, total $84.00', screenshotUrl: null, ms: 400, ok: true,
      digest: { route: '/checkout', brand: 'MERIDIAN', meta: 'Cart · 1', lines: [{ label: 'Wool scarf, oat', value: '$78.00' }], notice: { text: 'That code is not valid', tone: 'error' }, field: { label: 'Coupon code', value: 'NOTACODE' }, action: 'Apply', total: { label: 'Total', value: '$84.00' }, flagged: false } },
  ],
  network: [
    { method: 'POST', url: '/api/coupon/validate', status: 200, ms: 88, note: '{"valid":false}' },
  ],
  console: [],
  trace: [
    { seq: 1, at: at(21), content: 'A2 is the else branch at applyDiscount.ts:22. Feeding it a code that does not exist.' },
    { seq: 2, at: at(48), content: '"That code is not valid" renders and the total stays at $84.00. A2 holds. Nothing to report.' },
  ],
};

const A3: Assignment = {
  id: 'A3',
  runId: RUN_ID,
  archetype: 'conformance',
  assertionId: 'A3',
  route: '/checkout',
  brief: 'A coupon input appears on the checkout page and nowhere else',
  status: 'passed',
  sessionId: 'bb_sess_91ba07',
  baseSessionId: null,
  startedAt: at(19),
  finishedAt: at(58),
  durationMs: 39_000,
  steps: [
    { idx: 1, action: { method: 'goto', description: 'open checkout', arguments: ['/checkout'] }, label: 'Open /checkout', screenshotUrl: null, ms: 1460, ok: true },
    { idx: 2, action: { method: 'observe', description: 'locate a coupon input', selector: "input[name='coupon']" }, label: 'Coupon field present', screenshotUrl: null, ms: 520, ok: true },
    { idx: 3, action: { method: 'goto', description: 'open the cart', arguments: ['/cart'] }, label: 'Open /cart', screenshotUrl: null, ms: 1180, ok: true },
    { idx: 4, action: { method: 'observe', description: 'confirm no coupon input on the cart', selector: "input[name='coupon']" }, label: 'No coupon field on /cart', screenshotUrl: null, ms: 490, ok: true,
      digest: { route: '/cart', brand: 'MERIDIAN', meta: 'Cart · 1', lines: [{ label: 'Wool scarf, oat', value: '$78.00' }], total: { label: 'Subtotal', value: '$78.00' }, flagged: false } },
  ],
  network: [{ method: 'GET', url: '/cart', status: 200, ms: 178 }],
  console: [],
  trace: [
    { seq: 1, at: at(22), content: 'A3 is a placement claim — the field has to be on checkout and nowhere else. Checking both pages.' },
    { seq: 2, at: at(50), content: 'Placement is right. Separately, I watched the total sit at $84.00 after apply in my own session too, so that is a second pair of eyes on A1.' },
  ],
};

const D1: Assignment = {
  id: 'D1',
  runId: RUN_ID,
  archetype: 'differential',
  assertionId: 'D1',
  route: '/cart',
  brief: 'Add two items to cart, open cart, proceed to checkout, complete order with no coupon',
  status: 'failed',
  sessionId: 'bb_sess_a20c5d',
  baseSessionId: 'bb_sess_a20c5e',
  startedAt: at(19),
  finishedAt: at(97),
  durationMs: 78_000,
  steps: [
    { idx: 1, action: { method: 'goto', description: 'open the wool scarf product page', arguments: ['/products/wool-scarf'] }, label: 'Open /products/wool-scarf', screenshotUrl: null, baseScreenshotUrl: null, ms: 1720, ok: true },
    { idx: 2, action: { method: 'click', description: 'add to cart', selector: "button:has-text('Add to cart')" }, label: 'Add item 1', screenshotUrl: null, baseScreenshotUrl: null, ms: 610, ok: true },
    { idx: 3, action: { method: 'goto', description: 'open the linen throw product page', arguments: ['/products/linen-throw'] }, label: 'Open /products/linen-throw', screenshotUrl: null, baseScreenshotUrl: null, ms: 1390, ok: true },
    { idx: 4, action: { method: 'click', description: 'add to cart', selector: "button:has-text('Add to cart')" }, label: 'Add item 2', screenshotUrl: null, baseScreenshotUrl: null, ms: 580, ok: true },
    { idx: 5, action: { method: 'goto', description: 'open the cart', arguments: ['/cart'] }, label: 'Open /cart — subtotal differs', screenshotUrl: null, baseScreenshotUrl: null, ms: 1240, ok: false,
      digest: { route: '/cart', brand: 'MERIDIAN', meta: 'Cart · 2', lines: [{ label: 'Wool scarf, oat', value: '$78.00' }, { label: 'Linen throw', value: '$54.00' }], total: { label: 'Subtotal', value: '$NaN' }, flagged: true },
      baseDigest: { route: '/cart', brand: 'MERIDIAN', meta: 'Cart · 2', lines: [{ label: 'Wool scarf, oat', value: '$78.00' }, { label: 'Linen throw', value: '$54.00' }], total: { label: 'Subtotal', value: '$132.00' }, flagged: false } },
    { idx: 6, action: { method: 'click', description: 'proceed to checkout', selector: "a:has-text('Checkout')" }, label: 'Proceed to checkout', screenshotUrl: null, baseScreenshotUrl: null, ms: 1120, ok: true },
    { idx: 7, action: { method: 'click', description: 'place the order', selector: "button:has-text('Place order')" }, label: 'Place order — both complete', screenshotUrl: null, baseScreenshotUrl: null, ms: 2310, ok: true },
  ],
  network: [
    { method: 'GET', url: '/cart', status: 200, ms: 191 },
    { method: 'POST', url: '/api/orders', status: 201, ms: 402 },
  ],
  console: [
    { level: 'warn', text: 'Received NaN for the `children` attribute. [preview only]' },
  ],
  trace: [
    { seq: 1, at: at(20), content: 'Two sessions up, preview and main. I plan each action once and replay the same object on both sides, so anything that differs is the code, not the model changing its mind.' },
    { seq: 2, at: at(61), content: 'Six raw deltas at step 5. Four are noise — two timestamps, an order nonce, an attribute-only DOM change — and I normalise those away before I look.' },
    { seq: 3, at: at(64), content: '@QAizen different problem, same journey. Main prints the cart subtotal as $132.00, this branch prints $NaN. Nobody claimed formatPrice would change, so it is unclaimed and I am passing it up.' },
    { seq: 4, at: at(90), content: 'Both sides still complete the purchase, so the path is intact. This is a display regression, not a dead end.' },
  ],
};

export const assignments: Assignment[] = [A1, A2, A3, D1];

// --- Critic -----------------------------------------------------------------

export const findings: Finding[] = [
  {
    id: 'F1',
    runId: RUN_ID,
    assignmentIds: ['A1', 'A3'],
    class: 'assertion_violation',
    status: 'confirmed',
    severity: 'critical',
    title: 'Checkout total does not update when a valid coupon is applied',
    route: '/checkout',
    signature: 'checkout::order-total::unchanged-after-apply',
    expected: 'Entering a valid coupon code reduces the order total.',
    expectedSource: 'PR #142: "applies a percentage discount to the order total" · applyDiscount.ts:14',
    actual:
      'The coupon is accepted and the success message renders, but the displayed total stays at $84.00. The discount is never reflected in the UI, and the order submits at the undiscounted price.',
    baseConfidence: 0.65,
    confidence: 0.85,
    modifiers: [
      { label: 'Reproduced 3 of 3 attempts (×1.15)', delta: 0.1 },
      { label: 'Corroborated independently by A3', delta: 0.1 },
    ],
    reproCount: 3,
    reproAttempts: 3,
    repro: [
      'Open /products/wool-scarf',
      'Click Add to cart',
      'Open /checkout',
      'Enter SAVE20 in the coupon field',
      'Click Apply',
      'Observe: "Coupon applied" appears, total remains $84.00 (expected $67.20)',
    ],
    filed: true,
  },
  {
    id: 'F2',
    runId: RUN_ID,
    assignmentIds: ['D1'],
    class: 'unclaimed_delta',
    status: 'confirmed',
    severity: 'high',
    title: 'Cart subtotal renders as $NaN for multi-item carts',
    route: '/cart',
    signature: 'cart::cart-subtotal::nan',
    expected:
      'The cart subtotal renders the sum of line items, as it does on the base branch.',
    expectedSource: 'differential against main — nothing in the diff claims cart subtotal changes',
    actual:
      'With two or more items in the cart the subtotal renders as "$NaN". The base deployment renders "$132.00" for the identical journey. Checkout still completes.',
    baseConfidence: 0.75,
    confidence: 0.71,
    modifiers: [
      { label: 'Reproduced 2 of 2 attempts (×1.15)', delta: 0.11 },
      { label: 'Scout route confidence low (/cart at 0.55, import-graph inferred)', delta: -0.15 },
    ],
    reproCount: 2,
    reproAttempts: 2,
    repro: [
      'Open /products/wool-scarf and click Add to cart',
      'Open /products/linen-throw and click Add to cart',
      'Open /cart',
      'Observe: subtotal reads "$NaN" (base branch reads "$132.00")',
    ],
    deltas: [
      { field: '[data-testid="cart-subtotal"]', preview: '$NaN', base: '$132.00', classification: 'unclaimed' },
      { field: 'console.warn', preview: 'Received NaN for the `children` attribute.', base: '—', classification: 'unclaimed' },
      { field: '[data-testid="coupon-field"]', preview: 'present', base: 'absent', classification: 'claimed' },
      { field: 'meta[name="build-id"]', preview: 'dpl_9Fk2…', base: 'dpl_31Ax…', classification: 'noise' },
      { field: 'order nonce', preview: '8c1f-…', base: '4ba0-…', classification: 'noise' },
      { field: 'final URL', preview: '/orders/confirmed', base: '/orders/confirmed', classification: 'match' },
    ],
    filed: true,
  },
  {
    id: 'F3',
    runId: RUN_ID,
    assignmentIds: ['A3'],
    class: 'assertion_violation',
    status: 'flaky',
    severity: 'low',
    title: 'Product image placeholder flickers on first paint',
    route: '/products/[slug]',
    signature: 'products::hero-image::flicker',
    expected: 'The product hero image renders without an intermediate blank frame.',
    expectedSource: 'A3 step 1 observation',
    actual: 'A blank frame was captured between navigation and first paint on one attempt.',
    baseConfidence: 0.65,
    confidence: 0.2,
    modifiers: [{ label: 'Failed to reproduce (×0.30)', delta: -0.45 }],
    reproCount: 0,
    reproAttempts: 2,
    repro: [],
    filed: false,
  },
  {
    id: 'F4',
    runId: RUN_ID,
    assignmentIds: ['D1'],
    class: 'hard_failure',
    status: 'pre_existing',
    severity: 'medium',
    title: 'Newsletter signup returns 500',
    route: '/cart',
    signature: 'newsletter::POST /api/subscribe::500',
    expected: 'Submitting the footer newsletter form succeeds.',
    expectedSource: 'hard failure — 5xx needs no specification',
    actual:
      'POST /api/subscribe returns 500. The base deployment returns 500 for the identical request, so this is not a regression from this commit.',
    baseConfidence: 0.9,
    confidence: 0,
    modifiers: [{ label: 'Same behaviour present on base — killed outright', delta: -0.9 }],
    reproCount: 2,
    reproAttempts: 2,
    repro: [],
    filed: false,
  },
];

// --- Issues -----------------------------------------------------------------

const CHECKLIST_143 = [
  'Cart total recomputes when a coupon is applied',
  'Total reverts when the coupon is removed',
  'Discounted total is what checkout submits, not just what is displayed',
  'Invalid coupon leaves the total untouched',
];

export const issues: Issue[] = [
  {
    id: 'I143',
    runId: RUN_ID,
    findingId: 'F1',
    number: 143,
    url: `https://github.com/${REPO}/issues/143`,
    title: 'Checkout total does not update when a valid coupon is applied',
    labels: ['aftershock', 'bug', 'severity:critical'],
    fixChecklist: CHECKLIST_143,
    body: `## Checkout total does not update when a valid coupon is applied

**Found by** Aftershock · commit \`a3f9c21\` · confidence 0.85 · severity Critical

### What should happen
Entering a valid coupon code reduces the order total.

> Derived from PR #142: "applies a percentage discount to the order total"
> and \`applyDiscount.ts:14\`

### What actually happens
The coupon is accepted and the success message renders, but the displayed
total stays at $84.00. The discount is never reflected in the UI, and the
order submits at the undiscounted price.

### Reproduction
Reproduced 3 of 3 attempts in isolated browser sessions.

1. Open \`/products/wool-scarf\`
2. Click **Add to cart**
3. Open \`/checkout\`
4. Enter \`SAVE20\` in the coupon field
5. Click **Apply**
6. Observe: "Coupon applied" appears, total remains $84.00

Expected total: $67.20

### Evidence

| | |
| --- | --- |
| Before apply | step 4 screenshot |
| After apply | step 7 screenshot |

**Session recording:** watch (0:41)

<details><summary>Network activity</summary>

\`POST /api/coupon/validate\` → 200 \`{"valid":true,"percentOff":20}\`
No subsequent request to recalculate the cart total.

</details>

<details><summary>Console</summary>

No errors.

</details>

### Where to look

The API returns the discount correctly, so this is client-side state.
The most likely cause is that the coupon response updates local component
state without invalidating the cart total derivation.

Suspect files, ranked:
- \`components/CouponInput.tsx:38\` — sets \`couponResult\`, no cart update
- \`hooks/useCartTotal.ts:12\` — memo does not depend on applied coupon

### Fix checklist
${CHECKLIST_143.map((c) => `- [ ] ${c}`).join('\n')}

---
<sub>Aftershock run 8f2a · 4 agents · 4 findings · 2 filed</sub>`,
  },
  {
    id: 'I144',
    runId: RUN_ID,
    findingId: 'F2',
    number: 144,
    url: `https://github.com/${REPO}/issues/144`,
    title: 'Cart subtotal renders as $NaN for multi-item carts',
    labels: ['aftershock', 'bug', 'regression', 'severity:high'],
    fixChecklist: [
      'Cart subtotal renders a currency value for carts of any size',
      'Subtotal matches the sum of line items',
      'No NaN warning in the console on /cart',
    ],
    body: `## Cart subtotal renders as $NaN for multi-item carts

**Found by** Aftershock · commit \`a3f9c21\` · confidence 0.71 · severity High

### What should happen
The cart subtotal renders the sum of line items.

> No claim in this diff mentions the cart subtotal. The base deployment of
> \`main\` renders \`$132.00\` for the identical journey, so \`main\` is the oracle.

### What actually happens
With two or more items in the cart the subtotal renders as \`$NaN\`.
Checkout still completes and submits the correct amount, so this is a display
regression rather than a broken purchase path.

### Reproduction
Reproduced 2 of 2 attempts, in paired preview/base sessions.

1. Open \`/products/wool-scarf\` and click **Add to cart**
2. Open \`/products/linen-throw\` and click **Add to cart**
3. Open \`/cart\`
4. Observe: subtotal reads \`$NaN\`; base branch reads \`$132.00\`

### Differential

| Signal | Preview | Base | |
| --- | --- | --- | --- |
| \`[data-testid="cart-subtotal"]\` | \`$NaN\` | \`$132.00\` | unclaimed |
| \`console.warn\` | Received NaN for the \`children\` attribute | — | unclaimed |
| \`[data-testid="coupon-field"]\` | present | absent | claimed |

4 further deltas were normalised away as noise.

### Where to look
- \`lib/formatPrice.ts\` — signature changed in this commit

---
<sub>Aftershock run 8f2a · found by differential agent D1</sub>`,
  },
];

// --- Sleuth -----------------------------------------------------------------

export const diagnosis: Diagnosis = {
  issueId: 'I143',
  inconclusive: false,
  hypotheses: [
    {
      file: 'hooks/useCartTotal.ts',
      lines: [12, 19],
      confidence: 0.81,
      explanation:
        'useMemo dependency array omits appliedCoupon, so the total never recomputes after a coupon is applied.',
      evidence: [
        'network: POST /api/coupon/validate returns 200 with percentOff 20, and no recalculation request follows',
        'diff: appliedCoupon was added to the cart context in this commit',
      ],
    },
    {
      file: 'components/CouponInput.tsx',
      lines: [38],
      confidence: 0.42,
      explanation: 'Sets local state without lifting it to cart context.',
      evidence: ['diff: new component in this commit'],
    },
  ],
  recommendedApproach:
    'Add appliedCoupon to the useMemo dependency array and derive the discounted total inside the hook rather than at the call site.',
};

// --- Understudy -------------------------------------------------------------

export const patch: Patch = {
  id: 'P1',
  issueId: 'I143',
  branch: 'aftershock/fix-143-cart-total-memo',
  attempt: 1,
  verified: true,
  previewUrl: 'https://meridian-git-aftershock-fix-143.vercel.app',
  commitMessage: `fix: recompute cart total when a coupon is applied

The useCartTotal memo omitted appliedCoupon from its
dependency array, so the displayed total never updated.

Closes #143
Found and verified by Aftershock run 8f2a`,
  diff: `diff --git a/hooks/useCartTotal.ts b/hooks/useCartTotal.ts
index 4c1f9a2..8b7e310 100644
--- a/hooks/useCartTotal.ts
+++ b/hooks/useCartTotal.ts
@@ -9,14 +9,19 @@ import { useCart } from '@/context/CartContext';
 export function useCartTotal() {
-  const { items } = useCart();
+  const { items, appliedCoupon } = useCart();
 
   const subtotal = useMemo(
     () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
     [items],
   );
 
-  const total = useMemo(() => subtotal, [subtotal]);
+  const discount = useMemo(
+    () => (appliedCoupon ? Math.round(subtotal * appliedCoupon.percentOff) / 100 : 0),
+    [subtotal, appliedCoupon],
+  );
+
+  const total = useMemo(() => subtotal - discount, [subtotal, discount]);
 
-  return { subtotal, total };
+  return { subtotal, discount, total };
 }`,
};

// --- Curtain Call -----------------------------------------------------------

export const verification: Verification = {
  patchId: 'P1',
  passed: true,
  regressionSuitePassed: true,
  rows: [
    {
      assignmentId: 'A1',
      label: 'A1 · Entering coupon SAVE20 reduces the order total by 20 percent',
      before: 'failed',
      after: 'passed',
      beforeSessionId: 'bb_sess_7c1a9e',
      afterSessionId: 'bb_sess_ff0213',
      beforeScreenshotUrl: null,
      afterScreenshotUrl: null,
      beforeValue: '$84.00',
      afterValue: '$67.20',
    },
    {
      assignmentId: 'D1',
      label: 'D1 · Differential suite against main — no second regression',
      before: 'failed',
      after: 'passed',
      beforeSessionId: 'bb_sess_a20c5d',
      afterSessionId: 'bb_sess_ff0218',
      beforeScreenshotUrl: null,
      afterScreenshotUrl: null,
      beforeValue: '1 unclaimed delta',
      afterValue: '0 unclaimed deltas',
    },
  ],
  checklist: CHECKLIST_143.map((item) => ({ item, passed: true })),
};

export const pullRequest: PullRequest = {
  number: 145,
  url: `https://github.com/${REPO}/pull/145`,
  title: 'fix: recompute cart total when a coupon is applied',
  branch: 'aftershock/fix-143-cart-total-memo',
  baseBranch: 'feat/coupon-codes',
  labels: ['aftershock', 'automated-fix', 'verified'],
  draft: false,
  closesIssue: 143,
  body: `Verified against a fresh preview deployment before this PR opened.

| Assignment | Before | After |
| --- | --- | --- |
| A1 — coupon reduces the total | failed — \`$84.00\` | passed — \`$67.20\` |
| D1 — differential suite vs \`main\` | 1 unclaimed delta | 0 unclaimed deltas |

### Diagnosis
\`useCartTotal\` memoised the total on \`[subtotal]\` alone, so applying a coupon
updated cart context but never re-derived the total. The discount is now
computed inside the hook and the total depends on it.

### Fix checklist
${CHECKLIST_143.map((c) => `- [x] ${c}`).join('\n')}

Closes #143`,
};

export const detail: RunDetail = {
  run,
  charter,
  assignments,
  findings,
  issues,
  diagnosis,
  patch,
  verification,
  pullRequest,
};

// --- Runs list --------------------------------------------------------------

export const runList: RunSummary[] = [
  {
    id: RUN_ID,
    repo: REPO,
    sha: run.commit.sha,
    message: run.commit.message,
    branch: run.commit.branch,
    author: run.commit.author,
    status: 'complete',
    agentCount: 4,
    findingsConfirmed: 2,
    findingsRaised: 4,
    durationMs: 214_000,
    startedAt: at(0),
    prNumber: 145,
  },
  {
    id: 'run_7b19',
    repo: REPO,
    sha: 'c72d40ba91e7f5c3a8d62109fe4b3307cc12ad58',
    message: 'refactor: extract price formatting into lib/formatPrice',
    branch: 'chore/price-format',
    author: 'dev',
    status: 'no_findings',
    agentCount: 3,
    findingsConfirmed: 0,
    findingsRaised: 1,
    durationMs: 121_000,
    startedAt: new Date(T0 - 5_400_000).toISOString(),
    prNumber: null,
  },
  {
    id: 'run_6e05',
    repo: REPO,
    sha: '1de88f0325a7bb64c0912ef7a3d5104bb9e7621f',
    message: 'feat: order confirmation email receipt',
    branch: 'feat/order-receipt',
    author: 'maya',
    status: 'complete',
    agentCount: 4,
    findingsConfirmed: 1,
    findingsRaised: 3,
    durationMs: 198_000,
    startedAt: new Date(T0 - 14_400_000).toISOString(),
    prNumber: 139,
  },
  {
    id: 'run_5a93',
    repo: REPO,
    sha: '90f4ac1177b2e8d5630cc4192fa8b70de51a3d6c',
    message: 'fix: clamp quantity stepper at stock level',
    branch: 'fix/qty-clamp',
    author: 'sam',
    status: 'failed',
    agentCount: 4,
    findingsConfirmed: 0,
    findingsRaised: 0,
    durationMs: 47_000,
    startedAt: new Date(T0 - 25_200_000).toISOString(),
    prNumber: null,
  },
  {
    id: 'run_4c71',
    repo: REPO,
    sha: '5b2e9017ccaa4f38d1760be2390fa4c8117d0e44',
    message: 'feat: gift wrap option at checkout',
    branch: 'feat/gift-wrap',
    author: 'maya',
    status: 'complete',
    agentCount: 4,
    findingsConfirmed: 1,
    findingsRaised: 2,
    durationMs: 233_000,
    startedAt: new Date(T0 - 39_600_000).toISOString(),
    prNumber: 131,
  },
];

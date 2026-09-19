import { AssignmentSchema } from "@aftershock/schema/browser";
import { runDifferential } from "./differential.js";

const B = "https://demo-site-hazel-beta.vercel.app";

const journey = (id: string, route: string) =>
  AssignmentSchema.parse({
    id, runId: `probe-${Date.now()}`, archetype: "differential", route,
    objective: "Open a product and add it to the cart",
    journey: [{ instruction: "Click the add to cart button" }],
  });

async function run(label: string, a: ReturnType<typeof journey>, preview: string, base: string) {
  const r = await runDifferential({ assignment: a, previewUrl: preview, baseUrl: base, emit: () => undefined });
  const unclaimed = r.deltas.filter((d) => d.classification === "unclaimed");
  console.log(`\n### ${label}`);
  console.log(`   deltas ${r.deltas.length} | dismissed ${r.noiseFiltered} | unclaimed ${unclaimed.length} | findings ${r.findings.length}`);
  for (const d of unclaimed.slice(0, 5)) {
    console.log(`     ${d.channel}: ${d.base.slice(0, 40)}  ->  ${d.preview.slice(0, 40)}`);
  }
  for (const f of r.findings.slice(0, 3)) console.log(`     [${f.severity}] ${f.summary.slice(0, 95)}`);
  return r;
}

// 1. The same page against itself on a real React app — must find nothing.
await run("CANARY: same product, same deployment", journey("canary", "/products/wool-scarf"), B, B);

// 2. Two different products: identical layout, different content. This is the
//    shape of a value regression ($132.00 vs $NaN) without needing one.
// Route differs per side, so build two assignments and compare their results.
import { compareResults } from "./comparator.js";
import { runAssignment } from "./harness.js";
const scarf = await runAssignment({ assignment: journey("c1", "/products/wool-scarf"), targetUrl: B, mode: "plan", side: "preview", emit: () => undefined });
const mug = await runAssignment({ assignment: journey("c2", "/products/ceramic-mug"), targetUrl: B, mode: "plan", side: "base", emit: () => undefined });
const out = compareResults(mug, scarf, { route: "/products" });
const un = out.deltas.filter((d) => d.classification === "unclaimed");
console.log(`\n### CONTENT DELTA: ceramic-mug (base) vs wool-scarf (preview)`);
console.log(`   deltas ${out.deltas.length} | dismissed ${out.noiseFiltered} | unclaimed ${un.length} | findings ${out.findings.length}`);
for (const d of un.slice(0, 6)) console.log(`     ${d.channel}: ${d.base.slice(0, 38)}  ->  ${d.preview.slice(0, 38)}`);

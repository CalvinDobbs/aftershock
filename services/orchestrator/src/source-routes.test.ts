import { expect, it } from "vitest";
import { sourceRoutes } from "./source-routes.js";
const intent = { repo: "a/b", baseSha: "base", headSha: "head", messages: [], files: [{ filename: "lib/money.ts", status: "modified", additions: 1, deletions: 1 }] };
const fallback = [{ route: "/cart", confidence: .4, reason: "fallback: shared change" }];
it("traces a changed module through configured aliases to its untouched page", () => {
 const routes = sourceRoutes(intent, { "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }), "lib/money.ts": "export const price = 1", "hooks/total.ts": 'import { price } from "@/lib/money"', "app/cart/page.tsx": 'import {total} from "../../hooks/total"' }, fallback);
 expect(routes[0]?.confidence).toBe(.85); expect(routes[0]?.reason).toContain("app/cart/page.tsx -> hooks/total.ts -> lib/money.ts");
});
it("does not promote unresolved aliases or commented imports", () => {
 expect(sourceRoutes(intent, { "app/cart/page.tsx": '// import price from "../../lib/money"\nimport x from "@/lib/money"', "lib/money.ts": "" }, fallback)).toEqual(fallback);
});
it("retains stronger direct page evidence", () => { const direct = [{ route: "/cart", confidence: .95, reason: "direct" }]; expect(sourceRoutes(intent, { "app/cart/page.tsx": 'import x from "../../lib/money"', "lib/money.ts": "" }, direct)).toEqual(direct); });

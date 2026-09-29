// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { claimReload, isChunkLoadError } from "./lazy-with-reload";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function mem() {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

check("a stale-build import failure is recognised", () => {
	eq(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://lum.id/auth/assets/docs-abc.js")), true);
	eq(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'default')")), true);
	eq(isChunkLoadError(new Error("Loading chunk 42 failed.")), true);
});
check("an ordinary render error is not a chunk error", () => eq(isChunkLoadError(new Error("x is not a function")), false));
check("the first failure claims a reload", () => eq(claimReload(1_000_000, mem()), true));
check("a second failure within a minute does not reload again (no loop)", () => {
	const s = mem();
	eq(claimReload(1_000_000, s), true);
	eq(claimReload(1_030_000, s), false);
});
check("after the guard window a reload is allowed again", () => {
	const s = mem();
	claimReload(1_000_000, s);
	eq(claimReload(1_061_000, s), true);
});
check("no storage (private mode) never reloads", () => eq(claimReload(1, null), false));

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;

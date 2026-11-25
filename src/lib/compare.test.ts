// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { sideStats, compareVerdict } from "./compare";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const names = { a: "c16", b: "c32" };

check("stats", () => {
	const s = sideStats([1, 2, 3, NaN])!;
	eq([s.n, s.mean, s.min, s.max, s.latest, Number(s.sd.toFixed(3))], [3, 2, 1, 3, 3, 1]);
	eq(sideStats([]), null);
});
check("missing and too few say so", () => {
	eq(compareVerdict("goodput", null, null, "higher", names).text, "Neither has a goodput result yet");
	eq(compareVerdict("goodput", sideStats([1, 2, 3]), null, "higher", names).text, "c32 has no goodput result yet");
	eq(compareVerdict("goodput", sideStats([1, 2]), sideStats([5, 6, 7]), "higher", names).text, "Too few runs to tell yet (2 vs 3; 3 each needed)");
});
check("a gap inside the noise is not a win", () => {
	const v = compareVerdict("goodput", sideStats([10, 12, 9, 11]), sideStats([11, 9, 12, 10.5]), "higher", names);
	eq(v.tone, "attention");
	if (!v.text.startsWith("Can't tell apart yet")) throw new Error(v.text);
});
check("a clear gap names the side, the size and the runs; lower can be better", () => {
	const v = compareVerdict("goodput", sideStats([100, 101, 99]), sideStats([80, 81, 79]), "higher", names);
	eq([v.ahead, v.text], ["a", "c16 ahead on goodput by 20 (20%) — 3 vs 3 runs"]);
	const w = compareVerdict("TTFT p99", sideStats([1900, 1950, 1980]), sideStats([2600, 2700, 2650]), "lower", names);
	eq(w.ahead, "a");
	const sim = compareVerdict("objective", sideStats([5, 5, 5]), sideStats([7, 7, 7]), "higher", names); // deterministic simulator
	eq(sim.ahead, "b");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ compare: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

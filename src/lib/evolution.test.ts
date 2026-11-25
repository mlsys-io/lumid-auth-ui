// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { buildEvolution } from "./evolution";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const ts = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();

// Raw results: "a" collects 3 results, "b" 2; min_samples 2.
const raw = [
	{ id: "a", points: [{ ts: ts(1), v: 1 }, { ts: ts(3), v: 3 }, { ts: ts(5), v: 5 }] },
	{ id: "b", points: [{ ts: ts(2), v: 10 }, { ts: ts(4), v: 6 }] },
];

check("points are running means, counted once n ≥ min_samples", () => {
	const e = buildEvolution(raw, { minSamples: 2 })!;
	eq(e.points.map((p) => [p.arm, p.mean, p.n, p.counted]), [["a", 1, 1, false], ["b", 10, 1, false], ["a", 2, 2, true], ["b", 8, 2, true], ["a", 3, 3, true]]);
});
check("the frontier counts everyone; the best line only counted versions", () => {
	const e = buildEvolution(raw, { minSamples: 2 })!;
	eq(e.frontier.map((s) => [s.arm, s.value]), [["a", 1], ["b", 10], ["b", 8]]);
	eq(e.best.map((s) => [s.arm, s.value]), [["a", 2], ["b", 8]]);
	eq(e.hero, { arm: "b", value: 8 });
});
check("lower is better flips the best", () => {
	const e = buildEvolution(raw, { minSamples: 2, higherIsBetter: false })!;
	eq(e.hero, { arm: "a", value: 3 });
});
check("running-mean input is taken as is (state.history)", () => {
	const e = buildEvolution([{ id: "a", points: [{ ts: ts(1), v: 0.5, n: 10 }, { ts: ts(2), v: 0.6, n: 20 }] }], { runningMean: true, minSamples: 12 })!;
	eq(e.points.map((p) => [p.mean, p.n, p.counted]), [[0.5, 10, false], [0.6, 20, true]]);
	eq(e.best.map((s) => s.value), [0.6]);
});
check("chain: order of first result, states in words", () => {
	const e = buildEvolution(raw, { minSamples: 3, declaredArms: ["a", "b", "c"] })!;
	eq(e.chain.map((c) => [c.arm, c.state]), [["a", "best so far"], ["b", "collecting"], ["c", "not run yet"]]);
	const d = buildEvolution(raw, { minSamples: 2, decided: true, winner: "b" })!;
	eq(d.chain.map((c) => c.state), ["dropped", "winning"]);
});
check("no points, no chart", () => eq(buildEvolution([{ id: "a", points: [] }], {}), null));

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

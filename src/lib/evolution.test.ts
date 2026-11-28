// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperimentRow } from "@/api/me";
import { dodge, fitLabel, gateLine, gateLineWords, gateThreshold, isBatch, newBestIndices, ordinal, placeLabels, targetLineWords, xAxis, yDomain, yTicks, zeroLine } from "./evolution-axis";
import { buildEvolution, chainHeadline, lastStepPoints, linkValueWords, marginWords, meansByStep, rowStep, seriesFromRows, shortDevice, stepOrder, stepPhrase, versionStepWords } from "./evolution";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }
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

// ── one number per version per step (2026-11-28) ─────────────────────────

const STEPS = [
	{ step: "simulate", metrics: [{ name: "goodput_tok_s" }, { name: "estimated_energy_j_per_req" }] },
	{ step: "sandbox", metrics: [{ name: "goodput_tok_s" }, { name: "estimated_energy_j_per_req" }, { name: "energy_j_per_req" }] },
];
const GPU = { measured_on: "NVIDIA GeForce RTX 5080 at office" };
const r = (v: string, d: number, m: Record<string, number>, dims: Record<string, string> = {}) =>
	({ ts: ts(d), variant_id: v, metrics: m, dims }) as MeExperimentRow;
// MLSys 9.1: 0.6B simulated 86.49, measured 75.31 on the card — once "80.9".
const A91 = [
	r("llm_0_6b", 1, { estimated_energy_j_per_req: 86.49 }, { stage: "simulate", stage_index: "1" }),
	r("llm_1_7b", 1, { estimated_energy_j_per_req: 276.9 }, { stage: "simulate", stage_index: "1" }),
	r("llm_0_6b", 2, { estimated_energy_j_per_req: 75.31, energy_j_per_req: 75.31 }, GPU),
	r("llm_1_7b", 3, { estimated_energy_j_per_req: 185.72, energy_j_per_req: 185.72 }, GPU),
	r("llm_4b", 2, { estimated_energy_j_per_req: 400 }, { stage: "simulate", stage_index: "1" }),
];

check("a row's step: its stage, its workflow, its index, else the step whose metrics it reports", () => {
	eq(rowStep(A91[0], STEPS), "simulate");
	eq(rowStep(A91[2], STEPS), "sandbox");
	eq(rowStep(r("x", 1, { goodput_tok_s: 1 }, { loop: "sandbox" }), STEPS), "sandbox");
	eq(rowStep(r("x", 1, { goodput_tok_s: 1 }, { stage_index: "1" }), STEPS), "simulate");
	eq(rowStep(r("x", 1, { other: 1 }), STEPS), "");
	eq(rowStep(r("x", 1, { other: 1 }), [{ step: "only" }]), "only");
	eq(stepOrder(A91, STEPS), ["simulate", "sandbox"]);
	eq(stepOrder(A91), ["simulate", ""], "no spec: the unnamed step last");
});

check("steps in words", () => {
	eq(shortDevice("NVIDIA GeForce RTX 5080 at office"), "RTX 5080");
	eq(stepPhrase("sandbox", [A91[2]]), "on the RTX 5080");
	eq(stepPhrase("simulate"), "simulated");
	eq(stepPhrase("dev_eval"), "at Dev eval");
	eq(stepPhrase(""), "");
});

check("means are keyed by (version, step), never averaged across steps", () => {
	const m = meansByStep(A91, "estimated_energy_j_per_req", STEPS);
	eq([m.get("llm_0_6b")!.get("simulate")!.mean, m.get("llm_0_6b")!.get("sandbox")!.mean], [86.49, 75.31]);
	const v = (x: number) => `${Math.round(x * 10) / 10} J per request`;
	eq(versionStepWords(A91, "llm_0_6b", "estimated_energy_j_per_req", v, (x) => String(Math.round(x * 10) / 10), STEPS), "75.3 J per request on the RTX 5080 · 86.5 simulated");
	eq(versionStepWords(A91, "llm_4b", "estimated_energy_j_per_req", v, undefined, STEPS), "400 J per request simulated");
	eq(versionStepWords(A91, "nope", "estimated_energy_j_per_req", v), "");
	const two: Array<{ step?: string; v: number }> = [{ step: "a", v: 1 }, { step: "b", v: 2 }];
	eq(lastStepPoints(two, ["a", "b"]), { points: [{ step: "b", v: 2 }], step: "b" });
	const none: Array<{ step?: string; v: number }> = [{ v: 1 }];
	eq(lastStepPoints(none), { points: [{ v: 1 }], step: null });
});

check("the story is told at the LAST step with data, and names it", () => {
	const { series, steps, stepLabels } = seriesFromRows(A91, "estimated_energy_j_per_req", STEPS);
	const e = buildEvolution(series, { higherIsBetter: false, steps, stepLabels, declaredArms: ["llm_1_7b", "llm_0_6b", "llm_4b"] })!;
	eq([e.step, e.stepLabel], ["sandbox", "on the RTX 5080"]);
	eq(e.hero, { arm: "llm_0_6b", value: 75.31 });
	const c06 = e.chain.find((c) => c.arm === "llm_0_6b")!;
	eq([c06.mean, c06.atSteps], [75.31, [{ step: "simulate", label: "simulated", mean: 86.49, n: 1 }]]);
	// a version only simulated has no number at the GPU step — its simulated one is shown, named
	const c4 = e.chain.find((c) => c.arm === "llm_4b")!;
	eq([c4.state, linkValueWords(c4, (x) => String(x))], ["not run yet", "400 simulated"]);
	// asked for the earlier step
	eq(buildEvolution(series, { higherIsBetter: false, steps, stepLabels, step: "simulate" })!.hero, { arm: "llm_0_6b", value: 86.49 });
});

// ── ties ─────────────────────────────────────────────────────────────────

const flat = (vals: Record<string, number[]>) => Object.entries(vals).map(([id, vs]) => ({ id, points: vs.map((v, i) => ({ ts: ts(i + 1), v })) }));

check("equal values are tied for best, not one best and the rest trying", () => {
	const e = buildEvolution(flat({ c4: [22.4], c8: [22.4], c16: [22.4], c4b: [19.2] }), {})!;
	eq(e.tie && [e.tie.arms.length, e.tie.value, e.tie.how], [3, 22.4, "equal"]);
	eq(Object.fromEntries(e.chain.map((c) => [c.arm, c.state])), { c16: "tied", c4: "tied", c4b: "trying", c8: "tied" });
	eq(chainHeadline(e, (a) => a.toUpperCase(), (v) => `${v} tok/s`), "Tied for best (3 at 22.4 tok/s)");
});

check("a declared secondary metric decides a tie", () => {
	const tieBreakers = [{ name: "ttft_ms_p99", label: "TTFT p99", unit: "ms", higherIsBetter: false, values: { c4: 900, c8: 700, c16: 1100 } }];
	const e = buildEvolution(flat({ c4: [22.4], c8: [22.4], c16: [22.4] }), { tieBreakers })!;
	eq(e.tie!.decidedBy && [e.tie!.decidedBy.arm, e.tie!.decidedBy.value], ["c8", 700]);
	eq(e.hero!.arm, "c8");
	eq(Object.fromEntries(e.chain.map((c) => [c.arm, c.state])), { c16: "tied", c4: "tied", c8: "best so far" });
	eq(chainHeadline({ chain: e.chain }, (a) => a.toUpperCase(), (v) => `${v} tok/s`), "Tied for best (3 at 22.4 tok/s) — TTFT p99 decides: C8");
	// a secondary that can't separate them either decides nothing
	const same = buildEvolution(flat({ c4: [22.4], c8: [22.4] }), { tieBreakers: [{ ...tieBreakers[0], values: { c4: 700, c8: 700 } }] })!;
	eq(same.tie!.decidedBy, undefined);
});

check("inside the noise is a tie; one result each under 2% can't be told apart", () => {
	const noisy = buildEvolution(flat({ a: [10, 12, 11], b: [11, 13, 12] }), {})!;
	eq([noisy.tie?.how, noisy.chain.map((c) => c.state)], ["noise", ["tied", "tied"]]);
	const near = buildEvolution(flat({ c12: [0.366], c16: [0.369] }), { higherIsBetter: false })!;
	eq(near.tie?.how, "near");
	ok(chainHeadline(near, (a) => a, (v) => String(v)).includes("can't tell apart yet"), "near words");
	const apart = buildEvolution(flat({ a: [10, 10, 10], b: [12, 12, 12] }), {})!;
	eq([apart.tie, apart.chain.map((c) => c.state)], [null, ["trying", "best so far"]]);
});

check("can't tell apart yet comes before dropped; the winner says by how much and on how many", () => {
	const e = buildEvolution(flat({ c12: [0.366], c16: [0.369], c4: [0.5] }), { higherIsBetter: false, decided: true, winner: "c12" })!;
	eq(e.chain.map((c) => c.state), ["winning", "can't tell apart yet", "dropped"]);
	const w = e.chain[0].margin!;
	eq([w.over, Math.round(w.gap * 1e4) / 1e4, Math.round(w.pct! * 10) / 10, w.n, w.overN, w.tie], ["c16", 0.003, 0.8, 1, 1, "near"]);
	eq(marginWords(w, (v) => `${Math.round(v * 1e4) / 1e4} J`), "by 0.003 J (0.8%) · 1 result each");
	eq(chainHeadline(e, (a) => a.toUpperCase(), (v) => `${Math.round(v * 1e4) / 1e4} J`), "Winning: C12 by 0.003 J (0.8%) · 1 result each — can't tell apart yet from C16");
	eq(marginWords({ over: "b", gap: 2, pct: 25, n: 3, overN: 1, tie: null }, String), "by 2 (25%) · 3 results vs 1");
});

// ── the chart's axes (lib/evolution-axis) ────────────────────────────────

// Quant "Strategy search" (2026-11-28): one version early, twelve in one batch.
const H1 = 3_600_000;
const batch = [{ id: "v0", points: [{ ts: new Date(Date.UTC(2026, 10, 25)).toISOString(), v: 0.4 }] },
	...Array.from({ length: 12 }, (_, k) => ({ id: `s${k}`, points: [{ ts: new Date(Date.UTC(2026, 10, 27) + k * 1000).toISOString(), v: k === 5 ? 1.3 : k === 2 ? 0.9 : -3 + k * 0.2 }] }))];

check("a batch: most versions' first results together; spread-out results are not", () => {
	const e = buildEvolution(batch, {})!;
	eq(isBatch(e.points), true, "12 of 13 within seconds");
	eq(isBatch([{ t: 0, arm: "a" }, { t: 1, arm: "b" }, { t: 2, arm: "c" }].map((p) => ({ ...p, t: p.t * 86_400_000 }))), false, "one a day");
	eq(isBatch([{ t: 5, arm: "a" }, { t: 5, arm: "b" }]), true, "one instant");
	eq(isBatch([{ t: 1, arm: "a" }, { t: 2, arm: "a" }]), false, "one version");
	eq(isBatch([{ t: 0, arm: "a" }, { t: 4 * 86_400_000, arm: "b" }, { t: 4 * 86_400_000, arm: "c" }]), false, "two of three together is not a batch");
	// Later results of the same versions don't make it a batch: FIRST results count.
	eq(isBatch([{ t: 0, arm: "a" }, { t: 10 * H1, arm: "b" }, { t: 20 * H1, arm: "c" }, { t: 20 * H1 + 1, arm: "a" }, { t: 20 * H1 + 2, arm: "b" }]), false, "first results apart");
});

check("a batch lays x out in the order tried; the best line steps at the result that moved it", () => {
	const e = buildEvolution(batch, {})!;
	const ax = xAxis(e, Date.UTC(2026, 10, 28), () => "day");
	eq([ax.mode, ax.p0, ax.p1, ax.start, ax.end, ax.showNow], ["order", -0.5, 12.5, "1st", "13th", false]);
	eq(ax.pointPos, e.points.map((_, i) => i), "one slot per result: dots never stack");
	ok(ax.caption.includes("in the order tried"), "caption says so");
	eq(e.best.map((s) => [s.arm, s.i]), [["v0", 0], ["s2", 3], ["s5", 6]]);
	eq(e.best.map((s) => ax.stepPos(s)), [0, 3, 6]);
	eq([...newBestIndices(e.best)], [0, 3, 6]);
});

check("a spread-out experiment keeps a time axis, reaching now only when recent", () => {
	const e = buildEvolution(raw, { minSamples: 2 })!;
	const recent = xAxis(e, e.t1 + 86_400_000, () => "D");
	eq([recent.mode, recent.end, recent.showNow, recent.p1], ["time", "now", true, e.t1 + 86_400_000]);
	const old = xAxis(e, e.t1 + 30 * 86_400_000, (t) => (t === e.t1 ? "last" : "first"));
	eq([old.start, old.end, old.showNow, old.caption], ["first", "last", false, ""]);
});

check("ordinals", () => {
	eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
});

check("y ticks: the lowest and highest result and 0, with a zero line, when the range crosses it", () => {
	const pts = [-3, -0.4, 0.9, 1.66].map((mean, i) => ({ arm: `a${i}`, mean, counted: true }));
	const dom = yDomain(pts);
	eq([dom.lo, dom.hi], [-3, 1.66]);
	const t = yTicks(dom);
	ok(t.some((x) => x.kind === "max" && x.value === 1.66), "max");
	ok(t.some((x) => x.kind === "min" && x.value === -3), "min");
	ok(t.some((x) => x.kind === "zero" && x.value === 0), "zero");
	ok(t.every((x, i) => i === 0 || t[i - 1].value > x.value), "highest first");
	ok(t.every((x, i) => i === 0 || t[i - 1].value - x.value >= 0.1 * (dom.v1 - dom.v0)), "never crowded");
	eq(zeroLine(dom), true);
	const pos = yDomain([2, 3, 5].map((mean, i) => ({ arm: `a${i}`, mean, counted: true })));
	eq([yTicks(pos).some((x) => x.kind === "zero"), zeroLine(pos)], [false, false]);
	// A min just under 0 crowds the 0 label away, but the line stays.
	const near = yDomain([-0.05, 4, 5].map((mean, i) => ({ arm: `a${i}`, mean, counted: true })));
	eq([yTicks(near).filter((x) => x.kind !== "round").map((x) => x.kind), zeroLine(near)], [["max", "min"], true]);
	// The target and pass mark are always inside the range.
	const withGate = yDomain([2, 3].map((mean, i) => ({ arm: `a${i}`, mean, counted: true })), [0, null, 4]);
	ok(withGate.v0 < 0 && withGate.v1 > 4, "extras in range");
	eq([withGate.lo, withGate.hi], [2, 3]);
});

check("a gate's pass mark for one metric, in words", () => {
	eq(gateThreshold("sharpe_is_phase_mean >= 0.5 and trades >= 30", "trades"), { op: ">=", value: 30 });
	eq(gateThreshold("dsr_p < 0.05 and oos_sharpe > 0", "oos_sharpe"), { op: ">", value: 0 });
	eq(gateThreshold("0.5 <= score", "score"), { op: ">=", value: 0.5 });
	eq(gateThreshold("(score > -1.5) && n >= 3", "score"), { op: ">", value: -1.5 });
	eq(gateThreshold("sharpe_is_phase_mean >= 0.5", "sharpe"), null, "a longer name is another metric");
	eq(gateThreshold("a > 1 or b > 2", "a"), null, "an alternative is not a mark");
	eq(gateThreshold(undefined, "a"), null);
	const steps = [{ step: "bar_backtest", gate: "sharpe >= 0.5" }, { step: "robustness", gate: "dsr_p < 0.05 and oos_sharpe > 0" }];
	eq(gateLine(steps, "oos_sharpe", "robustness"), { op: ">", value: 0, step: "robustness" });
	eq(gateLine(steps, "sharpe", "robustness"), null, "another step's mark judges another number");
	eq(gateLine(steps, "sharpe", null), { op: ">=", value: 0.5, step: "bar_backtest" });
	eq(gateLineWords({ op: ">", step: "robustness" }, "0"), "above 0 to pass Robustness");
	eq(gateLineWords({ op: ">=", step: "bar_backtest" }, "0.5"), "at least 0.5 to pass Bar backtest");
	eq(targetLineWords("1.5"), "aiming for 1.5");
});

check("takeover labels name the version, cut to fit, never on top of each other", () => {
	eq(fitLabel("Lowvol top", 100), { text: "Lowvol top", cut: false });
	eq(fitLabel("Lowvol top", 30), { text: "Lowv…", cut: true });
	const box = { left: 40, right: 400, top: 14, bottom: 194 };
	// The line climbs to the next takeover: the name goes BELOW, with the room to the right edge.
	const [a, b] = placeLabels([{ x: 100, y: 100, text: "Lowvol top" }, { x: 120, y: 80, text: "Momentum 12-1" }], box);
	eq([a.text, a.anchor, a.x, a.y], ["Lowvol top", "start", 104, 112]);
	eq([b.text, b.anchor, b.y], ["Momentum 12-1", "start", 74], "the last one sits above its line");
	// Lower is better: the line falls to the next one, so the name goes above.
	eq(placeLabels([{ x: 100, y: 80, text: "A" }, { x: 120, y: 100, text: "B" }], box)[0].y, 74);
	// Near the right edge: to the mark's left; with no room either side: cut, full name kept.
	const [c] = placeLabels([{ x: 395, y: 100, text: "Lowvol top" }], box);
	eq([c.anchor, c.text, c.x], ["end", "Lowvol top", 391]);
	const [d] = placeLabels([{ x: 60, y: 100, text: "Lowvol top" }], { ...box, right: 90 });
	eq([d.text, d.cut, d.full, d.anchor], ["Low…", true, "Lowvol top", "start"]);
	// Two names at one spot: the second moves a line further out.
	const stack = placeLabels([{ x: 100, y: 100, text: "One" }, { x: 100, y: 101, text: "Two" }], box);
	ok(Math.abs(stack[0].y - stack[1].y) >= 11, "same spot: moved a line");
});

check("dots at one spot are nudged apart", () => {
	eq(dodge([{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 50, y: 10 }]), [0, 4, -4, 0]);
});

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

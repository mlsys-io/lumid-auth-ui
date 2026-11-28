// evolution-axis — layout decisions for the "How it evolved" chart
// (BestScoreChart), kept pure and tested (evolution.test.ts).
//
// Round-2 audit (2026-11-28, Quant "Strategy search", 13 versions): twelve
// versions ran in one batch, so on a time axis they all landed at ONE x — a
// vertical stack of small squares; the takeover labels read "v1 / v2 / v3" and
// were never explained; the only y tick was "1.66"; no zero line though values
// went negative; no line for the pass mark. The rules since:
//
//   • When most versions' first results arrived together (a batch), the x
//     axis is the ORDER TRIED (1st, 2nd … result), and the caption says so.
//   • Takeover labels name the version; a label that won't fit is cut with an
//     ellipsis (the chart keeps the full name as a tooltip).
//   • The y axis always marks the lowest and highest value drawn, and 0 when
//     the range crosses it (with a zero line).
//   • A declared target and a gate's pass mark for this metric are lines
//     labelled in words ("aiming for 1.5", "above 0 to pass Robustness").
//   • Dots never stack invisibly: rank spacing in order mode, a small sideways
//     dodge on a time axis.

import type { EvoPoint, StepPoint } from "@/lib/evolution";
import { humanId } from "@/lib/research-map";

// ── x: time, or the order tried ─────────────────────────────────────────

export type AxisMode = "time" | "order";

/**
 * Did most versions' FIRST results arrive together? True when at least
 * `share` (60%) of the versions' first results fall inside one window of
 * `window` (5%) of the whole span — or every result shares one instant — and
 * that group is three versions or more (both, when there are two). A time
 * axis would stack those versions at one x.
 */
export function isBatch(points: Array<Pick<EvoPoint, "t" | "arm">>, opts: { share?: number; window?: number } = {}): boolean {
	const share = opts.share ?? 0.6, frac = opts.window ?? 0.05;
	const first = new Map<string, number>();
	for (const p of points) if (Number.isFinite(p.t) && (!first.has(p.arm) || p.t < first.get(p.arm)!)) first.set(p.arm, p.t);
	const ts = [...first.values()].sort((a, b) => a - b);
	if (ts.length < 2) return false;
	// A batch is at least three versions — or every version, when there are two.
	const least = Math.min(3, ts.length);
	const all = points.map((p) => p.t).filter(Number.isFinite);
	const span = Math.max(...all) - Math.min(...all);
	const w = span * frac;
	let most = 0;
	for (let i = 0, j = 0; j < ts.length; j++) {
		while (ts[j] - ts[i] > w) i++;
		most = Math.max(most, j - i + 1);
	}
	return most >= least && most / ts.length >= share;
}

/** 1 → "1st", 2 → "2nd", 13 → "13th", 22 → "22nd". */
export function ordinal(n: number): string {
	const k = Math.abs(n) % 100;
	const s = k >= 11 && k <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] ?? "th";
	return `${n}${s}`;
}

export interface XAxis {
	mode: AxisMode;
	/** Domain ends, in the axis's own unit (ms, or result index ± ½). */
	p0: number; p1: number;
	/** Each point's position (same order as `evo.points`). */
	pointPos: number[];
	/** Where a best-so-far / frontier step sits. */
	stepPos: (s: StepPoint) => number;
	/** The words under the axis, left and right. */
	start: string; end: string;
	/** Draw the "now" cursor at p1 (time axis stretched to today). */
	showNow: boolean;
	/** "" on a time axis; on an order axis: "left to right in the order tried — most ran together". */
	caption: string;
}

/**
 * The chart's x axis. Order tried when the results came in a batch (`isBatch`),
 * else time — stretched to `now` when the last result is under a week old, so
 * the best-so-far line visibly reaches the present.
 */
export function xAxis(evo: { points: EvoPoint[]; t0: number; t1: number }, now: number, day: (t: number) => string): XAxis {
	const n = evo.points.length;
	if (isBatch(evo.points)) {
		// A step that names no index sits at the first result at or after its moment.
		const at = (s: StepPoint) => s.i ?? Math.max(0, evo.points.findIndex((p) => p.t >= s.t));
		return {
			mode: "order", p0: -0.5, p1: n - 0.5,
			pointPos: evo.points.map((_, i) => i), stepPos: at,
			start: ordinal(1), end: n > 1 ? ordinal(n) : "",
			showNow: false,
			caption: "left to right in the order tried — most ran together",
		};
	}
	const recent = now - evo.t1 < 7 * 86_400_000;
	const tEnd = recent ? Math.max(evo.t1, now) : evo.t1;
	return {
		mode: "time", p0: evo.t0, p1: tEnd === evo.t0 ? evo.t0 + 1 : tEnd,
		pointPos: evo.points.map((p) => p.t), stepPos: (s) => s.t,
		start: day(evo.t0), end: recent ? "now" : day(evo.t1),
		showNow: recent,
		caption: "",
	};
}

/** The indices (into `points`) of the results that made a new best. */
export function newBestIndices(best: StepPoint[]): Set<number> {
	return new Set(best.map((s) => s.i).filter((i): i is number => typeof i === "number"));
}

/**
 * Sideways offsets so dots at (nearly) the same spot never hide each other:
 * the k-th dot within `r` px of an earlier one moves ±r·⌈k/2⌉ (right, left,
 * further right…). Positions in px; returns one dx per dot.
 */
export function dodge(xy: Array<{ x: number; y: number }>, r = 4): number[] {
	return xy.map((p, i) => {
		let k = 0;
		for (let j = 0; j < i; j++) if (Math.abs(xy[j].x - p.x) < r && Math.abs(xy[j].y - p.y) < r) k++;
		return k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * r;
	});
}

// ── y: domain and ticks ─────────────────────────────────────────────────

/**
 * The value range to draw. Each version's first two averages are left out
 * (an average of one or two results swings and would set the scale), unless
 * they already count; `extra` (target, pass mark) is always in. `lo`/`hi` are
 * the lowest and highest RESULT drawn; `v0`/`v1` add 15% padding.
 */
export function yDomain(points: Array<Pick<EvoPoint, "arm" | "mean" | "counted">>, extra: Array<number | null | undefined> = []): { v0: number; v1: number; lo: number; hi: number } {
	const seen = new Map<string, number>();
	const vs: number[] = [];
	for (const p of points) { const k = (seen.get(p.arm) ?? 0) + 1; seen.set(p.arm, k); if (k > 2 || p.counted) vs.push(p.mean); }
	if (!vs.length) vs.push(...points.map((p) => p.mean));
	const finite = vs.filter(Number.isFinite);
	const lo = finite.length ? Math.min(...finite) : 0, hi = finite.length ? Math.max(...finite) : 0;
	const all = [...finite, ...extra.filter((x): x is number => typeof x === "number" && Number.isFinite(x))];
	let v0 = all.length ? Math.min(...all) : 0, v1 = all.length ? Math.max(...all) : 1;
	const pad = (v1 - v0) * 0.15 || Math.abs(v1) * 0.1 || 1;
	v0 -= pad; v1 += pad;
	return { v0, v1, lo, hi };
}

/** Three or four round values spanning [lo, hi] (steps of 1, 2, 2.5 or 5 × 10^k). */
export function niceTicks(lo: number, hi: number): number[] {
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
	const raw = (hi - lo) / 3;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
	return out.length >= 2 ? out : [lo, hi];
}

export interface YTick { value: number; kind: "max" | "min" | "zero" | "round" }

/**
 * The y ticks: ALWAYS the highest and lowest result drawn, 0 when the range
 * crosses it, then round values where they don't crowd those — no two ticks
 * closer than `minGap` of the range (≈ a label's height). Highest first. (A
 * crowded 0 loses its label, never its line: `zeroLine`.)
 */
export function yTicks(dom: { v0: number; v1: number; lo: number; hi: number }, minGap = 0.1): YTick[] {
	const range = dom.v1 - dom.v0 || 1;
	const want: YTick[] = [{ value: dom.hi, kind: "max" }, { value: dom.lo, kind: "min" }];
	if (dom.v0 < 0 && dom.v1 > 0) want.push({ value: 0, kind: "zero" });
	for (const v of niceTicks(dom.v0, dom.v1)) want.push({ value: v, kind: "round" });
	const out: YTick[] = [];
	for (const t of want) {
		if (!Number.isFinite(t.value) || t.value < dom.v0 || t.value > dom.v1) continue;
		const same = out.find((o) => o.value === t.value);
		if (same) { if (t.kind === "zero") same.kind = "zero"; continue; }
		if (out.some((o) => Math.abs(o.value - t.value) < minGap * range)) continue;
		out.push({ ...t });
	}
	return out.sort((a, b) => b.value - a.value);
}

/** Draw a zero line: the range crosses 0. */
export function zeroLine(dom: { v0: number; v1: number }): boolean {
	return dom.v0 < 0 && dom.v1 > 0;
}

// ── reference lines: target and pass mark ───────────────────────────────

export type GateOp = ">=" | ">" | "<=" | "<";
const FLIP: Record<GateOp, GateOp> = { ">=": "<=", ">": "<", "<=": ">=", "<": ">" };

/**
 * The pass mark a gate sets on one metric: "sharpe >= 0.5 and trades >= 30"
 * → {op ">=", value 0.5} for "sharpe". Null when the gate doesn't constrain
 * the metric with a number, or offers an alternative ("or"), where one line
 * would not be the mark.
 */
export function gateThreshold(expr: string | null | undefined, metric: string): { op: GateOp; value: number } | null {
	const t = (expr || "").trim();
	if (!t || !metric || /\bor\b/i.test(t)) return null;
	const name = metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const num = "(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)";
	for (const clause of t.split(/\band\b|&&/i)) {
		const c = clause.trim().replace(/^\(+|\)+$/g, "").trim();
		let m = new RegExp(`^${name}\\s*(>=|<=|>|<)\\s*${num}$`).exec(c);
		if (m) return { op: m[1] as GateOp, value: Number(m[2]) };
		m = new RegExp(`^${num}\\s*(>=|<=|>|<)\\s*${name}$`).exec(c);
		if (m) return { op: FLIP[m[2] as GateOp], value: Number(m[1]) };
	}
	return null;
}

/**
 * The gate line to draw for this metric: the pass mark of the step the story
 * is told at, or — when results name no step — of the first step whose gate
 * sets one. A pass mark at ANOTHER step is not drawn: it judges a different
 * number.
 */
export function gateLine(steps: Array<{ step: string; gate?: string }>, metric: string, storyStep: string | null): { op: GateOp; value: number; step: string } | null {
	const cands = storyStep ? steps.filter((s) => s.step === storyStep) : steps;
	for (const s of cands) {
		const g = gateThreshold(s.gate, metric);
		if (g) return { ...g, step: s.step };
	}
	return null;
}

const OP_WORDS: Record<GateOp, string> = { ">=": "at least", ">": "above", "<=": "at most", "<": "below" };

/** "above 0 to pass Robustness" / "at least 0.5 to pass Bar backtest". */
export function gateLineWords(g: { op: GateOp; step: string }, value: string): string {
	return `${OP_WORDS[g.op]} ${value} to pass ${humanId(g.step)}`;
}

/** "aiming for 1.5" — the experiment's declared target. */
export function targetLineWords(value: string): string {
	return `aiming for ${value}`;
}

// ── labels ──────────────────────────────────────────────────────────────

/** A label cut to `maxPx` (at ~`pxPerChar` per character) with an ellipsis. */
export function fitLabel(s: string, maxPx: number, pxPerChar = 5.6): { text: string; cut: boolean } {
	const room = Math.floor(maxPx / pxPerChar);
	if (s.length <= room) return { text: s, cut: false };
	return { text: `${s.slice(0, Math.max(1, room - 1)).trimEnd()}…`, cut: true };
}

export interface PlacedLabel { x: number; y: number; text: string; full: string; cut: boolean; anchor: "start" | "end" }

/**
 * Where each takeover's name goes, in px. Beside its mark, on the side of the
 * line the line does NOT go next: below it when the next takeover is higher on
 * screen (the line climbs through the space above), above it otherwise — so a
 * name gets the room up to the right edge instead of the gap before the next
 * mark. Cut with an ellipsis to that room; flipped to the mark's left when the
 * right edge leaves too little; moved a line further out when it would overlap
 * a name already placed.
 */
export function placeLabels(marks: Array<{ x: number; y: number; text: string }>, box: { left: number; right: number; top: number; bottom: number }, opts: { pxPerChar?: number; lineH?: number; maxPx?: number } = {}): PlacedLabel[] {
	const ppc = opts.pxPerChar ?? 5.6, lineH = opts.lineH ?? 12, cap = opts.maxPx ?? 120;
	const placed: Array<{ x0: number; x1: number; y: number }> = [];
	return marks.map((m, i) => {
		const next = marks[i + 1];
		const below = !!next && next.y < m.y - 1;
		let anchor: "start" | "end" = "start";
		let lx = m.x + 4;
		let room = Math.min(cap, box.right - lx);
		const need = m.text.length * ppc;
		if (room < need && m.x - 4 - (box.left + 4) > room) { anchor = "end"; lx = m.x - 4; room = Math.min(cap, lx - box.left - 4); }
		const fit = fitLabel(m.text, Math.max(room, ppc * 2), ppc);
		const w = fit.text.length * ppc;
		const x0 = anchor === "start" ? lx : lx - w, x1 = x0 + w;
		const hits = (y: number) => placed.some((p) => p.x0 < x1 + 2 && x0 < p.x1 + 2 && Math.abs(p.y - y) < lineH - 1);
		const up = [m.y - 6, m.y - 6 - lineH, m.y - 6 - 2 * lineH];
		const down = [m.y + lineH, m.y + 2 * lineH, m.y + 3 * lineH];
		const tries = (below ? [...down, ...up] : [...up, ...down]).filter((y) => y >= box.top + 8 && y <= box.bottom - 2);
		const ly = tries.find((y) => !hits(y)) ?? (below ? Math.min(box.bottom - 2, m.y + lineH) : Math.max(box.top + 8, m.y - 6));
		placed.push({ x0, x1, y: ly });
		return { x: lx, y: ly, text: fit.text, full: m.text, cut: fit.cut, anchor };
	});
}

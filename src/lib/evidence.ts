// evidence — an experiment's results as a grid: each version × each feedback
// step of the workflow that runs it.
//
// One shape for every research app (round 10, 2026-11-28). A step that
// declares a `gate` says passed / failed (with the reason in words); a step
// without one says what it measured. An app with one ungated step reads as a
// scoreboard; an app whose steps carry gates reads as a filter — same grid,
// no app-specific code. Nothing here knows what a step measures.
//
// Input is what the platform already serves: the spec's feedback steps and the
// experiment's ledger rows (`me.experiment(app, id).results`). A row names its
// step with `dims.stage` (+ `stage_index`, `passed`, `reason`) and may carry
// `metrics.cost_usd` / `metrics.duration_s`. An app whose rows name no step at
// all is measured by its one (first) step. Pure functions only; the words live
// here, tested, never inline.

import { parseDocument } from "yaml";
import type { MeExperiment, MeExperimentRow } from "@/api/me";
import type { AppSpec, FeedbackMetric, FeedbackStep } from "@/lib/app-spec";
import { experimentLoop, humanId } from "@/lib/research-map";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";

/** A feedback step as the grid needs it. */
export interface EvidenceStepSpec { step: string; gate?: string; metrics: Array<Pick<FeedbackMetric, "name"> & Partial<Omit<FeedbackMetric, "name">>> }

/** A feedback step's gate, if it declares one. (`gate` is newer than
 *  FeedbackStep's type, so it is read defensively.) */
export function gateOf(step: FeedbackStep | EvidenceStepSpec): string | undefined {
	const g = (step as { gate?: unknown }).gate;
	return typeof g === "string" && g.trim() ? g.trim() : undefined;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `{workflow id → {step → gate}}` straight from the spec's text — for a
 *  spec reader that drops the `gate` key. Never throws. */
export function gatesFromText(text: string): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	let d: unknown;
	try { d = parseDocument(text || "").toJS(); } catch { return out; }
	const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
	for (const w of [...arr(o.workflows), ...arr(o.loops)]) {
		if (!w || typeof w !== "object") continue;
		const wo = w as Record<string, unknown>;
		const id = String(wo.id ?? wo.name ?? "");
		for (const f of arr(wo.feedback)) {
			const fo = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
			if (id && typeof fo.step === "string" && typeof fo.gate === "string" && fo.gate.trim()) (out[id] ??= {})[fo.step] = fo.gate.trim();
		}
	}
	return out;
}

/** The feedback steps of the workflow that runs an experiment, in order, with
 *  their gates. Empty when the workflow declares none. */
export function experimentSteps(spec: AppSpec | null | undefined, e: MeExperiment, specText?: string): EvidenceStepSpec[] {
	const loop = experimentLoop(e);
	const wf = spec?.workflows.find((w) => w.id === loop);
	if (!wf?.feedback.length) return [];
	const fromText = specText ? gatesFromText(specText)[loop] ?? {} : {};
	return wf.feedback.map((f) => {
		const gate = gateOf(f) ?? fromText[f.step];
		return { step: f.step, metrics: f.metrics, ...(gate ? { gate } : {}) };
	});
}

// ── words ────────────────────────────────────────────────────────────────

const OPS: Record<string, string> = { ">=": "≥", "<=": "≤", "==": "=", "!=": "≠" };
const KEYWORDS = new Set(["and", "or", "not", "true", "false", "in", "is"]);

/** A gate or a reason in words: "score >= 0.5 and trades >= 30" →
 *  "Score ≥ 0.5 and trades ≥ 30"; names become labels, never snake_case. */
export function ruleInWords(expr: string): string {
	const t = (expr || "").trim();
	if (!t) return "";
	let first = true;
	const out = t.replace(/[A-Za-z_][A-Za-z0-9_.]*|>=|<=|==|!=/g, (tok) => {
		if (OPS[tok]) return OPS[tok];
		if (KEYWORDS.has(tok.toLowerCase())) { first = false; return tok.toLowerCase(); }
		const label = humanMetric(tok).label;
		// Keep an acronym's case ("SLA", "P99"); lower an ordinary word mid-sentence.
		const keep = first || /^[A-Z0-9]{2,}/.test(label);
		first = false;
		return keep ? label : label.charAt(0).toLowerCase() + label.slice(1);
	});
	return out.charAt(0).toUpperCase() + out.slice(1);
}

/** "$3.20" · "<$0.01" · "$0" · "$1,204". */
export function usd(x: number): string {
	if (!Number.isFinite(x) || x <= 0) return "$0";
	if (x < 0.01) return "<$0.01";
	if (x >= 1000) return `$${Math.round(x).toLocaleString("en-US")}`;
	return `$${x.toFixed(2)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── the grid ─────────────────────────────────────────────────────────────

export type CellState = "passed" | "failed" | "measured" | "running" | "not run";

export interface EvidenceCell {
	state: CellState;
	/** The newest result's numbers. */
	metrics: Record<string, number>;
	/** The step's key number for this version: the mean over its results. */
	value: number | null;
	/** Why it failed the gate, in words. */
	reason?: string;
	cost_usd: number;
	/** Results recorded at this step (reruns included). */
	n: number;
}

export interface EvidenceStep {
	step: string;
	/** The step in words ("Full run"). */
	label: string;
	gated: boolean;
	/** "Passes when score ≥ 0.5" — only for a gated step. */
	gateText?: string;
	/** The number its cells show, and how to read it. */
	metric: string;
	metricLabel: string;
	unit: string;
	higherIsBetter: boolean;
	runs: number;
	cost_usd: number;
	duration_s: number;
	n_passed?: number;
	n_failed?: number;
}

export interface EvidenceNext { step: string; label: string; versions: string[]; labels: string[]; runs: number }

export interface Evidence {
	steps: EvidenceStep[];
	/** Versions in order (declared first, then any seen only in results). */
	versions: Array<{ id: string; label: string }>;
	cells: Map<string, Map<string, EvidenceCell>>;
	/** The best number at the furthest step anything (not failed) reached. */
	best: { version: string; step: string; metric: string; value: number } | null;
	/** Versions ready for the next step: they passed (or were measured at) step k
	 *  and have no result at k+1. Furthest step first. Nothing runs without a press. */
	next: EvidenceNext[];
	/** Results that name a step this workflow doesn't declare (not drawn). */
	unplaced: number;
	/** No result rows were served: the numbers are the state's per-version means. */
	fromState: boolean;
	cost_usd: number;
}

/** Marks a stand-in row made from the state's per-version mean. */
const AGG = "__from_state";
const BOOKKEEPING = new Set(["cost_usd", "duration_s", "stage_passed"]);
const tsNum = (ts?: string): number => {
	if (!ts) return NaN;
	const n = Number(ts);
	if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
	return Date.parse(ts) / 1000;
};
const truthy = (v: unknown): boolean | null => {
	if (v == null || v === "") return null;
	const s = String(v).trim().toLowerCase();
	if (/^(1|true|yes|pass|passed)$/.test(s)) return true;
	if (/^(0|false|no|fail|failed|filtered)$/.test(s)) return false;
	return null;
};
/** Explicit dims.passed, else metrics.stage_passed; a row that says neither passed. */
function rowPassed(r: MeExperimentRow): boolean {
	const d = truthy(r.dims?.passed);
	if (d != null) return d;
	const m = r.metrics?.stage_passed;
	return typeof m === "number" ? m >= 1 : true;
}

export function evidenceOf(input: {
	steps: EvidenceStepSpec[];
	versions: Array<{ id: string; label?: string }>;
	rows: MeExperimentRow[];
	/** Versions with a run going or queued right now. */
	running?: Set<string>;
	/** The experiment's own metric: what an unnamed-step result is measured by. */
	metric?: string;
	higherIsBetter?: boolean;
	/** Per-version means the experiment state already holds (`e.variants`):
	 *  used, at the step that reports the metric, only when no result row is
	 *  served (identity returns rows only for the ledger it can read). */
	aggregates?: Record<string, { n: number; mean: number }>;
}): Evidence {
	const running = input.running ?? new Set<string>();
	// No feedback declared: the experiment's metric is the one step.
	const specSteps: EvidenceStepSpec[] = input.steps.length ? input.steps : [{ step: input.metric || "result", metrics: input.metric ? [{ name: input.metric }] : [] }];
	const idx = new Map(specSteps.map((s, i) => [s.step, i]));
	const staged = input.rows.some((r) => !!r.dims?.stage);
	// An app whose results name no step is measured by the step that reports its
	// metric (else the first). Once any result names a step, unnamed ones aren't guessed.
	const homeStep = Math.max(0, specSteps.findIndex((s) => !!input.metric && s.metrics.some((m) => m.name === input.metric)));
	let unplaced = 0;
	const stepOf = (r: MeExperimentRow): number => {
		const st = r.dims?.stage;
		if (st) return idx.has(st) ? idx.get(st)! : -1;
		const k = Number(r.dims?.stage_index);
		if (Number.isInteger(k) && k >= 1 && k <= specSteps.length) return k - 1;
		return staged ? -1 : homeStep;
	};

	const rowsAt = new Map<string, MeExperimentRow[][]>();
	const sorted = [...input.rows].sort((a, b) => (tsNum(a.ts) || 0) - (tsNum(b.ts) || 0));
	for (const r of sorted) {
		if (!r.variant_id) continue;
		const k = stepOf(r);
		if (k < 0) { unplaced++; continue; }
		const slots = rowsAt.get(r.variant_id) ?? specSteps.map(() => []);
		slots[k].push(r);
		rowsAt.set(r.variant_id, slots);
	}

	// No rows to place, but the state has each version's mean: one number per
	// version at the metric's step (never a pass/fail — no row says so).
	const fromState = !rowsAt.size && !!input.aggregates && !!input.metric;
	if (fromState) {
		for (const [v, a] of Object.entries(input.aggregates ?? {})) {
			if (!a || !(a.n > 0) || a.mean == null || !Number.isFinite(a.mean)) continue;
			const slots = specSteps.map(() => [] as MeExperimentRow[]);
			slots[homeStep] = Array.from({ length: a.n }, () => ({ ts: "", variant_id: v, metrics: { [input.metric!]: a.mean }, dims: { [AGG]: "1" } }));
			rowsAt.set(v, slots);
		}
	}
	const keyMetric = (s: EvidenceStepSpec, k: number): string => {
		if (input.metric && (s.metrics.some((m) => m.name === input.metric) || (!staged && k === homeStep))) return input.metric;
		if (s.metrics[0]?.name) return s.metrics[0].name;
		for (const slots of rowsAt.values()) for (const r of slots[k]) for (const key of Object.keys(r.metrics || {})) if (!BOOKKEEPING.has(key)) return key;
		return "";
	};
	const steps: EvidenceStep[] = specSteps.map((s, k) => {
		const metric = keyMetric(s, k);
		const declared = s.metrics.find((m) => m.name === metric);
		const h = metric ? humanMetric(metric) : { label: "", unit: "" };
		const gate = gateOf(s);
		const higher = declared?.better ? declared.better !== "lower" : metric === input.metric ? input.higherIsBetter ?? true : true;
		return {
			step: s.step, label: input.steps.length ? humanId(s.step) : h.label || "Result", gated: !!gate,
			...(gate ? { gateText: `Passes when ${ruleInWords(gate).replace(/^./, (c) => c.toLowerCase())}` } : {}),
			metric, metricLabel: h.label, unit: h.unit, higherIsBetter: higher,
			runs: 0, cost_usd: 0, duration_s: 0, ...(gate ? { n_passed: 0, n_failed: 0 } : {}),
		};
	});

	const declared = input.versions.map((v) => ({ id: v.id, label: v.label || humanId(v.id) }));
	const versions = [...declared, ...[...rowsAt.keys()].filter((id) => !declared.some((v) => v.id === id)).map((id) => ({ id, label: humanId(id) }))];

	const cells = new Map<string, Map<string, EvidenceCell>>();
	for (const v of versions) {
		const slots = rowsAt.get(v.id) ?? specSteps.map(() => []);
		const row = new Map<string, EvidenceCell>();
		let open = true; // reached: every step before passed or was measured
		specSteps.forEach((s, k) => {
			const rs = slots[k];
			const st = steps[k];
			const cost = rs.reduce((a, r) => a + (Number(r.metrics?.cost_usd) > 0 ? Number(r.metrics.cost_usd) : 0), 0);
			const dur = rs.reduce((a, r) => a + (Number(r.metrics?.duration_s) > 0 ? Number(r.metrics.duration_s) : 0), 0);
			st.runs += rs.length; st.cost_usd += cost; st.duration_s += dur;
			const vals = rs.map((r) => r.metrics?.[st.metric]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
			const last = rs[rs.length - 1];
			let state: CellState;
			let reason: string | undefined;
			if (last) {
				const ok = rowPassed(last);
				state = last.dims?.[AGG] ? "measured" : st.gated ? (ok ? "passed" : "failed") : ok ? "measured" : "failed";
				if (state === "failed") reason = ruleInWords(String(last.dims?.reason ?? "")) || "Didn't pass — no reason recorded";
			} else {
				state = open && running.has(v.id) ? "running" : "not run";
			}
			if (st.gated && state === "passed") st.n_passed! += 1;
			if (st.gated && state === "failed") st.n_failed! += 1;
			if (state !== "passed" && state !== "measured") open = false;
			row.set(s.step, {
				state, metrics: { ...(last?.metrics ?? {}) }, value: vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : null,
				...(reason ? { reason } : {}), cost_usd: cost, n: rs.length,
			});
		});
		cells.set(v.id, row);
	}

	let best: Evidence["best"] = null;
	for (let k = steps.length - 1; k >= 0 && !best; k--) {
		const st = steps[k];
		for (const v of versions) {
			const c = cells.get(v.id)!.get(st.step)!;
			if (c.value == null || c.state === "failed") continue;
			if (!best || (st.higherIsBetter ? c.value > best.value : c.value < best.value)) best = { version: v.id, step: st.step, metric: st.metric, value: c.value };
		}
	}

	const next: EvidenceNext[] = [];
	for (let k = steps.length - 2; k >= 0; k--) {
		const ready = versions.filter((v) => {
			const c = cells.get(v.id)!;
			const here = c.get(steps[k].step)!.state;
			return (here === "passed" || here === "measured") && c.get(steps[k + 1].step)!.state === "not run";
		});
		if (ready.length) next.push({ step: steps[k + 1].step, label: steps[k + 1].label, versions: ready.map((v) => v.id), labels: ready.map((v) => v.label), runs: ready.length });
	}

	return { steps, versions, cells, best, next, unplaced, fromState, cost_usd: steps.reduce((a, s) => a + s.cost_usd, 0) };
}

// ── what the grid says ──────────────────────────────────────────────────

/** A cell's number as written: "1.42", "812 ms", "—". */
export function cellValue(c: EvidenceCell, s: EvidenceStep): string {
	return c.value == null ? "—" : fmtMetricValue(c.value, s.unit, s.metric);
}

/** A cell in a sentence (its tooltip and aria-label): "Full run: didn't pass —
 *  Score 0.21 < 0.5", "Sandbox: not run yet". */
export function cellWords(c: EvidenceCell, s: EvidenceStep): string {
	const num = c.value != null && s.metricLabel ? `${s.metricLabel} ${cellValue(c, s)}` : "";
	const runs = c.n > 1 ? ` (${c.n} results)` : "";
	switch (c.state) {
		case "passed": return `${s.label}: passed${num ? ` — ${num}` : ""}${runs}`;
		case "failed": return `${s.label}: didn't pass — ${c.reason}${runs}`;
		case "measured": return `${s.label}: ${num || "measured"}${runs}`;
		case "running": return `${s.label}: running now`;
		default: return `${s.label}: not run yet`;
	}
}

/** A step's footer: "12 runs · $0.40" — "results" when the numbers came
 *  from the state's means (a result isn't always its own run). */
export function stepFootWords(s: EvidenceStep, fromState = false): string {
	if (!s.runs) return fromState ? "No results yet" : "No runs yet";
	const parts = [plural(s.runs, fromState ? "result" : "run")];
	if (s.cost_usd > 0) parts.push(usd(s.cost_usd));
	return parts.join(" · ");
}

/** "3 of 12 passed" for a gated step that has results; "" otherwise. */
export function stepPassWords(s: EvidenceStep): string {
	if (!s.gated) return "";
	const done = (s.n_passed ?? 0) + (s.n_failed ?? 0);
	return done ? `${s.n_passed} of ${done} passed` : "";
}

/** The one button: "Run the 3 ready versions through Sandbox (about 3 runs)". */
export function nextWords(n: EvidenceNext): string {
	const who = n.runs === 1 ? `Run ${n.labels[0]}` : `Run the ${n.runs} ready versions`;
	return `${who} through ${n.label} (about ${plural(n.runs, "run")})`;
}

/** Versions with a run going or queued for this experiment, from the app's queue. */
export function runningVersions(rows: Array<{ experiment_id?: string | null; state: string; variant_id?: string | null; branch_label?: string | null }>, experimentId: string): Set<string> {
	const out = new Set<string>();
	for (const r of rows) {
		if (r.experiment_id !== experimentId) continue;
		if (!/^(queued|pending|waiting|running|claimed|dispatched|started|in_progress)$/i.test(r.state || "")) continue;
		const v = r.variant_id || r.branch_label;
		if (v) out.add(v);
	}
	return out;
}

/** "Best so far: A — Held out score 0.7 at Stress test" (the step is named only
 *  when there is more than one). "" when nothing has a number yet. */
export function bestWords(ev: Evidence): string {
	const b = ev.best;
	if (!b) return "";
	const st = ev.steps.find((s) => s.step === b.step)!;
	const label = ev.versions.find((v) => v.id === b.version)?.label ?? humanId(b.version);
	const num = `${st.metricLabel} ${fmtMetricValue(b.value, st.unit, st.metric)}`;
	return `Best so far: ${label} — ${num}${ev.steps.length > 1 ? ` at ${st.label}` : ""}`;
}

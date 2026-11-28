// run-tables — the rows a run returned, as small tables, and the ids in its
// key/value column, as words (round 10 of the run page, 2026-11-28; generic).
//
// Apps return per-item results as arrays of flat objects: an MLSys sandbox run
// writes `workload_rows` and `resample_rows`, a calibrate run `energy_models`
// and `factors`. The run page showed none of them (or showed them as a wall of
// JSON); every such array is now a table with humanised headers. Pure; the
// words live here, RunAnswerCard only places them.

import type { MeCycleDetail } from "@/api/me";
import { fmtMetricValue, humanMetric, isFlagKey } from "@/lib/run-answer";
import { humanId } from "@/lib/research-map";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);

/**
 * An id-shaped value in words, decimal-aware: "llm_1_7b_c32" → "LLM 1.7B c32",
 * "baseline_model-llm-0_6b_max_concurrency-12" → "Baseline model LLM 0.6B max
 * concurrency 12", "nvml_counter" → "Nvml counter". Anything with a space, a
 * dot or other punctuation is already words (or a version like "protocol-v1.21")
 * and is left alone.
 */
export function humanValue(v: string): string {
	const t = v.trim();
	if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/.test(t) || !t.includes("_")) return t;
	// A hyphen between words is a separator here; inside "llm-0" it hides the
	// "0_6b" decimal from humanId, so it goes first.
	return humanId(t.replace(/-/g, "_")).replace(/\b(\d+\.\d+)([kmbt])\b/gi, (_m, n: string, s: string) => `${n}${s.toUpperCase()}`);
}

export interface RunTableColumn { key: string; label: string; numeric: boolean }
export interface RunTable {
	key: string;
	title: string;
	columns: RunTableColumn[];
	/** Cells as text, one array per row, in column order. */
	rows: string[][];
}

// Arrays the page already shows another way, or that are not per-item results.
const NOT_A_TABLE = /^(comparison|constraints|constraint_rows|stages|step_events|steps|events|expanded_args|undeclared_args|assumptions|decisions|offers|review_queue|memories_learned|files|compute_jobs)$/;
// The column that names a row, in order of preference.
const LEAD = ["name", "label", "model", "workload", "key", "kind", "metric", "id"];
const HASHY = /^(sha\d*:)?[0-9a-f]{16,}$/i;

const isScalar = (v: unknown) => v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function cell(v: unknown, col: string): string {
	if (v == null || v === "") return "—";
	if (typeof v === "boolean") return v ? "yes" : "no";
	if (typeof v === "number") return Number.isFinite(v) ? (isFlagKey(col) && (v === 0 || v === 1) ? (v ? "yes" : "no") : fmtMetricValue(v, "", col)) : "—";
	return humanValue(String(v));
}

/** "workload_rows" → "Workloads"; "energy_models" → "Energy models". */
export function tableTitle(key: string): string {
	const m = key.match(/^(.*)_rows$/);
	if (m) {
		const l = humanMetric(m[1]).label;
		return /s$/.test(l) ? l : `${l}s`;
	}
	return humanMetric(key).label;
}

/** Every top-level array of flat objects in the run's output, as a table.
 *  Nested values are left out (they are another table's business); columns
 *  that are empty in every row, hashes, and columns repeating an earlier one
 *  are dropped. An array of one row is still a table. */
export function runTables(d: MeCycleDetail | null): RunTable[] {
	if (!d) return [];
	const step = (d.steps || []).find((st) => obj(st.output));
	const out = obj(obj(step?.output)?.out) ?? obj(step?.output);
	const s = obj(d.summary) ?? {};
	const srcs = [out, obj(out?.metrics), obj(s.metrics), obj(obj(s.command_engine)?.metrics)];
	const tables: RunTable[] = [];
	const seen = new Set<string>();
	for (const src of srcs) {
		if (!src) continue;
		for (const [key, v] of Object.entries(src)) {
			if (seen.has(key) || NOT_A_TABLE.test(key) || !Array.isArray(v) || !v.length) continue;
			const rows = v.map(obj);
			if (rows.some((r) => !r)) continue;
			const objs = rows as Obj[];
			// Flat enough: at least two scalar fields per row on average.
			const scalarCount = objs.reduce((n, r) => n + Object.values(r).filter(isScalar).length, 0);
			if (scalarCount < objs.length * 2) continue;
			seen.add(key);
			const cols: string[] = [];
			for (const r of objs) for (const [k, x] of Object.entries(r)) if (isScalar(x) && !cols.includes(k)) cols.push(k);
			const kept: string[] = [];
			const sigs = new Set<string>();
			for (const c of cols) {
				const vals = objs.map((r) => r[c]);
				if (vals.every((x) => x == null || (typeof x === "string" && /^(|—|-|n\/a)$/i.test(x.trim())))) continue;
				if (vals.every((x) => x == null || (typeof x === "string" && HASHY.test(x.trim())))) continue;
				// Two columns saying the same thing in every row (kind = workload) —
				// only provable with 2+ rows: in one row, predicted "met" and
				// outcome "met" are two facts that happen to agree.
				const sig = JSON.stringify(vals);
				if (objs.length > 1 && sigs.has(sig)) continue;
				sigs.add(sig);
				kept.push(c);
			}
			if (!kept.length) continue;
			// What each row IS reads first (apps often write keys alphabetically).
			const lead = LEAD.find((k) => kept.includes(k));
			if (lead) kept.splice(0, kept.length, lead, ...kept.filter((k) => k !== lead));
			const columns = kept.map((c) => {
				const { label, unit } = humanMetric(c);
				const numeric = objs.every((r) => r[c] == null || typeof r[c] === "number");
				// The unit goes in the header once; cells carry the number.
				return { key: c, label: numeric && unit ? `${label} (${unit})` : label, numeric };
			});
			const t: RunTable = { key, title: tableTitle(key), columns, rows: objs.map((r) => kept.map((c) => cell(r[c], c))) };
			// Two lists about the same items (`workload_rows` and `workloads`,
			// same names in the same order) are one table, not two "Workloads".
			const twin = tables.find((x) => x.title === t.title && x.columns[0]?.key === t.columns[0]?.key && x.rows.length === t.rows.length
				&& x.rows.every((r, i) => r[0] === t.rows[i][0]));
			if (twin) {
				t.columns.forEach((c, j) => {
					if (j === 0 || twin.columns.some((x) => x.key === c.key)) return;
					twin.columns.push(c);
					twin.rows.forEach((r, i) => r.push(t.rows[i][j]));
				});
				continue;
			}
			tables.push(t);
		}
	}
	return tables;
}

/** The rows a table shows before "Show all N": all of them when they fit. */
export function visibleRows<T>(rows: T[], showAll: boolean, cap = 8): { rows: T[]; hidden: number } {
	if (showAll || rows.length <= cap + 1) return { rows, hidden: 0 };
	return { rows: rows.slice(0, cap), hidden: rows.length - cap };
}

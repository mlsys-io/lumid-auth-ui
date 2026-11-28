// run-agreement — one run's "this step said X, the next measured Y", and what
// the run cost (round 10, 2026-11-28; generic).
//
// Two sources, both conventions any app can adopt:
//   1. a `comparison` list in the run's output: rows of
//      {metric, predicted|simulated|expected, measured|actual|observed, gap?}
//      (MLSys sandbox runs write one; nothing rendered it before);
//   2. a chain run's stages (`summary.stages: [{loop, metrics}]`): consecutive
//      stages that report the same metric name.
// Usage: `summary.usage` / the output's `usage` (LumidOS sdk/apps/usage.py).
// Pure functions; the words live here.

import type { MeCycleDetail } from "@/api/me";
import { humanId } from "@/lib/research-map";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";
import { usageOf, usageWords, type Usage } from "@/lib/spend";

export interface AgreementRow { metric: string; first: string; second: string; gap: string }
export interface RunAgreement { firstLabel: string; secondLabel: string; rows: AgreementRow[]; headline: string }

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const NOT_A_RESULT = /^(cost_usd|duration_s|stage_passed|cpu_s|gpu_s|wall_s|saved_cpu_s|saved_gpu_s|objective|status|seed|n)$/;

function outputs(d: MeCycleDetail | null): Array<Record<string, unknown>> {
	const s = obj(d?.summary) ?? {};
	const step = (d?.steps || []).find((st) => obj(st.output));
	const inner = obj(obj(step?.output)?.out) ?? obj(step?.output);
	return [inner, obj(inner?.metrics), obj(s.command_engine), obj(obj(s.command_engine)?.metrics), obj(s.metrics), s].filter((x): x is Record<string, unknown> => !!x);
}

const pick = (r: Record<string, unknown>, keys: string[]): unknown => { for (const k of keys) if (k in r) return r[k]; return undefined; };
const text = (v: unknown, key: string): string => {
	if (typeof v === "number" && Number.isFinite(v)) return fmtMetricValue(v, humanMetric(key).unit, key);
	if (typeof v === "string" && v.trim()) return shareText(v.trim());
	return "—";
};

/** An app's own text for a share: "1 fraction" / "0.97 ratio" reads 100% / 97%. */
export function shareText(t: string): string {
	const m = /^(-?\d+(?:\.\d+)?)\s*(?:fraction|ratio|share)$/i.exec(t);
	if (!m) return t;
	const n = Number(m[1]);
	return Number.isFinite(n) && n >= 0 && n <= 1 ? `${Math.round(n * 1000) / 10}%` : t;
}
const gapOf = (a: unknown, b: unknown): string =>
	typeof a === "number" && typeof b === "number" && a !== 0 ? `${b >= a ? "+" : "−"}${Math.round(Math.abs(b / a - 1) * 100)}%` : "—";

/** The run's own `comparison` rows, if it wrote any. */
export function comparisonOf(d: MeCycleDetail | null): RunAgreement | null {
	for (const src of outputs(d)) {
		const raw = src.comparison;
		if (!Array.isArray(raw) || !raw.length) continue;
		const rows: AgreementRow[] = [];
		let firstKey = "", secondKey = "";
		for (const r of raw) {
			const o = obj(r);
			if (!o) continue;
			const metric = String(o.metric ?? o.name ?? "");
			if (!metric) continue;
			const fk = ["predicted", "simulated", "expected"].find((k) => k in o);
			const sk = ["measured", "actual", "observed"].find((k) => k in o);
			if (!fk || !sk) continue;
			firstKey ||= fk; secondKey ||= sk;
			const a = o[fk], b = o[sk];
			// A row that names its metric key gets the short label ("TTFT p99"),
			// not the app's long words ("Time to the first word, slowest 1%…").
			const key = typeof o.key === "string" && o.key ? o.key : /[_.]/.test(metric) ? metric : "";
			rows.push({ metric: key ? humanMetric(key).label : metric, first: text(a, key || metric), second: text(b, key || metric), gap: typeof o.gap === "string" ? o.gap : gapOf(a, b) });
		}
		if (!rows.length) continue;
		const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
		return { firstLabel: cap(firstKey), secondLabel: cap(secondKey), rows, headline: headlineOf(rows, cap(firstKey), cap(secondKey)) };
	}
	return null;
}

/** Consecutive chain stages that report the same metric. */
export function stagesAgreement(d: MeCycleDetail | null): RunAgreement | null {
	const stages = (obj(d?.summary)?.stages as unknown[] | undefined) ?? [];
	const done = stages.map(obj).filter((s): s is Record<string, unknown> => !!s && !!obj(s.metrics));
	for (let i = done.length - 1; i > 0; i--) {
		const a = obj(done[i - 1].metrics)!, b = obj(done[i].metrics)!;
		const keys = Object.keys(b).filter((k) => !NOT_A_RESULT.test(k) && typeof a[k] === "number" && typeof b[k] === "number");
		if (!keys.length) continue;
		const la = humanId(String(done[i - 1].loop ?? "earlier step")), lb = humanId(String(done[i].loop ?? "this step"));
		const rows = keys.map((k) => ({ metric: humanMetric(k).label, first: text(a[k], k), second: text(b[k], k), gap: gapOf(a[k], b[k]) }));
		return { firstLabel: la, secondLabel: lb, rows, headline: headlineOf(rows, la, lb) };
	}
	return null;
}

export function runAgreement(d: MeCycleDetail | null): RunAgreement | null {
	return comparisonOf(d) ?? stagesAgreement(d);
}

/** Nothing was measured: every second column says "not measured" (or nothing).
 *  A table of dashes says less than the one line that says why. */
export function nothingMeasured(a: RunAgreement | null): boolean {
	return !!a && a.rows.length > 0 && a.rows.every((r) => /^(—|-|not measured|n\/a|)$/i.test(r.second.trim()));
}

function headlineOf(rows: AgreementRow[], a: string, b: string): string {
	// Apps write the minus either way: U+2212 (gapOf above) or an ASCII "-"
	// (MLSys sandbox runs). Accepting only one dropped every negative gap.
	const pct = rows.map((r) => ({ r, p: /^[+\-−]\d+(\.\d+)?%$/.test(r.gap.trim()) ? Number(r.gap.trim().slice(1, -1)) : null })).filter((x) => x.p != null) as Array<{ r: AgreementRow; p: number }>;
	if (!pct.length) return `${a} and ${b} side by side`;
	const close = pct.filter((x) => x.p <= 20).length;
	const worst = pct.reduce((m, x) => (x.p > m.p ? x : m));
	const head = `${close} of ${pct.length} numbers within 20% of ${b.toLowerCase()}`;
	return worst.p > 20 ? `${head}; ${worst.r.metric} was ${worst.p}% ${/^[\-−]/.test(worst.r.gap.trim()) ? "lower" : "higher"}` : head;
}

/** What the run used, in words, or null when nothing says. */
export function runUsage(d: MeCycleDetail | null): { usage: Usage; words: string } | null {
	const s = obj(d?.summary) ?? {};
	for (const src of [obj(s.usage), obj(obj(s.metrics)?.usage), ...outputs(d).map((o) => obj(o.usage))]) {
		const u = usageOf(src);
		if (u) return { usage: u, words: usageWords(u) };
	}
	return null;
}

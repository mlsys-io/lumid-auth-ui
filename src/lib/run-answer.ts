// The run page's answer, first: did it work, what did it find, and if not, why.
//
// Pure functions over what a cycle actually records (checked on lum.id
// 2026-11-24): cloud runs carry ONE step, `engine_command`, whose `ok` is true
// whenever the command process exited — even when the command itself reported
// `out.ok: false` (Harvest outbox: step "Succeeded", run Failed). Numbers sit
// in `summary.metrics` under snake_case names with the unit in the suffix
// (`goodput_tok_s`, `ttft_ms_p99`, `vram_peak_gib`), and the declared metric's
// name in `summary.assets_used.metric.name`. Everything here turns those into
// words a reader can use without knowing the app.

import type { MeCycleDetail, MeCycleStep } from "@/api/me";
import { plainCause, fmtDuration } from "@/lib/activity";

// ── metric names ──────────────────────────────────────────────────────────

const ACRONYMS: Record<string, string> = {
	ttft: "TTFT", tpot: "TPOT", e2e: "E2E", kv: "KV", vram: "VRAM", pnl: "PnL", api: "API", llm: "LLM",
	gpu: "GPU", cpu: "CPU", id: "ID", url: "URL", ofi: "OFI", vpin: "VPIN", rag: "RAG", sla: "SLA", qps: "QPS",
};
// Longest first: "_tok_s" must win over "_s".
const UNITS: Array<[RegExp, string]> = [
	[/_tok_s$/, "tok/s"], [/_tokens?_s$/, "tok/s"], [/_req_s$/, "req/s"],
	[/_ms$/, "ms"], [/_sec$|_s$/, "s"], [/_gib$/, "GiB"], [/_gb$/, "GB"], [/_mib$/, "MiB"], [/_mb$/, "MB"],
	[/_pct$|_percent$/, "%"], [/_usd$/, "$"], [/_cents$/, "¢"], [/_ticks$/, "ticks"], [/_bps$/, "bps"],
];

export interface MetricName { label: string; unit: string }

/** "goodput_tok_s" → Goodput · tok/s; "ttft_ms_p99" → TTFT p99 · ms;
 *  "backtests_resolved" → Backtests resolved. */
export function humanMetric(key: string): MetricName {
	let k = key.trim().replace(/\./g, "_");
	let pct = "";
	const p = k.match(/_(p\d{2,3})$/);
	if (p) { pct = p[1]; k = k.slice(0, -p[0].length); }
	let unit = "";
	for (const [re, u] of UNITS) if (re.test(k)) { unit = u; k = k.replace(re, ""); break; }
	const words = k.split(/[_\s]+/).filter(Boolean).map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase());
	let label = words.join(" ");
	label = label.charAt(0).toUpperCase() + label.slice(1); // acronyms are already upper
	if (pct) label = `${label} ${pct}`;
	return { label: label || key, unit };
}

/** A value with its unit, rounded for reading: 22.4 tok/s, 709.7 ms, 85%. */
export function fmtMetricValue(v: number, unit: string, key = ""): string {
	// A rate in [0,1] with no unit reads as a share.
	if (!unit && /(^|_)(rate|ratio|share|accuracy|precision|recall)(_|$)/.test(key) && v >= 0 && v <= 1) return `${Math.round(v * 1000) / 10}%`;
	const abs = Math.abs(v);
	const n = Number.isInteger(v) ? v.toLocaleString() : abs >= 100 ? (Math.round(v * 10) / 10).toLocaleString() : abs >= 1 ? String(Math.round(v * 100) / 100) : String(+v.toPrecision(3));
	if (!unit) return n;
	if (unit === "$") return `$${n}`;
	if (unit === "%" || unit === "¢") return `${n}${unit}`;
	return `${n} ${unit}`;
}

// ── the run's numbers ─────────────────────────────────────────────────────

// Bookkeeping, not findings: ids, hashes, seeds, versions, flags.
const NOT_A_FINDING = /(^|_)(seed|hash|id|ts|version|index|task|tag|recorded|validated|cycle)$|^(objective|config_hash|cycle_ts|holdouts_run)$/;

export interface RunMetric { key: string; label: string; unit: string; value: number; text: string }

function flatMetrics(d: MeCycleDetail | null): Record<string, unknown> {
	const s = (d?.summary || {}) as Record<string, unknown>;
	const m = (s.metrics && typeof s.metrics === "object" ? s.metrics : {}) as Record<string, unknown>;
	const ce = (s.command_engine && typeof s.command_engine === "object" ? (s.command_engine as Record<string, unknown>).metrics : null) as Record<string, unknown> | null;
	return { ...(ce || {}), ...m };
}

/** The metric this run is judged on: the app's declared metric when the run
 *  recorded it, else `primary_metric` (unless that is the generic
 *  "objective", whose real name is `objective_metric`). */
export function primaryMetricKey(d: MeCycleDetail | null): string | null {
	const s = (d?.summary || {}) as Record<string, unknown>;
	const m = flatMetrics(d);
	const declared = ((s.assets_used as Record<string, unknown> | undefined)?.metric as { name?: string } | undefined)?.name;
	if (declared && typeof m[declared] === "number") return declared;
	const pm = s.primary_metric as { name?: string } | undefined;
	if (pm?.name && pm.name !== "objective" && typeof m[pm.name] === "number") return pm.name;
	const om = m.objective_metric;
	if (typeof om === "string" && typeof m[om] === "number") return om;
	return null;
}

/** The run's numbers as labelled tiles: the primary metric first, then up to
 *  `max - 1` others in recorded order; bookkeeping fields left out. */
export function runMetrics(d: MeCycleDetail | null, max = 8): RunMetric[] {
	const m = flatMetrics(d);
	const primary = primaryMetricKey(d);
	const keys = Object.keys(m).filter((k) => typeof m[k] === "number" && isFinite(m[k] as number) && !NOT_A_FINDING.test(k));
	const ordered = primary ? [primary, ...keys.filter((k) => k !== primary)] : keys;
	const seen = new Set<string>();
	const out: RunMetric[] = [];
	for (const k of ordered) {
		const v = m[k] as number;
		const { label, unit } = humanMetric(k);
		// Two names for ONE measurement (goodput_tok_s == throughput_tok_s) share
		// a unit; equal counts without one (cases_total == cases_passed) are
		// different facts and both stay.
		const sig = `${unit}|${v}`;
		if (unit && k !== primary && seen.has(sig)) continue;
		seen.add(sig);
		out.push({ key: k, label, unit, value: v, text: fmtMetricValue(v, unit, k) });
		if (out.length >= max) break;
	}
	return out;
}

// ── steps ─────────────────────────────────────────────────────────────────

/** A step failed if it says so OR its command reported failure inside a
 *  process that exited cleanly (`output.out.ok === false`). */
export function stepFailed(st: MeCycleStep): boolean {
	if (st.ok === false || st.error) return true;
	const out = st.output as Record<string, unknown> | undefined;
	const inner = out?.out as Record<string, unknown> | undefined;
	return inner?.ok === false || out?.ok === false;
}

/** "engine_command" → "Ran harvest outbox"; "score_docs" → "Score docs". */
export function stepLabel(st: MeCycleStep): string {
	const id = st.step_id || st.skill || "step";
	if (id === "engine_command") {
		const mod = (st.output as Record<string, unknown> | undefined)?.module;
		return typeof mod === "string" && mod ? `Ran ${mod.replace(/[_-]+/g, " ")}` : "Ran the app's command";
	}
	const words = id.replace(/[_-]+/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A failed step's own error text, unreworded. */
export function rawStepError(st: MeCycleStep): string | undefined {
	const inner = (st.output as Record<string, unknown> | undefined)?.out as Record<string, unknown> | undefined;
	return st.error || (typeof inner?.error === "string" ? inner.error : undefined);
}

/** One line under the step name: the failure in words, or what it said. */
export function stepLine(st: MeCycleStep): string {
	const out = st.output as Record<string, unknown> | undefined;
	const inner = out?.out as Record<string, unknown> | undefined;
	const err = st.error || (typeof inner?.error === "string" ? inner.error : undefined);
	if (stepFailed(st)) return plainCause(err || (typeof inner?.outcome === "string" ? inner.outcome : "") || "");
	if (st.output_summary) return st.output_summary.slice(0, 160);
	const said = inner?.summary ?? (inner?.outcome !== "ran" ? inner?.outcome : undefined);
	if (typeof said === "string" && said) return plainCause(said);
	return ""; // the step's status chip already says it succeeded
}

// ── the answer ────────────────────────────────────────────────────────────

export interface RunAnswer {
	tone: "ok" | "failed" | "running" | "unknown";
	/** "Succeeded in 4.2s" / "Failed after 62s". */
	headline: string;
	/** The finding or the reason, in words ("Meets every performance constraint",
	 *  "Server error (HTTP 500)"). */
	sentence: string;
	/** The raw error, for the disclosure. */
	raw?: string;
}

const QUIET_OUTCOMES = new Set(["ran", "no_change", "awaiting_review", "no_setup", "ok", "succeeded"]);

export function runAnswer(d: MeCycleDetail | null, opts: { ok?: boolean; running?: boolean; durationS?: number } = {}): RunAnswer {
	const s = (d?.summary || {}) as Record<string, unknown>;
	const ok = d?.ok ?? opts.ok;
	const running = d?.running ?? opts.running;
	const dur = fmtDuration(opts.durationS ?? (typeof s.duration_s === "number" ? s.duration_s : undefined));
	const m = flatMetrics(d);
	if (running) return { tone: "running", headline: "Running", sentence: "" };
	if (ok === false) {
		// Known to have failed (from the runs list) but the run itself hasn't
		// loaded: say nothing about the reason yet rather than "none recorded".
		if (!d) return { tone: "failed", headline: dur ? `Failed after ${dur}` : "Failed", sentence: "" };
		const err = typeof s.error === "string" ? s.error : s.error != null ? JSON.stringify(s.error) : undefined;
		// The raw text, wherever the run recorded it: the run's error, a failed
		// step's own error, or summary.step_errors[0]. Triage reads THIS, not
		// the reworded sentence ("ModuleNotFoundError" must reach the triage).
		const failedStep = (d?.steps || []).find((st) => stepFailed(st));
		const stepRaw = failedStep ? rawStepError(failedStep) : undefined;
		const se = Array.isArray(s.step_errors) && s.step_errors.length ? s.step_errors[0] as unknown : undefined;
		const seRaw = se == null ? undefined : typeof se === "string" ? se : typeof (se as { error?: unknown }).error === "string" ? (se as { error: string }).error : JSON.stringify(se);
		const raw = err || stepRaw || seRaw;
		const outcome = typeof s.outcome === "string" && !QUIET_OUTCOMES.has(s.outcome) ? s.outcome : "";
		const sentence = raw ? plainCause(raw) : outcome ? plainCause(outcome) : (failedStep && stepLine(failedStep)) || "No reason was recorded";
		return { tone: "failed", headline: dur ? `Failed after ${dur}` : "Failed", sentence, raw: raw || undefined };
	}
	if (ok === true) {
		const said = typeof m.summary === "string" ? m.summary : typeof s.insight === "string" ? s.insight : "";
		const outcome = typeof s.outcome === "string" && !QUIET_OUTCOMES.has(s.outcome) ? plainCause(s.outcome) : "";
		const sentence = said ? said.charAt(0).toUpperCase() + said.slice(1) : outcome;
		return { tone: "ok", headline: dur ? `Succeeded in ${dur}` : "Succeeded", sentence };
	}
	return { tone: "unknown", headline: "Outcome not recorded", sentence: "" };
}

/** "+12% vs usual" — this run's value against the median of the workflow's
 *  other recorded values (needs 3+), in the direction that is better. */
export function vsUsual(value: number, others: number[], higherIsBetter = true): { text: string; better: boolean } | null {
	const xs = others.filter((x) => isFinite(x)).sort((a, b) => a - b);
	if (xs.length < 3) return null;
	const med = xs[Math.floor(xs.length / 2)];
	if (med === 0) return null;
	const pct = Math.round(((value - med) / Math.abs(med)) * 100);
	if (pct === 0) return { text: "same as usual", better: true };
	return { text: `${pct > 0 ? "+" : ""}${pct}% vs usual`, better: higherIsBetter ? pct > 0 : pct < 0 };
}

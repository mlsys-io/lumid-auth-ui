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
	kol: "KOL", mbb: "MBB", dag: "DAG",
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
	// Lumid says "version", never "arm" or "variant" (the glossary).
	if (/^(arm|arm_id|variant|variant_id)$/i.test(key.trim())) return { label: "Version", unit: "" };
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

/** Counts of what a run did (not what it found): listed after the findings. */
const BOOKKEEPING = /(^|_)(open|resolved|submitted|refused|errors?|count|rows|scanned|matched|replayed|evaluated|actions|secs|steps|attempts|retries|skipped)$|^(results|backtests|experiment|rows)_/;

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
	// Findings before bookkeeping: a cap of 6 used to fill with counters
	// (backtests_open, prints_replayed, …) and drop the P&L.
	const rest = keys.filter((k) => k !== primary);
	const ranked = [...rest.filter((k) => !BOOKKEEPING.test(k)), ...rest.filter((k) => BOOKKEEPING.test(k))];
	const ordered = primary ? [primary, ...ranked] : ranked;
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
		// The command's own verdict sentence first: quant writes `result_summary`
		// ("made 35,140,000 ticks (+3,820 per lot) on …"), mlsys `summary`.
		const said = typeof m.result_summary === "string" ? m.result_summary : typeof m.summary === "string" ? m.summary : typeof s.insight === "string" ? s.insight : "";
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

// ── what the run produced (the outputs column) ────────────────────────────

export interface RunOutputs {
	/** A long human sentence the command wrote (result_summary / summary / thesis). */
	text: string | null;
	/** Short named results the command returned, in words — not the metrics the
	 *  answer card already shows, not bookkeeping. */
	fields: Array<{ label: string; value: string }>;
	memories: string[];
}

const OUTPUT_NOISE = /^(ok|error|outcome|metrics|expanded_args|undeclared_args|module|started_at|ended_at|duration_s|steps|flags|results|performance|claim_id|strategy_id|request_id|program_hash|cycle_ts|config_hash|measured_on|constraints|constraint_rows|workload_rows|summary)$/;

/** Which long string is the run's own verdict: result_summary, then summary,
 *  thesis, any *_summary, then notes (a replay_note is provenance, not the answer). */
function sentenceRank(k: string): number {
	if (k === "result_summary") return 0;
	if (k === "summary") return 1;
	if (k === "thesis") return 2;
	if (/summary/.test(k)) return 3;
	if (/result/.test(k)) return 4;
	if (/note/.test(k)) return 5;
	return 99;
}

export function runOutputs(d: MeCycleDetail | null): RunOutputs {
	const out: RunOutputs = { text: null, fields: [], memories: [] };
	if (!d) return out;
	let textRank = 99;
	const shown = new Set(runMetrics(d, 99).map((m) => m.key));
	// The answer card already says the run's result_summary when it is in metrics.
	if (typeof flatMetrics(d).result_summary === "string") shown.add("result_summary");
	const step = (d.steps || []).find((s) => s.output && typeof s.output === "object");
	const inner = ((step?.output as Record<string, unknown> | undefined)?.out ?? step?.output) as Record<string, unknown> | undefined;
	const s = (d.summary || {}) as Record<string, unknown>;
	const srcs = [inner, (s.command_engine as Record<string, unknown> | undefined), (s.metrics as Record<string, unknown> | undefined)];
	for (const src of srcs) {
		if (!src || typeof src !== "object") continue;
		for (const [k, v] of Object.entries(src)) {
			if (OUTPUT_NOISE.test(k) || shown.has(k)) continue;
			if (typeof v === "string") {
				const t = v.trim();
				if (!t) continue;
				if (t.length > 60 && /\s/.test(t)) { const r = sentenceRank(k); if (r < textRank) { out.text = t; textRank = r; } continue; }
				const label = humanMetric(k.replace(/_text$/, "")).label;
				if (out.fields.some((f) => f.label === label)) continue;
				if (/^[0-9a-f-]{20,}$/i.test(t) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(t)) continue; // ids, and values that embed one
				out.fields.push({ label, value: t.replace(/_/g, " ") });
			} else if (typeof v === "boolean") {
				if (out.fields.some((f) => f.label === humanMetric(k).label)) continue;
				out.fields.push({ label: humanMetric(k).label, value: v ? "yes" : "no" });
			}
			if (out.fields.length >= 8) break;
		}
	}
	const mem = (d as { memories_learned?: unknown }).memories_learned;
	if (Array.isArray(mem)) out.memories = mem.map((m) => (typeof m === "string" ? m : String((m as { title?: string; text?: string })?.title ?? (m as { text?: string })?.text ?? ""))).filter(Boolean).slice(0, 5);
	return out;
}

/** A file the run produced, ready to save. Lumid runs rarely write files the
 *  API can reach, so these come from what the run DID record:
 *   1. sidecar `files` the cycle dir held (observations, proposal, …);
 *   2. whole documents inlined as a string field (`design_text` = the design
 *      JSON an mlsys run evaluated) — a multi-line value is a file, not a field;
 *   3. every number and fact the run returned, as one results.json.
 *  Content is already in hand, so saving needs no request. */
export interface RunFile { name: string; label: string; type: "json" | "md" | "txt"; content: string; bytes: number }

function asDoc(name: string, label: string, v: unknown): RunFile | null {
	let content: string; let type: RunFile["type"];
	if (typeof v === "string") {
		const t = v.trim();
		if (!t) return null;
		if (/^[[{]/.test(t)) {
			try { content = JSON.stringify(JSON.parse(t), null, 2); type = "json"; } catch { content = t; type = "txt"; }
		} else { content = t; type = /^#{1,3} |\n#{1,3} /.test(t) ? "md" : "txt"; }
	} else if (v && typeof v === "object") { content = JSON.stringify(v, null, 2); type = "json"; } else return null;
	const base = name.replace(/[^\w.-]+/g, "_").replace(/_text$/, "");
	return { name: `${base}.${type}`, label, type, content, bytes: new TextEncoder().encode(content).length };
}

export function runFiles(d: MeCycleDetail | null): RunFile[] {
	if (!d) return [];
	const files: RunFile[] = [];
	const seen = new Set<string>();
	const push = (f: RunFile | null) => { if (f && !seen.has(f.name)) { seen.add(f.name); files.push(f); } };
	for (const [k, v] of Object.entries(d.files || {})) push(asDoc(k, humanMetric(k).label, v));
	const out = runOut(d);
	const sm = ((d.summary || {}) as Record<string, unknown>).metrics as Record<string, unknown> | undefined;
	for (const src of [out, out?.metrics as Record<string, unknown> | undefined, sm]) {
		if (!src || typeof src !== "object") continue;
		for (const [k, v] of Object.entries(src)) {
			if (typeof v !== "string" || !v.includes("\n") || v.length < 120) continue;
			push(asDoc(k, humanMetric(k.replace(/_text$/, "")).label, v));
		}
	}
	if (out && Object.keys(out).length) push({ ...asDoc("results", "Everything this run returned", out)! });
	return files;
}

/** The run's own output object (the step's `out`), where apps put their facts. */
function runOut(d: MeCycleDetail | null): Record<string, unknown> | undefined {
	const step = (d?.steps || []).find((st) => st.output && typeof st.output === "object");
	const o = step?.output as Record<string, unknown> | undefined;
	return (o?.out && typeof o.out === "object" ? o.out : o) as Record<string, unknown> | undefined;
}

export interface RunLimit { label: string; rule: string; observed: string; met: boolean | null }

/**
 * The limits a run was held to, in words — what it was aiming for comes BEFORE
 * how it did. Reads the generic `constraints` convention
 * [{metric, op, value, observed, met}] from the run's output; an app that
 * reports none shows none (no "meets every constraint" without naming them).
 */
/** A field from the run's output, wherever the run put it: the step's `out`,
 *  its `out.metrics`, or the summary's metrics (where cloud runs keep them). */
function runField(d: MeCycleDetail | null, key: string): unknown {
	const out = runOut(d);
	const sm = ((d?.summary || {}) as Record<string, unknown>).metrics as Record<string, unknown> | undefined;
	for (const src of [out, out?.metrics as Record<string, unknown> | undefined, sm]) {
		if (src && typeof src === "object" && key in src) return (src as Record<string, unknown>)[key];
	}
	return undefined;
}

export function runLimits(d: MeCycleDetail | null): RunLimit[] {
	const raw = runField(d, "constraints");
	if (!Array.isArray(raw)) return [];
	const out: RunLimit[] = [];
	for (const c of raw as Array<Record<string, unknown>>) {
		const key = typeof c.metric === "string" ? c.metric : "";
		if (!key) continue;
		const m = humanMetric(key);
		const op = typeof c.op === "string" ? c.op.replace("<=", "≤").replace(">=", "≥") : "";
		const fmt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? fmtMetricValue(v, m.unit, key) : "—");
		const rule = typeof c.value === "number" ? `${op} ${fmt(c.value)}`.trim() : "no limit set";
		out.push({ label: m.label, rule, observed: fmt(c.observed), met: typeof c.met === "boolean" ? c.met : null });
	}
	return out;
}

/**
 * What a run's numbers were measured on, from its metrics, in one line — or
 * that it could not be measured. `measured_on: "<words>"` (any app) reads
 * "Measured on <words>"; `status: "not_measured"` reads the app's own summary
 * when it says why ("Not measured on a GPU: every GPU was busy."), else "Not
 * measured". A run that says neither gets no line: never guess the instrument.
 */
export function measuredLine(m: Record<string, unknown> | null | undefined): { measured: boolean; text: string } | null {
	if (!m) return null;
	const on = m.measured_on;
	if (typeof on === "string" && on.trim()) return { measured: true, text: `Measured on ${on.trim()}` };
	if (m.status === "not_measured") {
		const why = typeof m.summary === "string" && /^not measured/i.test(m.summary.trim()) ? m.summary.trim() : "Not measured";
		return { measured: false, text: why };
	}
	return null;
}

/** Where the result was measured, when the app says (`measured_on` in the run's output). */
export function measuredOn(d: MeCycleDetail | null): string | null {
	const v = runField(d, "measured_on");
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

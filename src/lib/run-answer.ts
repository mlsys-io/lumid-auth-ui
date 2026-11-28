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
import { plainCause, fmtDuration, dirIdToSec } from "@/lib/activity";

// ── metric names ──────────────────────────────────────────────────────────

const ACRONYMS: Record<string, string> = {
	ttft: "TTFT", tpot: "TPOT", e2e: "E2E", kv: "KV", vram: "VRAM", pnl: "PnL", api: "API", llm: "LLM",
	gpu: "GPU", cpu: "CPU", id: "ID", url: "URL", ofi: "OFI", vpin: "VPIN", rag: "RAG", sla: "SLA", qps: "QPS",
	kol: "KOL", mbb: "MBB", dag: "DAG",
	// Quant research (2026-11-28 re-audit: "Oos sharpe", "Dsr p", "Profit gpa").
	oos: "OOS", dsr: "DSR", roe: "ROE", gpa: "GPA", cagr: "CAGR", ic: "IC", etf: "ETF", ohlc: "OHLC",
};
// Longest first: "_tok_s" must win over "_s".
const UNITS: Array<[RegExp, string]> = [
	[/_tok_s$/, "tok/s"], [/_tokens?_s$/, "tok/s"], [/_req_s$/, "req/s"],
	[/_ms$/, "ms"], [/_sec$|_s$/, "s"], [/_gib$/, "GiB"], [/_gb$/, "GB"], [/_mib$/, "MiB"], [/_mb$/, "MB"],
	[/_pct$|_percent$/, "%"], [/_usd$/, "$"], [/_cents$/, "¢"], [/_ticks_per_lot$/, "ticks/lot"], [/_ticks$/, "ticks"], [/_bps$/, "bps"],
	[/_kwh$/, "kWh"], [/_wh$/, "Wh"], [/_j$/, "J"], [/_w$/, "W"],
];
// "…_per_tok" is a rate of whatever unit comes before it: energy_j_per_tok → J per token.
const PER: Array<[RegExp, string]> = [[/_per_(?:tok|token|output_token)s?$/, "per token"], [/_per_(?:req|request)s?$/, "per request"]];
// A trailing qualifier that is not part of the name: power_w_avg → Power (average) · W.
const QUALIFIER: Record<string, string> = { avg: "average", mean: "average", median: "median", idle: "idle", net: "net" };

export interface MetricName { label: string; unit: string }

/** "goodput_tok_s" → Goodput · tok/s; "ttft_ms_p99" → TTFT p99 · ms;
 *  "backtests_resolved" → Backtests resolved; "energy_j_per_tok" → Energy · J per token.
 *  An `estimated_` number says "(estimated)" after its label — unless `measured`
 *  says this value is a measurement (an app may report a measured number under
 *  its estimate's name, so the two steps can be paired). */
export function humanMetric(key: string, opts: { measured?: boolean } = {}): MetricName {
	// Lumid says "version", never "arm" or "variant" (the glossary).
	if (/^(arm|arm_id|variant|variant_id)$/i.test(key.trim())) return { label: "Version", unit: "" };
	let k = key.trim().replace(/\./g, "_");
	let estimated = false;
	if (/^estimated_./.test(k)) { estimated = true; k = k.slice("estimated_".length); }
	let ratio = false;
	if (/^ratio_./.test(k)) { ratio = true; k = k.slice("ratio_".length); }
	let pct = "";
	const p = k.match(/_(p\d{2,3})$/);
	if (p) { pct = p[1]; k = k.slice(0, -p[0].length); }
	let qual = "";
	const q = k.match(/_([a-z]+)$/);
	if (q && QUALIFIER[q[1]] && k.length > q[0].length) { qual = QUALIFIER[q[1]]; k = k.slice(0, -q[0].length); }
	let per = "";
	for (const [re, w] of PER) if (re.test(k)) { per = w; k = k.replace(re, ""); break; }
	let unit = "";
	for (const [re, u] of UNITS) if (re.test(k)) { unit = u; k = k.replace(re, ""); break; }
	if (per) unit = unit ? `${unit} ${per}` : per;
	// A ratio of two readings has no unit of its own: ratio_decode_tok_s is ×1.46, not 1.46 tok/s.
	if (ratio) unit = "";
	const words = k.split(/[_\s]+/).filter(Boolean).map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase());
	let label = words.join(" ");
	label = label.charAt(0).toUpperCase() + label.slice(1); // acronyms are already upper
	if (pct) label = `${label} ${pct}`;
	if (ratio) label = `${label} ratio`;
	if (qual) label = `${label} (${qual})`;
	if (estimated && !opts.measured) label = `${label} (estimated)`;
	return { label: label || key, unit };
}

/** A yes/no fact recorded as 0/1 (meets_constraints, same_gpu_as_simulated,
 *  calibrated) — not a count like holdouts_met. */
export function isFlagKey(key: string): boolean {
	const k = key.trim().replace(/\./g, "_");
	return /^(?:(?:calibrated|robust|simulated|measured)_)?(?:meets|is|has|same|passed|reused|written|ok)(?:_|$)/.test(k) || /^(calibrated|stage_passed)$/.test(k);
}

/** A count of things (n_designs, resamples_asked, cases_total): "+133% vs usual"
 *  on a count says nothing about how the run did. */
export function isCountKey(key: string): boolean {
	const k = key.trim().replace(/\./g, "_");
	return /(^|_)(n|num|count|total)(_|$)/.test(k) || /_(asked|met|run|measured)$/.test(k) || BOOKKEEPING.test(k) || isFlagKey(k);
}

/** A value with its unit, rounded for reading: 22.4 tok/s, 709.7 ms, 85%. */
export function fmtMetricValue(v: number, unit: string, key = ""): string {
	// A flag reads yes/no, never "1".
	if (key && isFlagKey(key) && (v === 0 || v === 1)) return v ? "yes" : "no";
	// A ratio reads as a factor: ×1.74.
	if (!unit && /^ratio_/.test(key)) return `×${+v.toPrecision(3)}`;
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
const NOT_A_FINDING = /(^|_)(seed|hash|id|ts|version|index|task|tag|recorded|validated|cycle)$|^(objective|config_hash|cycle_ts|holdouts_run|retry_after|retry_at)$/;
/** A metric key that is a finding, not bookkeeping (ids, hashes, seeds, flags). */
export const isFindingKey = (k: string): boolean => !NOT_A_FINDING.test(k);

/** Counts of what a run did (not what it found): listed after the findings. */
const BOOKKEEPING = /(^|_)(open|resolved|submitted|refused|errors?|count|rows|scanned|matched|replayed|evaluated|actions|secs|steps|attempts|retries|skipped)$|^(results|backtests|experiment|rows)_/;

export interface RunMetric { key: string; label: string; unit: string; value: number; text: string }

function flatMetrics(d: MeCycleDetail | null): Record<string, unknown> {
	const s = (d?.summary || {}) as Record<string, unknown>;
	const m = (s.metrics && typeof s.metrics === "object" ? s.metrics : {}) as Record<string, unknown>;
	const ce = (s.command_engine && typeof s.command_engine === "object" ? (s.command_engine as Record<string, unknown>).metrics : null) as Record<string, unknown> | null;
	return { ...(ce || {}), ...m };
}

/** An experiment as the run page needs it: its id and the metric it compares on
 *  (`GET /me/apps/:app/experiments`, MeExperiment). */
export interface RunExperimentRef { id: string; title?: string | null; metric?: { name: string; higher_is_better?: boolean }; higher_is_better?: boolean }

const objOf = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** The experiment this run belongs to, among the app's experiments. A run names
 *  it in several places, none of them universal: `experiment_id` (queued from
 *  the UI), the app's own `study` field, the run's lineage / branch signal
 *  config (`study`), or `experiment` (which some runs set to the VERSION —
 *  hence matching against the declared ids rather than trusting any one field). */
export function runExperiment<E extends { id: string }>(d: MeCycleDetail | null, experiments: E[] | null | undefined): E | null {
	if (!d || !experiments?.length) return null;
	const s = (d.summary || {}) as Record<string, unknown>;
	const m = flatMetrics(d);
	const variant = objOf(objOf(s.lineage)?.variant);
	const sig = (objOf(s.branch_signals)?.variants as unknown[] | undefined)?.map((v) => objOf(objOf(v)?.config)) ?? [];
	const names = [s.experiment_id, runField(d, "experiment_id"), m.study, runField(d, "study"), variant?.study, ...sig.map((c) => c?.study), s.study, s.experiment, m.experiment]
		.filter((x): x is string => typeof x === "string" && !!x);
	for (const n of names) {
		const e = experiments.find((x) => x.id === n);
		if (e) return e;
	}
	return null;
}

/** The metric this run is judged on: the metric of the experiment it belongs to
 *  when the run recorded it (an energy experiment is judged on energy, not the
 *  app's default goodput), else the app's declared metric, else
 *  `primary_metric` (unless that is the generic "objective", whose real name is
 *  `objective_metric`). */
export function primaryMetricKey(d: MeCycleDetail | null, experiment?: RunExperimentRef | null): string | null {
	const s = (d?.summary || {}) as Record<string, unknown>;
	const m = flatMetrics(d);
	const em = experiment?.metric?.name;
	if (em && typeof m[em] === "number") return em;
	const declared = ((s.assets_used as Record<string, unknown> | undefined)?.metric as { name?: string } | undefined)?.name;
	if (declared && typeof m[declared] === "number") return declared;
	const pm = s.primary_metric as { name?: string } | undefined;
	if (pm?.name && pm.name !== "objective" && typeof m[pm.name] === "number") return pm.name;
	const om = m.objective_metric;
	if (typeof om === "string" && typeof m[om] === "number") return om;
	return null;
}

/** Is the primary metric better higher? The experiment's say first, then the app's. */
export function primaryHigherIsBetter(d: MeCycleDetail | null, experiment?: RunExperimentRef | null): boolean {
	const e = experiment?.metric?.higher_is_better ?? experiment?.higher_is_better;
	if (typeof e === "boolean" && primaryMetricKey(d, experiment) === experiment?.metric?.name) return e;
	const s = (d?.summary || {}) as Record<string, unknown>;
	return ((s.assets_used as Record<string, unknown> | undefined)?.metric as { higher_is_better?: boolean } | undefined)?.higher_is_better !== false;
}

/** The run's numbers are measurements (a GPU, a live market), not a
 *  simulator's estimate: it says where it was measured, or `status: measured`. */
export function isMeasuredRun(d: MeCycleDetail | null): boolean {
	return !!measuredOn(d) || runField(d, "status") === "measured";
}

/** The keys a run's limits are about (ttft_ms.p99 → ttft_ms_p99), in order. */
function constraintKeys(d: MeCycleDetail | null): string[] {
	const raw = runField(d, "constraints");
	if (!Array.isArray(raw)) return [];
	return raw.map((c) => (typeof objOf(c)?.metric === "string" ? String(objOf(c)!.metric).replace(/\./g, "_") : "")).filter(Boolean);
}

/** The run's numbers as labelled tiles: the primary metric first, then the
 *  metrics its limits are about, then up to `max` others in recorded order;
 *  bookkeeping fields left out, and pairs said as one line (beforeAfter) left
 *  to that line. */
export function runMetrics(d: MeCycleDetail | null, max = 8, experiment?: RunExperimentRef | null): RunMetric[] {
	const m = flatMetrics(d);
	const primary = primaryMetricKey(d, experiment);
	const measured = isMeasuredRun(d);
	const paired = new Set(beforeAfter(d).flatMap((p) => [p.beforeKey, p.afterKey]));
	const keys = Object.keys(m).filter((k) => typeof m[k] === "number" && isFinite(m[k] as number) && !NOT_A_FINDING.test(k) && !paired.has(k));
	// Findings before bookkeeping: a cap of 6 used to fill with counters
	// (backtests_open, prints_replayed, …) and drop the P&L.
	const pinned = constraintKeys(d).filter((k) => k !== primary && keys.includes(k));
	const rest = keys.filter((k) => k !== primary && !pinned.includes(k));
	const ranked = [...pinned, ...rest.filter((k) => !BOOKKEEPING.test(k)), ...rest.filter((k) => BOOKKEEPING.test(k))];
	const ordered = primary ? [primary, ...ranked] : ranked;
	const seen = new Set<string>();
	const out: RunMetric[] = [];
	for (const k of ordered) {
		const v = m[k] as number;
		const { label, unit } = humanMetric(k, { measured });
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
	if (stepHeld(st)) return false;
	if (st.ok === false || st.error) return true;
	const out = st.output as Record<string, unknown> | undefined;
	const inner = out?.out as Record<string, unknown> | undefined;
	return inner?.ok === false || out?.ok === false;
}

/** A step a gate held back: it did not run, and it did not fail. A chain
 *  records it as `{ok: false, error: "held"}` (or `status: "held"`). */
export function stepHeld(st: MeCycleStep): boolean {
	const status = (st as { status?: unknown }).status ?? (st.output as Record<string, unknown> | undefined)?.status;
	return (typeof st.error === "string" && st.error.trim().toLowerCase() === "held") || status === "held";
}

/** A gate's reason in words: "sharpe_is_phase_mean 0.3349 < 0.5, trades 11 < 30"
 *  → "Sharpe is phase mean 0.3349 < 0.5, trades 11 < 30". Each metric name
 *  reads as its label; numbers and comparisons stay. */
export function gateReasonWords(reason: string): string {
	let first = true;
	const out = reason.trim().replace(/^filtered:\s*/i, "").replace(/[A-Za-z_][\w.]*/g, (w) => {
		if (/^(and|or|not|true|false|nan|inf)$/i.test(w)) return w;
		const label = humanMetric(w).label;
		const keep = first || /^[A-Z0-9]{2,}\b/.test(label);
		first = false;
		return keep ? label : label.charAt(0).toLowerCase() + label.slice(1);
	});
	return out;
}

/** A step its gate stopped: it ran and said no (the chain engine's `filtered`). */
export function stepFiltered(st: MeCycleStep): boolean {
	const out = st.output as Record<string, unknown> | undefined;
	const inner = out?.out as Record<string, unknown> | undefined;
	const status = (st as { status?: unknown }).status ?? out?.status;
	return status === "filtered" || /^filtered:/i.test(st.output_summary || "") || (typeof inner?.outcome === "string" && /^filtered:/i.test(inner.outcome));
}

/** A run its owner stopped by hand: cancelled, not failed — nothing to fix. */
export function userStopped(reason: unknown): boolean {
	return typeof reason === "string" && /^\s*(user[_ ]stopped|stopped by (the )?user|cancell?ed by (the )?user|interrupted)\s*$/i.test(reason);
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
	if (stepHeld(st)) return "Held (not run)";
	if (stepFiltered(st)) {
		const said = st.output_summary || String(((st.output as Record<string, unknown> | undefined)?.out as Record<string, unknown> | undefined)?.outcome ?? "");
		const why = gateReasonWords(said);
		return why ? `Didn't pass its gate: ${why}` : "Didn't pass its gate";
	}
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
	/** `not_run`: the run was refused or could not be measured (a daily cap, no
	 *  free GPU) — it neither succeeded nor failed. `stopped`: a gate held the
	 *  later steps back — the run did its job and said no. */
	tone: "ok" | "failed" | "running" | "unknown" | "not_run" | "stopped" | "cancelled";
	/** "Succeeded in 4.2s" / "Failed after 62s" / "Didn't run" / "Stopped after Simulate". */
	headline: string;
	/** The finding or the reason, in words ("Meets every performance constraint",
	 *  "Server error (HTTP 500)"). */
	sentence: string;
	/** The raw error, for the disclosure. */
	raw?: string;
	/** When a run that didn't run can be tried again, in words. */
	retry?: string;
}

const QUIET_OUTCOMES = new Set(["ran", "no_change", "awaiting_review", "no_setup", "ok", "succeeded"]);

export function runAnswer(d: MeCycleDetail | null, opts: { ok?: boolean; running?: boolean; durationS?: number; now?: number; specGate?: string | null } = {}): RunAnswer {
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
		// Stopped by hand: not a failure, and nothing to diagnose (2026-11-28:
		// "Failed after 2m 46s · Diagnose in chat" over a run its owner stopped).
		if ([raw, s.outcome, s.reason, s.error].some(userStopped)) {
			return { tone: "cancelled", headline: dur ? `Cancelled after ${dur}` : "Cancelled", sentence: "Stopped by hand, so there's nothing to fix. Re-run it if you still want the result." };
		}
		const outcome = typeof s.outcome === "string" && !QUIET_OUTCOMES.has(s.outcome) ? s.outcome : "";
		const sentence = raw ? plainCause(raw) : outcome ? plainCause(outcome) : (failedStep && stepLine(failedStep)) || "No reason was recorded";
		return { tone: "failed", headline: dur ? `Failed after ${dur}` : "Failed", sentence, raw: raw || undefined };
	}
	if (d) {
		const nr = notRun(d, opts.now);
		if (nr) return { tone: "not_run", headline: "Didn't run", sentence: nr.sentence, ...(nr.retry ? { retry: nr.retry } : {}) };
		const gs = gateStop(d, opts.specGate);
		if (gs) return { tone: "stopped", headline: gs.headline, sentence: gs.sentence };
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

// ── didn't run ───────────────────────────────────────────────────────────

const NOT_RUN = new Set(["not_measured", "not_run", "didnt_run", "refused", "over_budget"]);

/** When the run ended, epoch seconds: the command's own `ended_at`, else the
 *  last event's end, else the run id plus its duration. */
export function runEndSec(d: MeCycleDetail | null): number | null {
	if (!d) return null;
	const o = (d.steps || []).map((st) => objOf(st.output)?.ended_at).find((x) => typeof x === "number");
	if (typeof o === "number") return o;
	const ev = (d.events || []).map((e) => e.ended_at).filter((x): x is number => typeof x === "number");
	if (ev.length) return Math.max(...ev);
	const start = dirIdToSec(d.ts);
	const dur = (d.summary as Record<string, unknown> | undefined)?.duration_s;
	return start != null ? start + (typeof dur === "number" ? dur : 0) : null;
}

/** "Try again after 4:24 PM (in about 5 h)" / "You can try again now". `fmtTime`
 *  is injectable so tests don't depend on the machine's locale and zone. */
export function retryWords(atSec: number, nowSec: number, fmtTime: (sec: number) => string = defaultClock): string {
	const d = atSec - nowSec;
	if (d <= 60) return "You can try again now";
	if (d < 3600) return `Try again in about ${Math.ceil(d / 60)} min`;
	const sameDay = new Date(atSec * 1000).toDateString() === new Date(nowSec * 1000).toDateString();
	const tomorrow = new Date((nowSec + 86400) * 1000).toDateString() === new Date(atSec * 1000).toDateString();
	const day = sameDay ? "" : tomorrow ? " tomorrow" : ` on ${new Date(atSec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
	return `Try again after ${fmtTime(atSec)}${day} (in about ${Math.round(d / 3600)} h)`;
}
function defaultClock(sec: number): string {
	return new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** When the run can be tried again: `retry_after` (seconds after the run
 *  ended, or an ISO time) or `retry_at` (ISO / epoch seconds). */
export function retryAtSec(d: MeCycleDetail | null): number | null {
	const parse = (v: unknown, relative: boolean): number | null => {
		if (typeof v === "number" && Number.isFinite(v)) {
			if (!relative || v > 1e9) return v > 1e12 ? v / 1000 : v; // an epoch, not a delay
			const end = runEndSec(d);
			return end != null ? end + v : null;
		}
		if (typeof v === "string" && v.trim()) {
			if (/^\d+(\.\d+)?$/.test(v.trim())) return parse(Number(v), relative);
			const t = Date.parse(v);
			return Number.isFinite(t) ? t / 1000 : null;
		}
		return null;
	};
	return parse(runField(d, "retry_after"), true) ?? parse(runField(d, "retry_at"), false);
}

/**
 * A run that was refused or could not be measured — `status: "not_measured"`
 * (or not_run / refused / over_budget) in its output. It neither succeeded nor
 * failed: the reason is the app's own sentence when it gives one ("Not measured
 * on a GPU: your daily budget of 12 GPU measurements is used…"), and the retry
 * time when the run carries one.
 */
export function notRun(d: MeCycleDetail | null, now = Date.now() / 1000): { sentence: string; retry?: string } | null {
	const status = runField(d, "status");
	if (typeof status !== "string" || !NOT_RUN.has(status)) return null;
	const said = runField(d, "summary");
	const reason = runField(d, "reason") ?? runField(d, "not_measured_reason");
	const sentence = typeof said === "string" && said.trim()
		? said.trim().charAt(0).toUpperCase() + said.trim().slice(1)
		: typeof reason === "string" && reason.trim() ? plainCause(reason) : status === "refused" ? "The run was refused" : "It wasn't measured";
	const at = retryAtSec(d);
	return { sentence, ...(at != null ? { retry: retryWords(at, now) } : {}) };
}

// ── a gate stopped it ──────────────────────────────────────────────────────

/** The run's stages (a chain records them in `summary.stages`). */
function stagesOf(d: MeCycleDetail | null): Array<Record<string, unknown>> {
	const st = (d?.summary as Record<string, unknown> | undefined)?.stages;
	return Array.isArray(st) ? st.map(objOf).filter((x): x is Record<string, unknown> => !!x) : [];
}

const stageWords = (id: string) => { const w = id.replace(/[-_]+/g, " ").trim(); return w.charAt(0).toUpperCase() + w.slice(1); };

/** The pass rule the run was held to: a stage's `gate`, the output's `gate`,
 *  else the one the app's spec declares (passed in). Raw expression. */
export function runGate(d: MeCycleDetail | null, specGate?: string | null): string | null {
	for (const st of stagesOf(d)) if (typeof st.gate === "string" && st.gate.trim()) return st.gate.trim();
	const g = runField(d, "gate");
	if (typeof g === "string" && g.trim()) return g.trim();
	return specGate?.trim() || null;
}

/** "calibrated_meets_constraints >= 1" → "Calibrated meets constraints ≥ 1". */
export function gateWords(expr: string): string {
	const t = expr.replace(/>=/g, "≥").replace(/<=/g, "≤").replace(/==/g, "=").replace(/!=/g, "≠")
		.replace(/[A-Za-z][\w.]*/g, (w) => (/^(and|or|not)$/i.test(w) ? w.toLowerCase() : /[_.]/.test(w) ? humanMetric(w).label : w));
	return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Which numbers the gate checks: the calibrated ones when it names one. */
export function gateBasis(expr: string | null | undefined): "calibrated" | "raw" | null {
	if (!expr) return null;
	return /\bcalibrated_/.test(expr) ? "calibrated" : "raw";
}

/** The numbers a stage's gate names that the stage's own results don't carry
 *  — a gate over a missing number can't pass, whatever the run's other numbers
 *  say ("Simulate's results didn't include Calibrated meets constraints"). */
export function gateMissing(d: MeCycleDetail | null): { stage: string; missing: string[]; words: string } | null {
	for (const st of stagesOf(d)) {
		const gate = typeof st.gate === "string" ? st.gate : "";
		const m = objOf(st.metrics);
		if (!gate || !m || st.status === "held") continue;
		const names = [...new Set(gate.match(/[A-Za-z_][\w.]*/g) ?? [])].filter((w) => !/^(and|or|not|true|false)$/i.test(w));
		const missing = names.filter((n) => !(n in m) && !(n.replace(/\./g, "_") in m));
		if (!missing.length) continue;
		const stage = stageWords(String(st.loop ?? st.step ?? "this step"));
		return { stage, missing, words: `${stage}'s results didn't include ${missing.map((n) => humanMetric(n).label).join(", ")}, so its gate couldn't pass` };
	}
	return null;
}

/**
 * A gate held the later steps back: "Stopped after Simulate" · "Missed TTFT p99
 * (2,173.1 ms > 2,000 ms); Sandbox held (not run)". Read from the run's stages
 * (`status: "held"`) or `held_at`; the reason is the limits it missed (on the
 * gate's basis when it has one), else the gate itself.
 */
export function gateStop(d: MeCycleDetail | null, specGate?: string | null): { headline: string; sentence: string; after: string; held: string[] } | null {
	if (!d) return null;
	const s = (d.summary || {}) as Record<string, unknown>;
	const stages = stagesOf(d);
	const heldStages = stages.filter((st) => st.status === "held");
	const heldSteps = (d.steps || []).filter(stepHeld);
	const heldAt = typeof s.held_at === "string" && s.held_at ? s.held_at : null;
	// A stage whose gate said no (the chain engine's `filtered`; later stages
	// `skipped`) — the run did its job and stopped the version there. It read
	// "Succeeded" with a "filtered: sharpe_is_phase_mean 0.3349 < 0.5" step.
	const filtered = stages.find((st) => st.status === "filtered");
	const filteredAt = typeof s.filtered_at === "string" && s.filtered_at ? s.filtered_at : filtered ? String(filtered.loop ?? filtered.step ?? "") : "";
	const filteredStep = (d.steps || []).find(stepFiltered);
	if (filteredAt || filteredStep) {
		const at = stageWords(filteredAt || filteredStep?.step_id || "");
		const why = String((filtered?.reason ?? s.reason ?? filteredStep?.output_summary ?? "") || "");
		const skipped = stages.filter((st) => st.status === "skipped").map((st) => stageWords(String(st.loop ?? st.step ?? ""))).filter(Boolean);
		const reason = why ? `Didn't pass its gate: ${gateReasonWords(why)}` : "Didn't pass its gate";
		const sentence = [reason, skipped.length ? `${skipped.join(", ")} not run` : ""].filter(Boolean).join("; ");
		return { headline: at ? `Stopped at ${at}` : "Stopped by a gate", sentence, after: at, held: skipped };
	}
	if (!heldStages.length && !heldSteps.length && !heldAt) return null;
	const held = [...new Set([...heldStages.map((st) => String(st.loop ?? st.step ?? "")), ...heldSteps.map((st) => st.step_id)].filter(Boolean))].map(stageWords);
	const firstHeld = stages.findIndex((st) => st.status === "held");
	const prev = firstHeld > 0 ? stages[firstHeld - 1] : null;
	const after = stageWords(heldAt ?? String(prev?.loop ?? prev?.step ?? "") ?? "");
	const gate = runGate(d, specGate);
	const basis = gateBasis(gate);
	const limits = runLimits(d);
	const missedOn = (cal: boolean) => limits.filter((l) => (cal ? l.calibrated?.met === false : l.met === false)).map((l) => {
		const c = cal ? l.calibrated! : l;
		return `${l.label} (${c.observed}${l.limit ? ` ${cmpWord(cal ? l.calibrated!.value : l.value, l.limitValue)} ${l.limit}` : ""})`;
	});
	let missed = basis === "calibrated" ? missedOn(true) : [];
	if (!missed.length) missed = missedOn(false);
	const reason = missed.length ? `Missed ${missed.join(", ")}` : gate ? `Didn't pass its gate (${gateWords(gate)})` : "";
	const heldWords = held.length ? `${held.join(", ")} held (not run)` : "";
	const sentence = [reason, heldWords].filter(Boolean).join("; ");
	return { headline: after ? `Stopped after ${after}` : "Stopped by a gate", sentence, after, held };
}

function cmpWord(obs: number | undefined, limit: number | undefined): string {
	if (typeof obs !== "number" || typeof limit !== "number") return "vs";
	return obs > limit ? ">" : obs < limit ? "<" : "=";
}

// ── before → after ────────────────────────────────────────────────────────

/** Words that mean lower is better in a metric's name. */
const LOWER_BETTER = /(error|err|loss|latency|ttft|tpot|e2e|makespan|regret|drawdown|cost|energy|power|_ms|miss)/;

export interface BeforeAfter { key: string; label: string; beforeKey: string; afterKey: string; before: string; after: string; better: boolean | null; text: string }

/**
 * A pair the run recorded as `<x>_before` / `<x>_after` (error_before_pct /
 * error_after_pct), said as ONE line marked better or worse — "64.8% → 136.4%
 * (worse; not applied: 1 more design needed)" — with the run's own status
 * words when it says the change wasn't applied.
 */
export function beforeAfter(d: MeCycleDetail | null): BeforeAfter[] {
	const m = flatMetrics(d);
	const out: BeforeAfter[] = [];
	for (const bk of Object.keys(m)) {
		const mt = bk.match(/^(.*?)(?:^|_)before(_.*)?$/);
		if (!mt || typeof m[bk] !== "number") continue;
		const head = mt[1], tail = mt[2] ?? "";
		const ak = `${head}${head ? "_" : ""}after${tail}`;
		if (typeof m[ak] !== "number") continue;
		const key = `${head}${tail}`.replace(/^_/, "");
		const { label, unit } = humanMetric(key);
		const b = m[bk] as number, a = m[ak] as number;
		const lower = LOWER_BETTER.test(key);
		const better = a === b ? null : lower ? a < b : a > b;
		const verdict = better == null ? "no change" : better ? "better" : "worse";
		const na = notApplied(d);
		const text = `${fmtMetricValue(b, unit, key)} → ${fmtMetricValue(a, unit, key)} (${verdict}${na ? `; ${na}` : ""})`;
		out.push({ key, label, beforeKey: bk, afterKey: ak, before: fmtMetricValue(b, unit, key), after: fmtMetricValue(a, unit, key), better, text });
	}
	return out;
}

/** "not applied: 1 more design needed" when the run's status says its result
 *  is not in use yet (too_few, not_applied, …); "" when it is. */
export function notApplied(d: MeCycleDetail | null): string {
	const st = runField(d, "status");
	if (typeof st !== "string" || !/^(too_few|not_applied|insufficient|pending|unfitted|rejected|skipped)$/.test(st)) return "";
	const said = runField(d, "summary");
	const more = typeof said === "string" ? said.match(/\b(\d+) more\b/) : null;
	if (more) {
		const m = flatMetrics(d);
		const noun = Object.keys(m).map((k) => k.match(/^n_([a-z]+?)s$/)?.[1]).find(Boolean);
		return `not applied: ${more[1]} more ${noun ? `${noun}${more[1] === "1" ? "" : "s"} ` : ""}needed`;
	}
	return `not applied: ${st.replace(/_/g, " ")}`;
}

/** The runs "vs usual" compares against: the same version's (branch label)
 *  when the run names one — a version's history, not every version's mix. */
export function sameVersionRuns<T extends { branch_label?: string }>(cycles: T[], label?: string | null): T[] {
	return label ? cycles.filter((c) => c.branch_label === label) : cycles;
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

const OUTPUT_NOISE = /^(ok|error|outcome|metrics|expanded_args|undeclared_args|module|started_at|ended_at|duration_s|steps|flags|results|performance|claim_id|strategy_id|request_id|program_hash|cycle_ts|config_hash|measured_on|constraints|constraint_rows|workload_rows|summary|retry_after|retry_at|gate|held_at)$/;

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
				// Raw: the page reads ids through humanValue (run-tables.ts), which
				// knows "llm_1_7b" is 1.7B, not "llm 1 7b".
				out.fields.push({ label, value: t });
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

export interface RunLimit {
	label: string; rule: string; observed: string; met: boolean | null;
	/** The limit alone, formatted ("2,000 ms"), and as a number. */
	limit?: string; limitValue?: number;
	/** The observed number. */
	value?: number;
	/** The same limit on the run's calibrated number (`calibrated_<metric>`),
	 *  when the run reports one. */
	calibrated?: { observed: string; value: number; met: boolean | null };
}

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
	const m = flatMetrics(d);
	const out: RunLimit[] = [];
	for (const c of raw as Array<Record<string, unknown>>) {
		const key = typeof c.metric === "string" ? c.metric : "";
		if (!key) continue;
		const hm = humanMetric(key);
		const opRaw = typeof c.op === "string" ? c.op : "";
		const op = opRaw.replace("<=", "≤").replace(">=", "≥");
		const fmt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? fmtMetricValue(v, hm.unit, key) : "—");
		const rule = typeof c.value === "number" ? `${op} ${fmt(c.value)}`.trim() : "no limit set";
		const lim: RunLimit = { label: hm.label, rule, observed: fmt(c.observed), met: typeof c.met === "boolean" ? c.met : null };
		if (typeof c.value === "number") { lim.limit = fmt(c.value); lim.limitValue = c.value; }
		if (typeof c.observed === "number") lim.value = c.observed;
		const cal = m[`calibrated_${key.replace(/\./g, "_")}`];
		if (typeof cal === "number" && Number.isFinite(cal)) {
			lim.calibrated = { observed: fmt(cal), value: cal, met: typeof c.value === "number" && opRaw ? meetsOp(cal, opRaw, c.value) : null };
		}
		out.push(lim);
	}
	return out;
}

/** `observed <op> limit`, for the ops a constraint may use; null when unknown. */
export function meetsOp(observed: number, op: string, limit: number): boolean | null {
	switch (op.trim()) {
		case "<": return observed < limit;
		case "<=": case "≤": return observed <= limit;
		case ">": return observed > limit;
		case ">=": case "≥": return observed >= limit;
		case "==": case "=": return observed === limit;
		default: return null;
	}
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
	if (typeof on === "string" && on.trim()) {
		// A result an identical earlier measurement answered (/me/measure) says so,
		// unless the app's own words already do.
		const reused = m.reused === true && !/reused/i.test(on) ? " · reused from an identical run" : "";
		return { measured: true, text: `Measured on ${on.trim()}${reused}` };
	}
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

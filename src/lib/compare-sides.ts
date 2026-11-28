// compare-sides — the Compare page's data, as pure functions: which runs or
// versions the address names, each side's numbers and settings (from
// me.cycleDetail or me.experiment().results[]), which settings differ, and
// whether the sides were measured the same way. The verdict itself is
// compareSides() in compare.ts. Tested in compare-sides.test.ts.
//
//   /studio/apps/:app/compare?runs=<loop>:<ts>,<loop>:<ts>
//   /studio/apps/:app/compare?versions=<expId>:<versionId>,…

import { rowStep, stepOrder, stepPhrase } from "@/lib/evolution";
import type { MeCycleDetail, MeExperimentDetail, MeExperimentVariantAgg } from "@/api/me";
import { runMetricValues, metricBetter, type SideInput, type SideStats, type MetricSpec, type SideCell } from "@/lib/compare";
import { humanMetric, fmtMetricValue, primaryMetricKey, measuredOn, isFindingKey } from "@/lib/run-answer";
import { humanId, versionsOf, experimentLabel} from "@/lib/research-map";
import { toCycleId } from "@/lib/cycle-id";
import { dirIdToSec } from "@/lib/activity";

export const MIN_SIDES = 2;
export const MAX_SIDES = 5;
const LETTERS = "ABCDE";

export type SideRef =
	| { kind: "run"; loop: string; ts: string }
	| { kind: "version"; exp: string; version: string };

/** Metric name in words: "ttft_ms_p99" → "TTFT p99". */
export const mLabel = (name: string): string => humanMetric(name).label;
/** A value with its unit: "22.4 tok/s", "85%". */
export const mVal = (name: string, v: number): string => {
	const h = humanMetric(name);
	const t = fmtMetricValue(v, h.unit, name);
	return h.unit && !t.endsWith("%") && !t.includes(h.unit) ? `${t} ${h.unit}` : t;
};

/** The sides an address names (runs first, then versions), deduplicated and
 *  capped at five, with a sentence when the address can't be used as is. */
export function parseCompareQuery(search: string): { refs: SideRef[]; note: string | null } {
	const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	const refs: SideRef[] = [];
	const seen = new Set<string>();
	const add = (r: SideRef, key: string) => { if (!seen.has(key)) { seen.add(key); refs.push(r); } };
	for (const part of (sp.get("runs") || "").split(",")) {
		const p = part.trim();
		const i = p.lastIndexOf(":");
		if (i <= 0 || i === p.length - 1) continue;
		const loop = p.slice(0, i), ts = toCycleId(p.slice(i + 1));
		add({ kind: "run", loop, ts }, `r:${loop}:${ts}`);
	}
	for (const part of (sp.get("versions") || "").split(",")) {
		const p = part.trim();
		const i = p.indexOf(":");
		if (i <= 0 || i === p.length - 1) continue;
		const exp = p.slice(0, i), version = p.slice(i + 1);
		add({ kind: "version", exp, version }, `v:${exp}:${version}`);
	}
	if (refs.length < MIN_SIDES) return { refs, note: "Pick at least two runs or versions to compare." };
	if (refs.length > MAX_SIDES) return { refs: refs.slice(0, MAX_SIDES), note: `Showing the first ${MAX_SIDES} of ${refs.length} — compare up to ${MAX_SIDES} at a time.` };
	return { refs, note: null };
}

export interface CompareSide extends SideInput {
	key: string;
	letter: string;
	/** "Backtest, 27 Nov 12:44" / "Reserve 90%". */
	name: string;
	/** "succeeded" / "12 results" — one quiet line under the name. */
	sub: string;
	/** Settings in reading order: [label, value]. */
	settings: Array<[string, string]>;
	primary?: string;
	higherIsBetter?: boolean | null;
	/** Per-run points for the charts (values in order). */
	ok?: boolean;
	/** The experiment itself says its versions can't be ranked. */
	incomparable?: string;
}

/** "27 Nov 12:44" in the reader's time zone. */
export function runWhen(ts: string, seconds = false): string {
	const sec = dirIdToSec(toCycleId(ts));
	if (sec == null) return ts;
	return new Date(sec * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}

/** "current" / "baseline" read as "Current version"; ids in words. */
export function versionName(id: string): string {
	return /^(current|baseline)$/i.test(id) ? "Current version" : humanId(id);
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const short = (v: unknown): string | null => {
	if (typeof v === "string") { const t = v.trim(); return t && t.length <= 80 && !t.includes("\n") ? t : null; }
	if (typeof v === "number" && isFinite(v)) return String(v);
	if (typeof v === "boolean") return v ? "yes" : "no";
	return null;
};

/** A setting's value as read: a lower-case code ("pg_tape") in words
 *  ("Pg tape"); names, symbols and numbers as written. */
export function settingWords(v: string): string {
	return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(v) ? humanId(v) : v;
}

// Settings a run reports alongside its numbers: what it ran on, not what it found.
const RUN_SETTING_KEYS = ["symbol", "strategy_id", "strategy", "design_id", "profile", "simulator_version", "image_tag", "replay", "signals", "settlement"];
// Numbers that describe the run's bookkeeping, not its result.
const NOT_COMPARED = /^(arm|base|seed|tape_window_secs|tape_window_source)$/;

/** One run as a side: its findings (numbers; true/false as 1/0) and settings. */
export function runSide(ref: { loop: string; ts: string }, d: MeCycleDetail | null, index: number, workflowTitle?: string): CompareSide {
	const s = obj(d?.summary);
	const metrics = { ...obj(obj(s.command_engine).metrics), ...obj(s.metrics) };
	const values: Record<string, number[]> = {};
	for (const [k, v] of runMetricValues([metrics])) if (isFindingKey(k) && !NOT_COMPARED.test(k)) values[k] = v;
	const cost = obj(s.cost).cost_usd;
	if (typeof cost === "number" && isFinite(cost) && cost > 0) values.cost_usd = [cost];

	const wf = workflowTitle || humanId(ref.loop);
	const settings: Array<[string, string]> = [["Workflow", wf]];
	const lineage = obj(obj(s.lineage).variant);
	const arm = short(metrics.arm) ?? (typeof s.experiment === "string" ? s.experiment : null) ?? short(lineage.arm);
	if (arm) settings.push(["Version", versionName(arm)]);
	const on = measuredOn(d);
	if (on) settings.push(["Measured on", on]);
	const assets = obj(s.assets_used);
	const ds = obj(assets.dataset);
	if (typeof ds.id === "string" && ds.id) settings.push(["Data", `${humanId(ds.id)}${typeof ds.version === "string" && ds.version ? ` (version ${ds.version})` : ""}`]);
	const site = d?.compute_jobs?.[0]?.site || (typeof metrics.fleet_job === "string" && metrics.fleet_job.includes(":") ? metrics.fleet_job.split(":")[0] : "");
	const gpu = short(metrics.gpu);
	if (gpu || site) settings.push(["Compute", [gpu, site ? `at ${site}` : ""].filter(Boolean).join(" ")]);
	if (typeof s.mode === "string" && s.mode) settings.push(["Mode", s.mode.charAt(0).toUpperCase() + s.mode.slice(1)]);
	const appV = short(obj(assets.app).version);
	if (appV) settings.push(["App version", appV]);
	for (const src of [obj(s.args), obj(s.inputs), obj(metrics.expanded_args)]) {
		for (const [k, v] of Object.entries(src)) { const t = short(v); if (t) settings.push([`Input: ${mLabel(k)}`, settingWords(t)]); }
	}
	for (const k of RUN_SETTING_KEYS) { const t = short(metrics[k]); if (t) settings.push([mLabel(k), settingWords(t)]); }

	const letter = LETTERS[index] ?? String(index + 1);
	const name = arm ? `${wf} · ${versionName(arm)}` : wf;
	const hib = obj(assets.metric).higher_is_better;
	const state = !d ? "couldn't read this run" : d.running ? "running" : d.ok === false ? "failed" : "succeeded";
	return {
		key: `r:${ref.loop}:${ref.ts}`, letter, name, label: sideLabel(letter, name),
		sub: `${runWhen(ref.ts)} · ${state}`,
		values, settings: dedupeSettings(settings),
		primary: primaryMetricKey(d ?? null) ?? undefined,
		higherIsBetter: typeof hib === "boolean" ? hib : null,
		ok: d ? d.ok !== false : undefined,
	};
}

/** How a side is named in a sentence: "B (Util 0 9)", or just "B" when the
 *  name is too long to read inline (the column header carries it). */
export function sideLabel(letter: string, name: string): string {
	return name && name.length <= 24 ? `${letter} (${name})` : letter;
}

/** Two sides with the same name (two runs of one setup) get their time added,
 *  so no two columns read alike. */
export function distinctNames(sides: CompareSide[]): CompareSide[] {
	const count = new Map<string, number>();
	for (const s of sides) count.set(s.name, (count.get(s.name) ?? 0) + 1);
	return sides.map((s) => {
		if ((count.get(s.name) ?? 0) < 2 || !s.key.startsWith("r:")) return s;
		// Runs of one setup minutes apart: the time to the second tells them apart.
		const name = `${s.name}, ${runWhen(s.key.slice(s.key.lastIndexOf(":") + 1), true)}`;
		return { ...s, name, label: sideLabel(s.letter, name) };
	});
}

function dedupeSettings(s: Array<[string, string]>): Array<[string, string]> {
	const seen = new Set<string>();
	return s.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)));
}

/** One version of an experiment as a side: its per-run values from the
 *  ledger (`results[]`), else the served averages for the experiment's metric.
 *  ONE step's rows (2026-11-28): a version measured by the simulator and on a
 *  GPU is compared at the last step it reached (or `opts.step`), never on the
 *  average of both — the side says which step. */
export function versionSide(e: MeExperimentDetail, versionId: string, index: number, opts: { workflowTitle?: (loop: string) => string; showExperiment?: boolean; step?: string; steps?: Array<{ step: string; metrics?: Array<{ name: string }> }> } = {}): CompareSide {
	const all = (e.results || []).filter((r) => r.variant_id === versionId);
	const order = stepOrder(all, opts.steps);
	const step = order.length > 1 ? (opts.step !== undefined && order.includes(opts.step) ? opts.step : order[order.length - 1]) : null;
	const rows = step === null ? all : all.filter((r) => rowStep(r, opts.steps) === step);
	const values: Record<string, number[]> = {};
	for (const [k, v] of runMetricValues(rows.map((r) => r.metrics as Record<string, unknown>))) if (isFindingKey(k) && !NOT_COMPARED.test(k)) values[k] = v;
	const state = obj(e.state);
	const metric = e.metric?.name || e.metric_name || "";
	const aggs = obj(state.variants ?? e.variants) as Record<string, MeExperimentVariantAgg | undefined>;
	const agg = aggs[versionId];
	const stats: Record<string, SideStats | null> = {};
	if (metric && agg && agg.n > 0 && !values[metric]) {
		stats[metric] = { n: agg.n, mean: agg.mean, sd: agg.stdev ?? 0, min: agg.mean, max: agg.mean, latest: agg.last ?? agg.mean };
	}
	const info = versionsOf(e).find((v) => v.id === versionId);
	const vName = info?.label ?? versionName(versionId);
	const settings: Array<[string, string]> = [["Experiment", experimentLabel(e)], ["Version", vName]];
	const loop = e.dispatch?.loop || e.loops?.[0];
	if (loop) settings.push(["Workflow", opts.workflowTitle?.(loop) || humanId(loop)]);
	const arm = (e.arms || []).find((a) => a.id === versionId);
	if (arm?.description) settings.push(["What it changes", String(arm.description)]);
	for (const [k, v] of Object.entries(obj(arm?.overrides))) { const t = short(v); if (t) settings.push([`Changes: ${mLabel(k)}`, t]); }
	if (e.dataset_id) settings.push(["Data", `${humanId(e.dataset_id)}${typeof state.dataset_version === "string" && state.dataset_version ? ` (version ${state.dataset_version})` : ""}`]);
	if (metric) settings.push(["Judged on", mLabel(metric)]);
	if (step !== null) settings.push(["Step", stepPhrase(step, rows).replace(/^at /, "") || "unnamed step"]);
	const n = rows.length || stats[metric]?.n || 0;
	const comparable = (state.comparable ?? e.comparable) as boolean | undefined;
	const instruments = (state.instruments ?? e.instruments) as number | null | undefined;
	const letter = LETTERS[index] ?? String(index + 1);
	const name = opts.showExperiment ? `${vName} (${experimentLabel(e)})` : vName;
	return {
		key: `v:${e.id}:${versionId}`, letter, name, label: sideLabel(letter, name),
		sub: !n ? "no results yet" : rows.length ? `${n.toLocaleString()} result${n === 1 ? "" : "s"}` : `${n.toLocaleString()} result${n === 1 ? "" : "s"} (averages only)`,
		values, stats, settings,
		primary: metric || undefined,
		higherIsBetter: e.metric?.higher_is_better ?? e.higher_is_better ?? null,
		incomparable: comparable === false
			? `The experiment says its versions were measured ${instruments && instruments > 1 ? `${instruments} different ways` : "differently"}, so it does not rank them`
			: undefined,
	};
}

/** The metrics to compare, primary first: each side's judged-on metric, then
 *  the ones every side has, then the ones at least two sides have. A metric
 *  only one side reports can't be compared and is left out. */
export function metricsToCompare(sides: CompareSide[]): MetricSpec[] {
	const has = (m: string) => sides.filter((s) => (s.values[m]?.length ?? 0) > 0 || s.stats?.[m] != null).length;
	const all = new Set<string>();
	for (const s of sides) { for (const k of Object.keys(s.values)) all.add(k); for (const k of Object.keys(s.stats || {})) all.add(k); }
	const primaries = [...new Set(sides.map((s) => s.primary).filter((p): p is string => !!p && all.has(p)))];
	// Differences first: a metric whose values differ across sides before one
	// that reads the same everywhere.
	const sig = (s: CompareSide, m: string) => JSON.stringify(s.values[m] ?? (s.stats?.[m] ? [s.stats[m]!.mean, s.stats[m]!.n] : null));
	const differs = (m: string) => new Set(sides.map((s) => sig(s, m))).size > 1 ? 1 : 0;
	const rest = [...all].filter((m) => !primaries.includes(m)).sort((a, b) => has(b) - has(a) || differs(b) - differs(a) || a.localeCompare(b));
	const keep = [...primaries.filter((m) => has(m) >= 1), ...rest.filter((m) => has(m) >= Math.min(2, sides.length))];
	return keep.map((name) => {
		const hib = sides.find((s) => s.primary === name)?.higherIsBetter;
		return { name, label: mLabel(name), better: metricBetter(name, hib) };
	});
}

/** Settings that differ across sides, and the ones that are the same. A side
 *  that does not report a setting reads "not reported" ("unchanged" for a
 *  version's change). */
export function settingDiffs(sides: Array<{ settings: Array<[string, string]> }>): {
	differ: Array<{ key: string; values: string[] }>;
	same: Array<{ key: string; value: string }>;
} {
	const keys: string[] = [];
	for (const s of sides) for (const [k] of s.settings) if (!keys.includes(k)) keys.push(k);
	const differ: Array<{ key: string; values: string[] }> = [];
	const same: Array<{ key: string; value: string }> = [];
	for (const k of keys) {
		// A version that does not change a setting keeps the baseline's.
		const missing = k.startsWith("Changes:") ? "unchanged" : "not reported";
		const values = sides.map((s) => s.settings.find(([kk]) => kk === k)?.[1] ?? missing);
		if (values.every((v) => v === values[0])) same.push({ key: k, value: values[0] });
		else differ.push({ key: k, values });
	}
	return { differ, same };
}

/** "4 settings the same" / "1 setting the same". */
export function sameSettingsWords(n: number): string {
	return `${n} setting${n === 1 ? "" : "s"} the same`;
}

/** "12 metrics the same on every side". */
export function sameMetricsWords(n: number): string {
	return `${n} metric${n === 1 ? "" : "s"} the same on every side`;
}

const stripReuse = (s: string) => s.replace(/\s*·\s*reused from an identical run\s*$/i, "").trim();

/** Were the sides measured the same way? A sentence when they weren't — a
 *  different workflow, instrument or judging metric — said before any number. */
export function measuredDifferently(sides: CompareSide[]): string | null {
	const parts: string[] = [];
	for (const key of ["Workflow", "Measured on", "Judged on"]) {
		const vals = sides.map((s) => s.settings.find(([k]) => k === key)?.[1]).filter((v): v is string => !!v).map(stripReuse);
		const distinct = [...new Set(vals)];
		if (distinct.length > 1) parts.push(`${key === "Workflow" ? "workflow" : key === "Measured on" ? "measured on" : "judged on"} ${distinct.join(" vs ")}`);
	}
	const own = sides.find((s) => s.incomparable)?.incomparable;
	if (!parts.length && !own) return null;
	const lead = parts.length ? `These were measured differently (${parts.join("; ")})` : own!;
	return `${parts.length && own ? `${lead}. ${own}` : lead}. Read each number on its own terms, not as a race.`;
}

/** "+0.3 (+30%)", "−12 ms (−8%)"; "" on the baseline. */
export function deltaWords(metric: string, cell: SideCell): string {
	if (cell.delta == null) return "";
	if (cell.delta === 0) return "same";
	const sign = cell.delta > 0 ? "+" : "−";
	const pct = cell.deltaPct != null && Math.abs(cell.deltaPct) < 1000 ? ` (${sign}${Math.abs(cell.deltaPct).toFixed(Math.abs(cell.deltaPct) < 10 ? 1 : 0)}%)` : "";
	return `${sign}${mVal(metric, Math.abs(cell.delta))}${pct}`;
}

/** Is a change an improvement? true/false, null when there is no change. */
export function deltaIsBetter(cell: SideCell, better: "higher" | "lower"): boolean | null {
	if (cell.delta == null || cell.delta === 0) return null;
	return better === "higher" ? cell.delta > 0 : cell.delta < 0;
}

/** "1.42 ± 0.12" (just the mean when there is one value). */
export function meanWords(metric: string, s: SideStats | null): string {
	if (!s) return "";
	return s.n > 1 && s.sd > 0 ? `${mVal(metric, s.mean)} ± ${mVal(metric, s.sd)}` : mVal(metric, s.mean);
}

/** The y-range for a metric's small chart. From zero when every value is on
 *  one side of it (so bar lengths mean something); flagged when it isn't. */
export function chartScale(values: number[]): { lo: number; hi: number; fromZero: boolean } {
	const v = values.filter((x) => isFinite(x));
	if (!v.length) return { lo: 0, hi: 1, fromZero: true };
	const min = Math.min(...v), max = Math.max(...v);
	if (min >= 0) return { lo: 0, hi: max > 0 ? max : 1, fromZero: true };
	if (max <= 0) return { lo: min, hi: 0, fromZero: true };
	return { lo: min, hi: max, fromZero: false };
}

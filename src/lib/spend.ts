// spend — what research cost, in words: device-minutes first, then dollars
// (notional only where they are).
//
// Round 10 (2026-11-28), shared by every research app. The platform meters
// what each run and measurement used (LumidOS sdk/apps/usage.py, identity
// /me/measure + /me/usage) under one contract:
//   metrics  cpu_s · gpu_s · wall_s · cost_usd · saved_cpu_s · saved_gpu_s
//   dims     gpu_type ("RTX 5080") · metered (measured | estimated | reused)
// A field nobody measured is ABSENT, never 0 — so this module can say "not
// metered" instead of a false "$0". Owned hardware has no bill: dollars come
// from platform rates and are notional, a unit for putting CPU and GPU work
// on one axis. Every sentence leads with device-minutes.
//
// Round 11 (2026-11-28): "notional" applies only to the notional PART. Model
// calls (pooled-llm measurements, Claude through the proxy) are priced at list
// price and are real money; identity's /me/usage says which part of its LLM
// spend is notional (`used.llm.notional_usd`). A row's notional part is what
// its device time costs at the platform rates; the rest of its cost_usd is a
// bill. A step that spends real money is priced in dollars first.
//
// Pure functions only; every word the UI shows about spend is made here.

import type { MeExperimentRow } from "@/api/me";

/** One run's (or one measurement's) usage, as the contract names it. */
export interface Usage {
	cpu_s?: number;
	gpu_s?: number;
	wall_s?: number;
	cost_usd?: number;
	saved_cpu_s?: number;
	saved_gpu_s?: number;
	gpu_type?: string;
	metered?: "measured" | "estimated" | "reused" | string;
}

/** A total over many runs. */
export interface Spend {
	runs: number;
	/** Runs whose usage someone measured (incl. reused ones, which cost 0). */
	metered: number;
	reused: number;
	estimated: number;
	cpu_s: number;
	gpu_s: number;
	cost_usd: number;
	/** The part of cost_usd that is device time at platform rates (no bill). */
	notional_usd: number;
	duration_s: number;
	saved_cpu_s: number;
	saved_gpu_s: number;
	/** GPU seconds by device name. */
	gpu_by_type: Record<string, number>;
}

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const USAGE_KEYS = ["cpu_s", "gpu_s", "wall_s", "cost_usd", "saved_cpu_s", "saved_gpu_s"] as const;

/** The usage a ledger row carries (metrics + dims), or null when unmetered. */
export function usageOfRow(r: Pick<MeExperimentRow, "metrics" | "dims">): Usage | null {
	return usageOf({ ...(r.metrics ?? {}), ...(r.dims ?? {}) });
}

/** Usage from any flat or nested blob: a row's metrics, a run's
 *  `metrics.usage`, a measurement's `result.usage`. null when nothing in it
 *  was metered. `cost_usd` alone (an LLM bill) counts as metered spend. */
export function usageOf(blob: unknown): Usage | null {
	if (!blob || typeof blob !== "object") return null;
	const o = blob as Record<string, unknown>;
	const src = o.usage && typeof o.usage === "object" ? (o.usage as Record<string, unknown>) : o;
	const u: Usage = {};
	for (const k of USAGE_KEYS) {
		const v = num(src[k]);
		if (v !== undefined) u[k] = v;
	}
	if (typeof src.gpu_type === "string" && src.gpu_type) u.gpu_type = src.gpu_type;
	if (typeof src.metered === "string" && src.metered) u.metered = src.metered;
	const any = USAGE_KEYS.some((k) => u[k] !== undefined) || u.metered === "reused";
	return any ? u : null;
}

/** identity's default notional rates ($/hour; me_usage.go usageDefaultRates). */
const DEFAULT_RATES = { cpu_core_hour: 0.02, gpu_hour: { "RTX 5080": 0.25, "RTX 5090": 0.4, "RTX PRO 4000": 0.3, "RTX 6000 Ada": 0.8, H100: 2, H200: 2.5, "*": 0.5 } as Record<string, number> };
export type Rates = { cpu_core_hour?: number; gpu_hour?: Record<string, number>; notional?: boolean };

/** What device time costs at the platform rates (notional): the GPU rate by
 *  the longest known name inside the device's, as identity prices it. */
export function deviceCostUsd(gpu_s: number, cpu_s: number, gpuType = "", rates: Rates = DEFAULT_RATES): number {
	const table = rates.gpu_hour ?? DEFAULT_RATES.gpu_hour;
	let rate = table[gpuType];
	if (rate === undefined) {
		const low = gpuType.toLowerCase();
		const hit = Object.keys(table).filter((k) => k !== "*" && low && low.includes(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
		rate = hit ? table[hit] : table["*"] ?? 0.5;
	}
	return ((cpu_s || 0) / 3600) * (rates.cpu_core_hour ?? DEFAULT_RATES.cpu_core_hour) + ((gpu_s || 0) / 3600) * rate;
}

/** The notional part of one run's cost: its device time at the platform
 *  rates, never more than the cost itself. The rest is a bill (model calls). */
export function notionalPart(u: Usage): number {
	const cost = u.cost_usd ?? 0;
	if (cost <= 0) return 0;
	if (!(u.gpu_s || u.cpu_s)) return 0;
	return Math.min(cost, deviceCostUsd(u.gpu_s ?? 0, u.cpu_s ?? 0, u.gpu_type ?? ""));
}

/** Dollars with "notional" on the notional part only:
 *  "$0.03 notional" · "$1.49" · "$1.52 ($0.03 of it notional)". */
export function dollarWords(total: number, notional: number): string {
	if (!(total > 0)) return "$0";
	const n = Math.max(0, Math.min(total, notional));
	if (total - n < 0.005) return `${dollars(total)} notional`;
	if (n < 0.005) return dollars(total);
	return `${dollars(total)} (${dollars(n)} of it notional)`;
}

const empty = (): Spend => ({
	runs: 0, metered: 0, reused: 0, estimated: 0, cpu_s: 0, gpu_s: 0, cost_usd: 0, notional_usd: 0, duration_s: 0,
	saved_cpu_s: 0, saved_gpu_s: 0, gpu_by_type: {},
});

/** Add usages up. `runs` counts every input; unmetered ones add nothing. */
export function sumUsage(items: Array<{ usage: Usage | null; duration_s?: number }>): Spend {
	const s = empty();
	for (const it of items) {
		s.runs++;
		const d = num(it.duration_s);
		if (d) s.duration_s += d;
		const u = it.usage;
		if (!u) continue;
		s.metered++;
		if (u.metered === "reused") s.reused++;
		if (u.metered === "estimated") s.estimated++;
		s.cpu_s += u.cpu_s ?? 0;
		s.gpu_s += u.gpu_s ?? 0;
		s.cost_usd += u.cost_usd ?? 0;
		s.notional_usd += notionalPart(u);
		s.saved_cpu_s += u.saved_cpu_s ?? 0;
		s.saved_gpu_s += u.saved_gpu_s ?? 0;
		if (u.gpu_s && u.gpu_s > 0) {
			const t = u.gpu_type || "GPU";
			s.gpu_by_type[t] = (s.gpu_by_type[t] ?? 0) + u.gpu_s;
		}
	}
	return s;
}

/** Spend over ledger rows — optionally one feedback step's (`dims.stage`). */
export function stepSpend(rows: MeExperimentRow[], step?: string): Spend {
	// Discarded results still used what they used: spend counts every row.
	const pick = step === undefined ? rows : rows.filter((r) => (r.dims?.stage ?? "") === step);
	return sumUsage(pick.map((r) => ({ usage: usageOfRow(r), duration_s: num(r.metrics?.duration_s) })));
}

/** An experiment's total spend (every row). */
export function experimentSpend(rows: MeExperimentRow[]): Spend {
	return stepSpend(rows);
}

// ── numbers in words ─────────────────────────────────────────────────────

/** Device-seconds as minutes: "12 s" · "4.5 min" · "38 min" · "2.4 h". */
export function deviceTime(sec: number): string {
	if (!Number.isFinite(sec) || sec <= 0) return "0 min";
	if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
	const m = sec / 60;
	if (m < 10) return `${Math.round(m * 10) / 10} min`;
	if (m < 120) return `${Math.round(m)} min`;
	return `${Math.round((m / 60) * 10) / 10} h`;
}

/** "$0.03" · "<$0.01" — always marked notional by the caller's sentence. */
export function dollars(x: number): string {
	if (!Number.isFinite(x) || x <= 0) return "$0";
	if (x < 0.01) return "<$0.01";
	if (x >= 1000) return `$${Math.round(x).toLocaleString("en-US")}`;
	return `$${x.toFixed(2)}`;
}

/** The main device of a spend: the GPU type with the most seconds. */
export function mainGpu(s: Pick<Spend, "gpu_by_type">): string | undefined {
	let best: string | undefined;
	for (const [t, v] of Object.entries(s.gpu_by_type)) if (!best || v > s.gpu_by_type[best]) best = t;
	return best && best !== "GPU" ? best : undefined;
}

/** "6.9 GPU-min on RTX 5080 · 0.2 CPU-min" (no dollars — see spendWords). */
export function deviceWords(s: Pick<Spend, "gpu_s" | "cpu_s" | "gpu_by_type">): string {
	const parts: string[] = [];
	if (s.gpu_s > 0) {
		const types = Object.keys(s.gpu_by_type).filter((t) => t !== "GPU");
		const on = types.length === 1 ? ` on ${types[0]}` : types.length > 1 ? ` on ${types.length} GPU types` : "";
		parts.push(`${deviceTime(s.gpu_s).replace(/ (min|s|h)$/, " GPU-$1")}${on}`);
	}
	if (s.cpu_s > 0) parts.push(deviceTime(s.cpu_s).replace(/ (min|s|h)$/, " CPU-$1"));
	return parts.join(" · ");
}

/** One line for a total: device-minutes, then notional dollars, then what
 *  reuse saved. Honest about runs nobody metered. */
export function spendWords(s: Spend): string {
	if (!s.runs) return "Nothing has run yet";
	if (!s.metered) return s.duration_s > 0 ? `Not metered · ${deviceTime(s.duration_s).replace(/ (min|s|h)$/, " $1")} of run time` : "Not metered";
	const dev = deviceWords(s);
	const parts: string[] = [];
	if (dev) parts.push(dev);
	else if (s.reused === s.metered) parts.push("Free — every result was reused");
	if (s.cost_usd > 0) parts.push(dollarWords(s.cost_usd, s.notional_usd));
	const saved = s.saved_gpu_s > 0 ? deviceTime(s.saved_gpu_s).replace(/ (min|s|h)$/, " GPU-$1") : s.saved_cpu_s > 0 ? deviceTime(s.saved_cpu_s).replace(/ (min|s|h)$/, " CPU-$1") : "";
	if (s.reused && saved) parts.push(`reuse saved ${saved}`);
	const unmetered = s.runs - s.metered;
	if (unmetered > 0) parts.push(`${unmetered} ${unmetered === 1 ? "run" : "runs"} not metered`);
	return parts.join(" · ") || "Not metered";
}

/** One run's usage in words: "6.9 GPU-min on RTX 5080 · $0.03 notional",
 *  "Free — reused (saved 6.9 GPU-min)", or "Not metered". */
export function usageWords(u: Usage | null): string {
	if (!u) return "Not metered";
	if (u.metered === "reused") {
		const saved = u.saved_gpu_s ? `${deviceTime(u.saved_gpu_s).replace(/ (min|s|h)$/, " GPU-$1")}` : u.saved_cpu_s ? `${deviceTime(u.saved_cpu_s).replace(/ (min|s|h)$/, " CPU-$1")}` : "";
		return saved ? `Free — reused (saved ${saved})` : "Free — reused";
	}
	const s = sumUsage([{ usage: u }]);
	const words = spendWords(s);
	return u.metered === "estimated" ? `About ${words.charAt(0).toLowerCase()}${words.slice(1)} (estimated)` : words;
}

// ── budgets: /me/usage ───────────────────────────────────────────────────

/** `compute.budget` as the spec declares it (zero/absent = no limit). */
export interface ComputeBudget { gpu_minutes?: number; cpu_minutes?: number; usd?: number; per?: string; parallel?: number }

/** GET /me/usage?app= (identity). Fields absent when unknown. */
export interface InstrumentUse { gpu_s?: number; cpu_s?: number; cost_usd?: number; runs?: number }
/** `used.llm` (identity me_usage_llm.go): attributed model calls. cost_usd is
 *  INCLUDED in used.cost_usd; notional_usd is the part priced from the
 *  platform's notional table (self-hosted models), the rest is list price. */
export interface LlmUse { calls: number; tokens_in: number; tokens_out: number; cost_usd: number; notional_usd?: number }
export interface MeUsage {
	app?: string;
	since?: string | null;
	used: {
		gpu_s: number; cpu_s: number; cost_usd: number; runs: number; running?: number; unmetered_runs?: number; by_device?: Record<string, number>;
		tokens_in?: number; tokens_out?: number;
		/** This app's measurements by instrument (all apps when no app was asked). */
		by_instrument?: Record<string, InstrumentUse>;
		by_workflow?: Record<string, InstrumentUse>;
		/** GPU seconds by UTC day. */
		by_day?: Record<string, number>;
		llm?: LlmUse;
	};
	rates?: Rates;
	/** The account's daily GPU-measurement cap and today's count (identity, 2026-11-28). Absent on older identity. */
	limits?: { gpu_measurements_per_day?: number; gpu_measurements_today?: number };
	saved?: { gpu_s: number; cpu_s: number; reused_runs: number };
	budget?: ComputeBudget;
	remaining?: { gpu_s?: number; cpu_s?: number; cost_usd?: number };
	estimates?: Record<string, { gpu_s?: number; cpu_s?: number; gpu_type?: string; cost_usd?: number; from_runs: number }>;
}

const perWords = (per?: string) => (per === "day" ? " today" : per === "week" ? " this week" : "");

/** The notional part of an app's dollars: its measurements' device time (when
 *  the platform's rates are notional) plus the notional part of its LLM spend.
 *  Pooled-llm measurements and Claude are list price: not notional. */
export function usageNotionalUsd(u: MeUsage): number {
	const devNotional = u.rates?.notional === false ? 0 : (() => {
		const by = u.used.by_instrument;
		// An instrument that used device time is priced from it; one that
		// used none (pooled-llm) carries its own list-price bill.
		if (by) return Object.values(by).reduce((a, x) => a + ((x.gpu_s ?? 0) > 0 || (x.cpu_s ?? 0) > 0 ? x.cost_usd ?? 0 : 0), 0);
		return Math.max(0, u.used.cost_usd - (u.used.llm?.cost_usd ?? 0));
	})();
	return Math.min(u.used.cost_usd, devNotional + (u.used.llm?.notional_usd ?? 0));
}

/** One run of an instrument in a budget's unit, from THIS app's own history
 *  (`used.by_instrument`), else the platform estimate — but only for an
 *  instrument this app's spec uses. Another app's instrument never prices
 *  this app's runs (MBB was told "2395 more MLSys GPU sandbox runs"). */
function perRunCosts(u: MeUsage, unit: "GPU-min" | "CPU-min" | "$", instruments?: string[]): Array<{ name: string; v: number }> {
	const val = (e: InstrumentUse, runs: number) => (unit === "GPU-min" ? (e.gpu_s ?? 0) / 60 : unit === "CPU-min" ? (e.cpu_s ?? 0) / 60 : e.cost_usd ?? 0) / Math.max(1, runs);
	const own = Object.entries(u.used.by_instrument ?? {}).filter(([name, e]) => name !== "(unnamed)" && (e.runs ?? 0) > 0).map(([name, e]) => ({ name, v: val(e, e.runs ?? 1) }));
	const ownNames = new Set(own.map((x) => x.name));
	const est = Object.entries(u.estimates ?? {}).filter(([name]) => !ownNames.has(name) && !!instruments?.includes(name)).map(([name, e]) => ({ name, v: val(e, 1) }));
	return [...own, ...est].filter((x) => x.v > 0);
}

/** A budget's state, as a meter: share used and the sentence beside it.
 *  null when the app declares no budget. `instruments`: the services this
 *  app's spec measures with (the only estimates "≈ N more runs" may use). */
export function budgetMeter(u: MeUsage | null | undefined, instrumentWords?: (name: string) => string, opts: { instruments?: string[] } = {}): {
	used: number; limit: number; unit: "GPU-min" | "CPU-min" | "$"; share: number; words: string; low: boolean; over: boolean;
} | null {
	const b = u?.budget;
	if (!u || !b) return null;
	let used: number, limit: number, unit: "GPU-min" | "CPU-min" | "$";
	if (b.gpu_minutes && b.gpu_minutes > 0) { used = u.used.gpu_s / 60; limit = b.gpu_minutes; unit = "GPU-min"; }
	else if (b.cpu_minutes && b.cpu_minutes > 0) { used = u.used.cpu_s / 60; limit = b.cpu_minutes; unit = "CPU-min"; }
	else if (b.usd && b.usd > 0) { used = u.used.cost_usd; limit = b.usd; unit = "$"; }
	else return null;
	const left = Math.max(0, limit - used);
	const share = limit > 0 ? Math.min(1, used / limit) : 0;
	const fmt = (x: number) => (unit === "$" ? dollars(x) : `${x < 10 ? Math.round(x * 10) / 10 : Math.round(x)}`);
	let head: string;
	if (unit === "$") {
		const notional = usageNotionalUsd(u);
		const tag = used - notional < 0.005 && used > 0 ? " notional" : "";
		const part = !tag && notional >= 0.005 ? ` (${dollars(notional)} of it notional)` : "";
		head = `${fmt(used)} of ${fmt(limit)}${tag} used${perWords(b.per)}${part}`;
	} else head = `${fmt(used)} of ${fmt(limit)} ${unit} used${perWords(b.per)}`;
	// "about N more <instrument> runs": from the costliest of THIS app's instruments.
	let more = "";
	const per = perRunCosts(u, unit, opts.instruments).sort((a, b2) => b2.v - a.v)[0];
	if (per && left > 0) {
		const n = Math.floor(left / per.v + 1e-9);
		const what = instrumentWords ? instrumentWords(per.name) : "";
		more = ` (about ${n} more ${what ? `${what} ` : ""}${n === 1 ? "run" : "runs"})`;
	}
	const tail = left <= 0 ? " · none left" : ` · ${unit === "$" ? dollars(left) : `${fmt(left)} ${unit}`} left${more}`;
	return { used, limit, unit, share, words: head + tail, low: left > 0 && share >= 0.8, over: left <= 0 };
}

/** The services (instruments) an app's spec measures with — every workflow's,
 *  or one workflow's feedback steps. */
export function specServices(spec: { workflows: Array<{ id: string; feedback: Array<{ service?: string }> }> } | null | undefined, workflow?: string): string[] {
	const wfs = (spec?.workflows ?? []).filter((w) => workflow === undefined || w.id === workflow);
	return [...new Set(wfs.flatMap((w) => w.feedback.map((f) => f.service ?? "").filter(Boolean)))];
}

/** What's left of a budget, short: "112 GPU-min left" · "$39.08 left" · "Budget used up". */
export function budgetLeftWords(m: { used: number; limit: number; unit: "GPU-min" | "CPU-min" | "$" } | null): string | null {
	if (!m) return null;
	const left = Math.max(0, m.limit - m.used);
	if (left <= 0) return "Budget used up";
	return m.unit === "$" ? `${dollars(left)} left` : `${left < 10 ? Math.round(left * 10) / 10 : Math.round(left)} ${m.unit} left`;
}

/** A step "spends money" when a version costs at least this through it. */
export const PAID_USD = 0.01;

/**
 * What a press will spend, said before it happens, and whether the budget
 * allows it. `estimate` is one version's usual usage (`estimateThrough`).
 * Money leads when the step spends it ("about $3 a version · $39.08 left");
 * otherwise device time does ("about 21 GPU-min · 130 GPU-min left"). A GPU
 * press also says where the day's GPU measurements stand (`gpuToday`).
 * `spends`: the press uses a GPU or real money (worth a second look).
 */
export function pressWords(input: {
	runs: number;
	estimate?: { gpu_s?: number; cpu_s?: number; cost_usd?: number; notional_usd?: number } | null;
	usage?: MeUsage | null;
	/** "GPU sandbox" — what the runs go through, in words. */
	through?: string;
	/** Says what runs instead of "Run N versions": "Run Screen once". */
	what?: string;
	/** GPU measurements in the last 24 h (`gpuMeasurementsToday`) and the daily cap, when known. */
	gpuToday?: { used: number; limit?: number } | null;
	/** The services the app's spec measures with (for the budget meter's estimates). */
	instruments?: string[];
}): { text: string; blocked: boolean; spends: boolean } {
	const n = Math.max(0, Math.floor(input.runs));
	const runs = `${n} ${n === 1 ? "version" : "versions"}`;
	const head = input.what ?? (input.through ? `Run ${runs} through ${input.through}` : `Run ${runs}`);
	const e = input.estimate;
	if (!e || !((e.gpu_s ?? 0) > 0 || (e.cpu_s ?? 0) > 0 || (e.cost_usd ?? 0) > 0)) return { text: head, blocked: false, spends: false };
	const per = { gpu_s: e.gpu_s ?? 0, cpu_s: e.cpu_s ?? 0, cost_usd: e.cost_usd ?? 0 };
	const perNotional = e.notional_usd ?? notionalPart(per);
	const total: Spend = { ...empty(), gpu_s: per.gpu_s * n, cpu_s: per.cpu_s * n, cost_usd: per.cost_usd * n, notional_usd: perNotional * n };
	const m = budgetMeter(input.usage, undefined, { instruments: input.instruments });
	const realPer = per.cost_usd - perNotional;
	const leadUsd = per.cost_usd >= PAID_USD && (m?.unit === "$" || (per.gpu_s <= 0 && realPer >= PAID_USD / 2));
	let cost: string;
	if (leadUsd) {
		const each = dollarWords(per.cost_usd, perNotional);
		cost = n > 1 ? `${each} a version, ${dollars(total.cost_usd)} in all` : each;
		if (total.gpu_s > 0) cost += ` · ${deviceWords(total)}`;
	} else {
		cost = deviceWords(total) || dollarWords(total.cost_usd, total.notional_usd);
	}
	let left = "";
	let blocked = false;
	if (m) {
		const need = m.unit === "GPU-min" ? total.gpu_s / 60 : m.unit === "CPU-min" ? total.cpu_s / 60 : total.cost_usd;
		const remaining = Math.max(0, m.limit - m.used);
		blocked = need > 0 && need > remaining;
		const fmtLeft = m.unit === "$" ? dollars(remaining) : `${remaining < 10 ? Math.round(remaining * 10) / 10 : Math.round(remaining)} ${m.unit}`;
		left = blocked ? ` — only ${fmtLeft} left in the budget` : ` · ${fmtLeft} left`;
	}
	// The day's GPU measurements: a cap per account, per rolling 24 h.
	let day = "";
	const g = input.gpuToday;
	if (total.gpu_s > 0 && g) {
		if (g.limit && g.limit > 0) {
			const free = Math.max(0, g.limit - g.used);
			if (free === 0) { blocked = true; day = ` — today's ${g.limit} GPU measurements are used; they free up over the next 24 h`; }
			else if (n > free) day = ` · only ${free} of today's ${g.limit} GPU measurements left; the rest wait`;
			else day = ` · ${free} of today's ${g.limit} GPU measurements left`;
		} else {
			day = ` · ${g.used} GPU ${g.used === 1 ? "measurement" : "measurements"} in the last 24 h (a daily cap applies)`;
		}
	}
	return { text: `${head}: about ${cost}${left}${day}`, blocked, spends: total.gpu_s > 0 || leadUsd };
}

/**
 * GPU measurements in the last 24 hours, counted from `GET /me/usage?since=<now−24h>`
 * (no app: the cap is per account): settled, metered runs of every instrument
 * that used a GPU. The FALLBACK for an identity without `limits` (see gpuToday).
 */
export function gpuMeasurementsToday(u: MeUsage | null | undefined): number | null {
	if (!u) return null;
	return Object.values(u.used.by_instrument ?? {}).reduce((a, x) => a + ((x.gpu_s ?? 0) > 0 ? x.runs ?? 0 : 0), 0);
}

/**
 * Where the day's GPU measurements stand, for `pressWords({ gpuToday })`:
 * identity's own `limits` when it sends them (the cap it enforces — per
 * account, so "N of today's 24 left" is exact and the press blocks at 0), else
 * the 24-hour count with no cap (said as a count only, never blocking).
 */
export function gpuToday(u: MeUsage | null | undefined): { used: number; limit?: number } | null {
	if (!u) return null;
	const l = u.limits;
	if (l && typeof l.gpu_measurements_per_day === "number" && l.gpu_measurements_per_day > 0 && typeof l.gpu_measurements_today === "number")
		return { used: Math.max(0, l.gpu_measurements_today), limit: l.gpu_measurements_per_day };
	const n = gpuMeasurementsToday(u);
	return n == null ? null : { used: n };
}

/**
 * What one run of a workflow usually costs: its own history on /me/usage
 * (`used.by_workflow`), else the sum of the estimates for the services its
 * feedback steps measure with (this app's history first, then the platform's).
 * null when nothing says.
 */
export function workflowRunEstimate(u: MeUsage | null | undefined, workflow: string, services: string[] = []): { gpu_s: number; cpu_s: number; cost_usd: number } | null {
	if (!u) return null;
	const own = u.used.by_workflow?.[workflow];
	if (own && (own.runs ?? 0) > 0) {
		const k = own.runs!;
		return { gpu_s: (own.gpu_s ?? 0) / k, cpu_s: (own.cpu_s ?? 0) / k, cost_usd: (own.cost_usd ?? 0) / k };
	}
	const out = { gpu_s: 0, cpu_s: 0, cost_usd: 0 };
	let any = false;
	for (const svc of new Set(services)) {
		const hist = u.used.by_instrument?.[svc];
		const e = hist && (hist.runs ?? 0) > 0
			? { gpu_s: (hist.gpu_s ?? 0) / hist.runs!, cpu_s: (hist.cpu_s ?? 0) / hist.runs!, cost_usd: (hist.cost_usd ?? 0) / hist.runs! }
			: u.estimates?.[svc];
		if (!e) continue;
		any = true;
		out.gpu_s += e.gpu_s ?? 0; out.cpu_s += e.cpu_s ?? 0; out.cost_usd += e.cost_usd ?? 0;
	}
	return any ? out : null;
}

const WEEK_S = 7 * 86400;
const rowSec = (ts?: string): number => {
	if (!ts) return NaN;
	const n = Number(ts);
	if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
	const d = Date.parse(ts);
	return Number.isFinite(d) ? d / 1000 : NaN;
};

/** What the step rows of the last 7 days used (every experiment's rows). */
export function weekSpend(rows: MeExperimentRow[], now = Date.now() / 1000): Spend {
	return sumUsage(rows.filter((r) => { const t = rowSec(r.ts); return Number.isFinite(t) && now - t < WEEK_S && t <= now + 60; })
		.map((r) => ({ usage: usageOfRow(r), duration_s: num(r.metrics?.duration_s) })));
}

/** "9 CPU-h · $0.04 notional this week" — null when nothing was metered. */
export function weekSpendWords(s: Spend): string | null {
	if (!s.metered) return null;
	const parts: string[] = [];
	const dev = deviceWords(s);
	if (dev) parts.push(dev);
	if (s.cost_usd >= 0.005) parts.push(dollarWords(s.cost_usd, s.notional_usd));
	if (!parts.length) return s.reused === s.metered ? "Free this week — every result was reused" : null;
	return `${parts.join(" · ")} this week`;
}

/** The app's spend in one line for a summary tile: the budget meter's words
 *  when the app declares a budget, else what was used ("24 GPU-min on
 *  RTX 5080 · 31 CPU-s used · $0.10 notional"), else null (nothing metered). */
export function usageLine(u: MeUsage | null | undefined, instrumentWords?: (name: string) => string, opts: { instruments?: string[] } = {}): string | null {
	if (!u) return null;
	const m = budgetMeter(u, instrumentWords, opts);
	if (m) return `Budget: ${m.words}`;
	const s: Spend = { ...empty(), gpu_s: u.used.gpu_s || 0, cpu_s: u.used.cpu_s || 0, cost_usd: u.used.cost_usd || 0, gpu_by_type: Object.fromEntries(Object.entries(u.used.by_device ?? {}).filter(([k]) => k !== "CPU")) };
	const dev = deviceWords(s);
	const usd = s.cost_usd > 0 ? dollarWords(s.cost_usd, u.used.by_instrument || u.used.llm ? usageNotionalUsd(u) : s.cost_usd) : "";
	if (!dev && !usd) return null;
	return dev ? `${dev} used${usd ? ` · ${usd}` : ""}` : `${usd} used`;
}

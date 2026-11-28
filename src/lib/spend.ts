// spend — what research cost, in words: device-minutes first, notional $ second.
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

const empty = (): Spend => ({
	runs: 0, metered: 0, reused: 0, estimated: 0, cpu_s: 0, gpu_s: 0, cost_usd: 0, duration_s: 0,
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
	if (s.cost_usd > 0) parts.push(`${dollars(s.cost_usd)} notional`);
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
export interface MeUsage {
	app?: string;
	since?: string | null;
	used: { gpu_s: number; cpu_s: number; cost_usd: number; runs: number; running?: number; unmetered_runs?: number; by_device?: Record<string, number> };
	saved?: { gpu_s: number; cpu_s: number; reused_runs: number };
	budget?: ComputeBudget;
	remaining?: { gpu_s?: number; cpu_s?: number; cost_usd?: number };
	estimates?: Record<string, { gpu_s?: number; cpu_s?: number; gpu_type?: string; cost_usd?: number; from_runs: number }>;
}

const perWords = (per?: string) => (per === "day" ? " today" : per === "week" ? " this week" : "");

/** A budget's state, as a meter: share used and the sentence beside it.
 *  null when the app declares no budget. */
export function budgetMeter(u: MeUsage | null | undefined, instrumentWords?: (name: string) => string): {
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
	const head = unit === "$" ? `${fmt(used)} of ${fmt(limit)} notional used${perWords(b.per)}` : `${fmt(used)} of ${fmt(limit)} ${unit} used${perWords(b.per)}`;
	// "about N more <instrument> runs": from the costliest estimate in that unit.
	let more = "";
	const ests = Object.entries(u.estimates ?? {});
	const per = ests
		.map(([name, e]) => ({ name, v: unit === "GPU-min" ? (e.gpu_s ?? 0) / 60 : unit === "CPU-min" ? (e.cpu_s ?? 0) / 60 : e.cost_usd ?? 0 }))
		.filter((x) => x.v > 0)
		.sort((a, b2) => b2.v - a.v)[0];
	if (per && left > 0) {
		const n = Math.floor(left / per.v);
		const what = instrumentWords ? instrumentWords(per.name) : "";
		more = ` (about ${n} more ${what ? `${what} ` : ""}${n === 1 ? "run" : "runs"})`;
	}
	const tail = left <= 0 ? " · none left" : ` · ${unit === "$" ? dollars(left) : `${fmt(left)} ${unit}`} left${more}`;
	return { used, limit, unit, share, words: head + tail, low: left > 0 && share >= 0.8, over: left <= 0 };
}

/** What a press will spend, said before it happens, and whether the budget
 *  allows it. `estimate` is one run's usual usage (per instrument). */
export function pressWords(input: {
	runs: number;
	estimate?: { gpu_s?: number; cpu_s?: number; cost_usd?: number } | null;
	usage?: MeUsage | null;
	/** "GPU sandbox" — what the runs go through, in words. */
	through?: string;
}): { text: string; blocked: boolean } {
	const n = Math.max(0, Math.floor(input.runs));
	const runs = `${n} ${n === 1 ? "version" : "versions"}`;
	const head = input.through ? `Run ${runs} through ${input.through}` : `Run ${runs}`;
	const e = input.estimate;
	if (!e || !((e.gpu_s ?? 0) > 0 || (e.cpu_s ?? 0) > 0 || (e.cost_usd ?? 0) > 0)) return { text: head, blocked: false };
	const total: Spend = { ...empty(), gpu_s: (e.gpu_s ?? 0) * n, cpu_s: (e.cpu_s ?? 0) * n, cost_usd: (e.cost_usd ?? 0) * n };
	if (total.gpu_s > 0) total.gpu_by_type = {};
	let cost = deviceWords(total);
	if (!cost && total.cost_usd > 0) cost = `${dollars(total.cost_usd)} notional`;
	const m = budgetMeter(input.usage);
	let left = "";
	let blocked = false;
	if (m) {
		const need = m.unit === "GPU-min" ? total.gpu_s / 60 : m.unit === "CPU-min" ? total.cpu_s / 60 : total.cost_usd;
		const remaining = Math.max(0, m.limit - m.used);
		blocked = need > 0 && need > remaining;
		const fmtLeft = m.unit === "$" ? dollars(remaining) : `${remaining < 10 ? Math.round(remaining * 10) / 10 : Math.round(remaining)} ${m.unit}`;
		left = blocked ? ` — only ${fmtLeft} left in the budget` : `, ${fmtLeft} left`;
	}
	return { text: `${head}: about ${cost}${left}`, blocked };
}

/** The app's spend in one line for a summary tile: the budget meter's words
 *  when the app declares a budget, else what was used ("24 GPU-min on
 *  RTX 5080 · 31 CPU-s used · $0.10 notional"), else null (nothing metered). */
export function usageLine(u: MeUsage | null | undefined, instrumentWords?: (name: string) => string): string | null {
	if (!u) return null;
	const m = budgetMeter(u, instrumentWords);
	if (m) return `Budget: ${m.words}`;
	const s: Spend = { ...empty(), gpu_s: u.used.gpu_s || 0, cpu_s: u.used.cpu_s || 0, cost_usd: u.used.cost_usd || 0, gpu_by_type: Object.fromEntries(Object.entries(u.used.by_device ?? {}).filter(([k]) => k !== "CPU")) };
	const dev = deviceWords(s);
	if (!dev) return null;
	return `${dev} used${s.cost_usd > 0 ? ` · ${dollars(s.cost_usd)} notional` : ""}`;
}

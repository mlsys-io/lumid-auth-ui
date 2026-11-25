// The app's Research map, as data: what the app is exploring (experiments),
// which versions each one tries, and what it suggests trying next.
//
// Pure functions over /me/apps/:app/experiments and the app's proposals,
// checked against lum.id on 2026-11-24. Every status is a sentence a reader
// understands without knowing the engine: "Can't compare yet — the versions
// were measured 18 different ways", not "comparable: false, instruments: 18".
// No created_at / forked_from is served yet, so the tree is app → experiments
// → versions, with suggestions as dashed branches off the app.

import type { MeExperiment } from "@/api/me";
import { humanMetric, fmtMetricValue } from "@/lib/run-answer";

export type Tone = "ok" | "running" | "failing" | "attention" | "idle";

/** "kol_alpha" → "KOL alpha", "musk_llm_scored" → "Musk LLM scored". */
export function humanId(id: string): string {
	const { label } = humanMetric(id);
	return label;
}

export interface Proposal {
	id: string;
	hypothesis?: string;
	kind?: string;
	dispatch_loop?: string;
	dispatch?: { loop?: string };
	est_runs?: number;
	success_criteria?: string;
	min_samples?: number;
	metric?: { name: string; higher_is_better?: boolean };
	metric_name?: string;
	dataset_id?: string;
	baseline?: unknown;
	arms?: Array<Record<string, unknown>>;
	compare_within?: string[];
}

// ── an experiment, in words ─────────────────────────────────────────────

const baselineArm = (e: MeExperiment): string | undefined => {
	const b = e.baseline as { arm?: string } | string | undefined;
	return typeof b === "string" ? b : b?.arm;
};

export function experimentStatus(e: MeExperiment): { tone: Tone; text: string } {
	if (e.status && /concluded|done|archived|closed/i.test(e.status)) {
		return e.best_variant && e.criteria_met
			? { tone: "ok", text: `Done — ${humanId(e.best_variant)} won` }
			: { tone: "idle", text: "Done — no clear winner" };
	}
	if (!e.n_results) {
		if (e.unfed) return { tone: "attention", text: "Can't start — no workflow feeds it" };
		if (e.starved) return { tone: "failing", text: "Stuck — the workflow that feeds it is failing" };
		// The workflow ran, but never AS one of these versions (runs started by
		// hand) — so the honest next step is to run the versions, not to debug.
		if (e.unrecorded && (e.arms?.length ?? 0) > 0 && !Object.keys(e.variants || {}).length) return { tone: "idle", text: "None of its versions has run yet" };
		if (e.unrecorded) return { tone: "attention", text: "Its workflow runs but records no results" };
		return { tone: "idle", text: "Not started yet" };
	}
	if (e.comparable === false) {
		const k = e.instruments && e.instruments > 1 ? `${e.instruments} different setups` : "different setups";
		return { tone: "attention", text: `Can't compare yet — the versions ran under ${k}` };
	}
	if (e.best_variant && e.criteria_met) return { tone: "ok", text: `Winning: ${humanId(e.best_variant)}` };
	if (e.best_variant && e.not_separable_from?.length) return { tone: "running", text: `${humanId(e.best_variant)} leads, but can't be told apart yet` };
	if (e.best_variant) return { tone: "running", text: `${humanId(e.best_variant)} leads — not confirmed yet` };
	// Every version has the results it needs, yet nothing leads: the averages
	// are too close for the rule to call. (Was "Collecting results: 209 of 24".)
	const vs = Object.values(e.variants || {});
	const declared = Math.max(1, e.arms?.length || vs.length || 1);
	const min = e.min_samples || 0;
	if (min && vs.length >= declared && vs.every((v) => v.n >= min)) return { tone: "idle", text: "Enough results — too close to call so far" };
	const need = min * declared;
	return { tone: "running", text: need ? `Collecting results: ${Math.min(e.n_results, need)} of ${need}` : `Collecting results: ${e.n_results} so far` };
}

/** The workflow an experiment's runs come from: its declared dispatch loop
 *  when that loop is attached, else the first attached loop. */
export function experimentLoop(e: MeExperiment): string {
	const hinted = e.dispatch?.loop;
	return (hinted && e.loops?.includes(hinted) ? hinted : e.loops?.[0]) || "";
}

/** The versions a "Run" button should start: the untried ones, or — when
 *  every version has run — all of them once more. */
export function versionsToRun(e: MeExperiment): { ids: string[]; untried: boolean } {
	const declared = (e.arms || []).map((a) => String(a.id));
	const ran = new Set(Object.keys(e.variants || {}).filter((k) => (e.variants?.[k]?.n ?? 0) > 0));
	const untried = declared.filter((id) => !ran.has(id));
	return untried.length ? { ids: untried, untried: true } : { ids: declared, untried: false };
}

// ── a version (arm), in words ───────────────────────────────────────────

export interface VersionInfo {
	id: string;
	label: string;
	/** "winning" | "leading" | "current" | "not run yet" | "trying" | "can't tell apart". */
	tag: string;
	tone: Tone;
	/** "357 results · avg 121,610.6 ticks" */
	line: string;
	n: number;
	/** 0..1 toward the result target, null when there is none. */
	progress: number | null;
	description?: string;
}

export function versionsOf(e: MeExperiment): VersionInfo[] {
	const declared = (e.arms || []).map((a) => a.id);
	const observed = Object.keys(e.variants || {});
	const ids = [...declared, ...observed.filter((o) => !declared.includes(o))];
	const base = baselineArm(e);
	const metric = e.metric?.name || e.metric_name || "";
	const { unit } = metric ? humanMetric(metric) : { unit: "" };
	const tied = new Set(e.not_separable_from || []);
	return ids.map((id) => {
		const v = e.variants?.[id];
		const n = v?.n ?? 0;
		let tag = "trying", tone: Tone = "running";
		if (!v || n === 0) { tag = "not run yet"; tone = "idle"; }
		else if (e.best_variant === id && e.criteria_met && e.comparable !== false) { tag = "winning"; tone = "ok"; }
		else if (e.best_variant === id && e.comparable !== false) { tag = "leading"; tone = "ok"; }
		else if (tied.has(id)) { tag = "can't tell apart"; tone = "running"; }
		else if (id === base) { tag = "current"; tone = "idle"; }
		const avg = v && n ? ` · avg ${fmtMetricValue(v.mean, unit, metric)}` : "";
		const desc = (e.arms || []).find((a) => a.id === id)?.description;
		return {
			id, label: id === base && /^(current|baseline)$/i.test(id) ? "Current version" : humanId(id),
			tag, tone, n,
			line: n ? `${n.toLocaleString()} result${n === 1 ? "" : "s"}${avg}` : "no results yet",
			progress: e.min_samples ? Math.min(1, n / e.min_samples) : null,
			description: typeof desc === "string" ? desc : undefined,
		};
	});
}

// ── "Done when", in words ────────────────────────────────────────────────

/** "best_n >= 20 and baseline_n >= 20 and delta_pp > 10" →
 *  "the best and the current version each have 20+ results, and the best is ahead by more than 10 points". */
export function criteriaInWords(expr?: string): string {
	const s = (expr || "").trim();
	if (!s) return "";
	const parts = s.split(/\s+and\s+/i).map((p) => p.trim());
	const out: string[] = [];
	const nBest = parts.map((p) => p.match(/^best_n\s*>=?\s*(\d+)$/)).find(Boolean)?.[1];
	const nBase = parts.map((p) => p.match(/^baseline_n\s*>=?\s*(\d+)$/)).find(Boolean)?.[1];
	const nAny = parts.map((p) => p.match(/^n\s*>=?\s*(\d+)$/)).find(Boolean)?.[1];
	if (nBest && nBase && nBest === nBase) out.push(`the best and the current version each have ${nBest}+ results`);
	else {
		if (nBest) out.push(`the best version has ${nBest}+ results`);
		if (nBase) out.push(`the current version has ${nBase}+ results`);
	}
	if (nAny) out.push(`there are ${nAny}+ results`);
	for (const p of parts) {
		const d = p.match(/^delta(_pp)?\s*(>=?|<=?)\s*(-?[\d.]+)$/);
		if (!d) continue;
		// delta_pp is in PERCENTAGE points — "10 points" left a reader asking "of what?".
		const pts = d[1] ? " percentage points" : "";
		const v = Number(d[3]);
		if (d[2].startsWith(">")) out.push(v === 0 ? (d[2] === ">=" ? "the best is at least as good as the current one" : "the best beats the current one") : `the best is ahead by more than ${v}${pts}`);
		else out.push(`the gap is under ${v}${pts}`);
	}
	const known = parts.every((p) => /^(best_n|baseline_n|n|delta(_pp)?)\s*[<>]=?\s*-?[\d.]+$/.test(p));
	if (!known || !out.length) return s; // say the rule as written rather than guess
	const txt = out.length > 1 ? `${out.slice(0, -1).join(", ")}, and ${out[out.length - 1]}` : out[0];
	return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// ── the tree ─────────────────────────────────────────────────────────────

export type MapNodeKind = "app" | "experiment" | "version" | "suggested";
export interface MapNode { id: string; kind: MapNodeKind; depth: number; ref: string; parent?: string }
export interface MapEdge { id: string; source: string; target: string; dashed?: boolean; label?: string }

/** The experiment a suggestion extends: the one that runs through the same
 *  workflow and dataset (and metric). Two of the three must match, or it
 *  hangs off the app — a guessed parent would draw a false derivation. */
export function suggestionParent(p: Proposal, exps: MeExperiment[]): string | null {
	const loop = p.dispatch_loop || p.dispatch?.loop;
	const metric = p.metric?.name || p.metric_name;
	let best: string | null = null, bestScore = 1;
	for (const e of exps) {
		const eLoops = [e.dispatch?.loop, ...(e.loops || [])].filter(Boolean);
		const score = (loop && eLoops.includes(loop) ? 1 : 0)
			+ (p.dataset_id && p.dataset_id === e.dataset_id ? 1 : 0)
			+ (metric && metric === (e.metric?.name || e.metric_name) ? 1 : 0);
		if (score > bestScore) { best = e.id; bestScore = score; }
	}
	return best;
}

export function buildResearchTree(app: string, exps: MeExperiment[], proposals: Proposal[]): { nodes: MapNode[]; edges: MapEdge[] } {
	const root = `app:${app}`;
	const nodes: MapNode[] = [{ id: root, kind: "app", depth: 0, ref: app }];
	const edges: MapEdge[] = [];
	const byId = new Map(exps.map((e) => [e.id, e]));
	// Experiments derive from experiments when the app declares it
	// (forked_from); a cycle or an unknown parent falls back to the app.
	const parentOf = (e: MeExperiment): string | null => {
		const f = (e as { forked_from?: string }).forked_from;
		return f && f !== e.id && byId.has(f) ? f : null;
	};
	const depthCache = new Map<string, number>();
	const depthOf = (id: string, seen = new Set<string>()): number => {
		if (depthCache.has(id)) return depthCache.get(id)!;
		if (seen.has(id)) return 1;
		seen.add(id);
		const par = parentOf(byId.get(id)!);
		const d = par ? depthOf(par, seen) + 1 : 1;
		depthCache.set(id, d);
		return d;
	};
	const ordered = [...exps].sort((a, b) => depthOf(a.id) - depthOf(b.id));
	for (const e of ordered) {
		const eid = `exp:${e.id}`;
		const par = parentOf(e);
		const pid = par ? `exp:${par}` : root;
		const depth = depthOf(e.id);
		nodes.push({ id: eid, kind: "experiment", depth, ref: e.id, parent: pid });
		edges.push({ id: `${pid}->${eid}`, source: pid, target: eid, label: par ? "forked from" : undefined });
		for (const v of versionsOf(e)) {
			const vid = `ver:${e.id}:${v.id}`;
			nodes.push({ id: vid, kind: "version", depth: depth + 1, ref: v.id, parent: eid });
			edges.push({ id: `${eid}->${vid}`, source: eid, target: vid });
		}
	}
	// A proposal whose experiment now exists has been accepted — it is on the
	// map as an experiment, not as a suggestion. The rest hang off the
	// experiment they extend ("suggested next"), else off the app.
	for (const p of proposals.filter((p) => !byId.has(p.id))) {
		const sid = `sug:${p.id}`;
		const par = suggestionParent(p, exps);
		const pid = par ? `exp:${par}` : root;
		nodes.push({ id: sid, kind: "suggested", depth: par ? depthOf(par) + 1 : 1, ref: p.id, parent: pid });
		edges.push({ id: `${pid}->${sid}`, source: pid, target: sid, dashed: true, label: par ? "suggested next" : "suggested" });
	}
	return { nodes, edges };
}

/** Ids on the path from the root to `id` (inclusive), for the highlight. */
export function pathTo(nodes: MapNode[], id: string): Set<string> {
	const by = new Map(nodes.map((n) => [n.id, n]));
	const out = new Set<string>();
	let cur = by.get(id);
	while (cur) { out.add(cur.id); cur = cur.parent ? by.get(cur.parent) : undefined; }
	// Selecting an experiment also lights its versions — they ARE its answer.
	for (const n of nodes) if (n.parent === id) out.add(n.id);
	return out;
}

/** The map's status line, in words. */
export function mapSummary(exps: MeExperiment[], proposals: Proposal[]): string {
	const all = exps.flatMap((e) => versionsOf(e));
	const versions = all.length;
	const tried = all.filter((v) => v.tag !== "not run yet").length;
	const sug = proposals.filter((p) => !exps.some((e) => e.id === p.id)).length;
	const triedWords = tried === versions ? `${versions} version${versions === 1 ? "" : "s"} tried` : tried === 0 ? `${versions} version${versions === 1 ? "" : "s"}, none tried yet` : `${tried} of ${versions} versions tried`;
	const parts = [`${exps.length} experiment${exps.length === 1 ? "" : "s"}`, triedWords];
	if (sug) parts.push(`${sug} suggested`);
	return parts.join(" · ");
}

/** When versions can't be compared: what differed between them and what to
 *  do about it, in words — "measured 18 different ways" alone told a reader
 *  nothing they could act on (first-glance test, 2026-11-25). */
export function comparabilityNote(e: MeExperiment): string | null {
	if (e.comparable !== false) return null;
	const dims = (e.compare_within || []).map((d) => humanId(d).toLowerCase());
	const what = dims.length ? `They differ in ${dims.join(" and ")}` : "They ran under different setups";
	return `${what}, so a gap between them may come from the setup rather than the version. To compare them, run every version under the same setup.`;
}

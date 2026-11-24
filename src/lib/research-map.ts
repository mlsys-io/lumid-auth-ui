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
	const need = (e.min_samples || 0) * Math.max(1, (e.arms?.length || Object.keys(e.variants || {}).length || 1));
	return { tone: "running", text: need ? `Collecting results: ${e.n_results} of ${need}` : `Collecting results: ${e.n_results} so far` };
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

export function buildResearchTree(app: string, exps: MeExperiment[], proposals: Proposal[]): { nodes: MapNode[]; edges: MapEdge[] } {
	const root = `app:${app}`;
	const nodes: MapNode[] = [{ id: root, kind: "app", depth: 0, ref: app }];
	const edges: MapEdge[] = [];
	const known = new Set(exps.map((e) => e.id));
	for (const e of exps) {
		const eid = `exp:${e.id}`;
		nodes.push({ id: eid, kind: "experiment", depth: 1, ref: e.id, parent: root });
		edges.push({ id: `${root}->${eid}`, source: root, target: eid });
		for (const v of versionsOf(e)) {
			const vid = `ver:${e.id}:${v.id}`;
			nodes.push({ id: vid, kind: "version", depth: 2, ref: v.id, parent: eid });
			edges.push({ id: `${eid}->${vid}`, source: eid, target: vid });
		}
	}
	// A proposal whose experiment now exists has been accepted — it is on the
	// map as an experiment, not as a suggestion.
	for (const p of proposals.filter((p) => !known.has(p.id))) {
		const pid = `sug:${p.id}`;
		nodes.push({ id: pid, kind: "suggested", depth: 1, ref: p.id, parent: root });
		edges.push({ id: `${root}->${pid}`, source: root, target: pid, dashed: true, label: "suggested" });
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
	const versions = exps.reduce((a, e) => a + versionsOf(e).length, 0);
	const sug = proposals.filter((p) => !exps.some((e) => e.id === p.id)).length;
	const parts = [`${exps.length} experiment${exps.length === 1 ? "" : "s"}`, `${versions} version${versions === 1 ? "" : "s"} tried`];
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

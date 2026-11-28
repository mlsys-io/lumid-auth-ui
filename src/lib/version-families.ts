// Version families: the versions of one experiment that differ in ONE setting
// read as one thing (2026-11-28, operator: "same model, different parameters
// can combine"). MLSys "Serve 9.2" drew 14 dots — "0.6B · concurrency 4", "…
// 8", "… 12" … — where a reader sees three: 0.6B, 1.7B and 4B, each tried at
// concurrency 4 · 8 · 12 · 16 · 32.
//
// Pure, generic over every research app:
//   - a version's settings are its `overrides` (MLSys: dotted paths such as
//     serving.max_concurrency) when the experiment's versions use them, else
//     its own non-metadata fields flattened to dotted keys (Quant Research:
//     spec.signal, costs.bps; Try setups: seed);
//   - with overrides, a key a version doesn't set is the template's default —
//     the baseline's value — so the baseline (no overrides) joins the family
//     that varies what it leaves at the default;
//   - a family = 2+ versions agreeing on every setting but one; greedy by the
//     key that groups the most versions; a version joins at most one;
//   - an experiment of under 3 versions, or one family covering every version,
//     isn't grouped — that family would only restate the experiment.

import type { MeExperiment } from "@/api/me";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";
import { settingName, versionsOf, type MapEdge, type MapNode, type Tone } from "@/lib/research-map";

/** Fields a version carries ABOUT itself, not settings it changes. */
export const VERSION_META_KEYS = new Set([
	"id", "title", "description", "about", "label", "name", "base", "study", "task", "status", "baseline", "branch_label", "inputs", "arm",
]);

export interface VersionFamily {
	/** `fam:<experiment>:<varied key>~<hash of what the members share>` — no colon after the second. */
	id: string;
	experiment: string;
	/** The one setting its members vary (dotted). */
	key: string;
	/** Version ids, in the order of the varied value (numbers ascending). */
	members: string[];
	/** Each member's value of the varied setting, in words: "4", "32 (baseline)". */
	values: Record<string, string>;
	/** What the members share: "0.6B" (from their titles), else "Model llm-0.6b". */
	name: string;
	/** The varied setting in words: "concurrency". */
	keyWords: string;
	/** "concurrency 4 · 8 · 12 · 16 · 32" */
	sub: string;
	/** The best member's state (versionsOf's tag); "current" reads "trying" for a family. */
	tag: string;
	tone: Tone;
	/** The member holding that state. */
	lead: string;
	/** Results across its members. */
	n: number;
	/** The member with the best average of the experiment's metric. */
	best: { id: string; label: string; value: string; mean: number; text: string } | null;
}

const MISSING = "\u0000";

type Setting = { text: string; raw: unknown };
type Settings = Map<string, Setting>;

function flatten(v: unknown, prefix: string, out: Settings) {
	if (v && typeof v === "object" && !Array.isArray(v)) {
		const entries = Object.entries(v as Record<string, unknown>);
		if (!entries.length) { if (prefix) out.set(prefix, { text: "{}", raw: v }); return; }
		for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
		return;
	}
	if (prefix && v !== undefined) out.set(prefix, { text: typeof v === "string" ? v : JSON.stringify(v), raw: v });
}

/** Each version's settings as dotted keys, and which style the experiment uses. */
export function versionSettings(arms: Array<Record<string, unknown>>): { style: "overrides" | "fields"; byId: Map<string, Settings> } {
	const style = arms.some((a) => a.overrides && typeof a.overrides === "object") ? "overrides" : "fields";
	const byId = new Map<string, Settings>();
	for (const a of arms) {
		const s: Settings = new Map();
		if (style === "overrides") flatten(a.overrides ?? {}, "", s);
		else for (const [k, v] of Object.entries(a)) if (!VERSION_META_KEYS.has(k)) flatten(v, k, s);
		byId.set(String(a.id), s);
	}
	return { style, byId };
}

/** A dotted key in words, by its last part: "serving.max_concurrency" → "max concurrency". */
export function settingWords(key: string): string {
	const last = key.split(".").filter(Boolean).pop() || key;
	return settingName(last);
}

const hash = (s: string): string => {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
	return h.toString(36);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const numberIn = (raw: unknown, text: string): number | null => {
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	const m = /\d+(?:\.\d+)?/.exec(text);
	return m ? Number(m[0]) : null;
};
/** Leading parts every list shares, keeping at least one part in each. */
const commonHead = (lists: string[][], ok: (w: string) => boolean = () => true): number => {
	let c = 0;
	while (lists.every((l) => c < l.length - 1 && l[c] === lists[0][c] && ok(l[c]))) c++;
	return c;
};
const commonTail = (lists: string[][]): number => {
	let c = 0;
	const at = (l: string[], i: number) => l[l.length - 1 - i];
	while (lists.every((l) => c < l.length - 1 && at(l, c) === at(lists[0], c))) c++;
	return c;
};

/** What titled versions share, and what's left of each title: "0.6B · concurrency 4"
 *  and "0.6B · concurrency 8" share "0.6B", leaving "concurrency 4" / "concurrency 8". */
function splitTitles(titles: string[]): { name: string; rest: string[] } | null {
	const segs = titles.map((t) => t.split(" · ").map((x) => x.trim()));
	const head = commonHead(segs);
	if (head) return { name: segs[0].slice(0, head).join(" · "), rest: segs.map((s) => s.slice(head).join(" · ")) };
	const tail = commonTail(segs);
	if (tail) return { name: segs[0].slice(-tail).join(" · "), rest: segs.map((s) => s.slice(0, s.length - tail).join(" · ")) };
	const words = titles.map((t) => t.split(/\s+/).filter(Boolean));
	const w = commonHead(words);
	if (w) {
		const name = words[0].slice(0, w).join(" ").replace(/[\s·:,–—-]+$/, "");
		if (name) return { name, rest: words.map((x) => x.slice(w).join(" ")) };
	}
	return null;
}

const TAG_RANK = ["winning", "leading", "tied", "can't tell apart", "trying", "current"];
function tagRank(tag: string): number {
	const i = TAG_RANK.indexOf(tag);
	if (i >= 0) return i;
	if (tag.startsWith("passed ")) return 6;
	if (tag === "ran, no score") return 7;
	if (tag.startsWith("stopped at")) return 8;
	if (tag === "not run yet") return 9;
	return 10;
}

/** The families of an experiment's versions; [] when grouping would add nothing. */
export function versionFamilies(e: MeExperiment, tried: string[] = []): VersionFamily[] {
	const arms = (e.arms || []).filter((a) => a && a.id != null) as Array<Record<string, unknown>>;
	const all = versionsOf(e, tried);
	if (arms.length < 3) return [];
	const { style, byId } = versionSettings(arms);
	const ids = arms.map((a) => String(a.id));
	const keys: string[] = [];
	for (const id of ids) for (const k of byId.get(id)!.keys()) if (!keys.includes(k)) keys.push(k);
	if (!keys.length) return [];
	const val = (id: string, k: string) => byId.get(id)!.get(k)?.text ?? MISSING;

	// Greedy: the key whose families hold the most versions, then again over the rest.
	const left = new Set(ids);
	const picked: Array<{ key: string; members: string[] }> = [];
	for (;;) {
		let best: { key: string; groups: string[][]; covered: number } | null = null;
		for (const k of keys) {
			const groups = new Map<string, string[]>();
			for (const id of ids) {
				if (!left.has(id)) continue;
				const sig = keys.filter((x) => x !== k).map((x) => val(id, x)).join("\u0001");
				groups.set(sig, [...(groups.get(sig) ?? []), id]);
			}
			const ok = [...groups.values()].filter((g) => g.length >= 2 && new Set(g.map((id) => val(id, k))).size >= 2);
			const covered = ok.reduce((a, g) => a + g.length, 0);
			if (covered && (!best || covered > best.covered)) best = { key: k, groups: ok, covered };
		}
		if (!best) break;
		for (const g of best.groups) { picked.push({ key: best.key, members: g }); for (const id of g) left.delete(id); }
	}
	if (!picked.length || (picked.length === 1 && picked[0].members.length >= Math.max(ids.length, all.length))) return [];

	const info = new Map(all.map((v) => [v.id, v]));
	const armOf = new Map(arms.map((a) => [String(a.id), a]));
	const titleOf = (id: string) => { const t = armOf.get(id)?.title; return typeof t === "string" ? t.trim() : ""; };
	const metric = e.metric?.name || e.metric_name || "";
	const unit = metric ? humanMetric(metric).unit : "";
	const hib = !(e.higher_is_better === false || e.metric?.higher_is_better === false);

	return picked.map(({ key, members: given }) => {
		const titles = given.map(titleOf);
		const split = titles.every(Boolean) ? splitTitles(titles) : null;
		const humanKey = settingWords(key);
		// The varied setting's name: the words its titles' leftovers share
		// ("concurrency 4" / "concurrency 8" → "concurrency"), else the key's.
		const rest = split ? split.rest.map((r) => r.split(/\s+/).filter(Boolean)) : null;
		const kw = rest ? commonHead(rest, (w) => /^[^\d(]+$/.test(w)) : 0;
		const keyWords = rest && kw ? rest[0].slice(0, kw).join(" ") : humanKey;
		const valueOf = (id: string, i: number): { words: string; num: number | null } => {
			const s = byId.get(id)!.get(key);
			const fromTitle = rest ? rest[i].slice(kw).join(" ") : "";
			if (!s) {
				if (style !== "overrides") return { words: "not set", num: null };
				// The baseline: its title may say the default ("32 (baseline)").
				const words = fromTitle ? (/baseline/i.test(fromTitle) ? fromTitle : `${fromTitle} (baseline)`) : "baseline";
				return { words, num: fromTitle ? numberIn(undefined, fromTitle) : null };
			}
			const words = fromTitle || s.text;
			return { words, num: numberIn(s.raw, words) };
		};
		const vals = given.map((id, i) => ({ id, i, ...valueOf(id, i) }));
		// Numbers ascending; a value with no number keeps its place, ahead of them.
		vals.sort((a, b) => (a.num == null ? (b.num == null ? a.i - b.i : -1) : b.num == null ? 1 : a.num - b.num || a.i - b.i));
		const members = vals.map((v) => v.id);
		const values: Record<string, string> = {};
		for (const v of vals) values[v.id] = v.words;

		// What the members share: their titles' common part, else the settings
		// they hold in common in words ("Model llm-0.6b").
		// Only the settings that set them apart: one every version shares says nothing.
		const shared = keys.filter((k) => k !== key).map((k) => [k, val(given[0], k)] as const);
		const telling = shared.filter(([k, v]) => (v !== MISSING || style !== "overrides") && ids.some((id) => val(id, k) !== v));
		const fromSettings = telling.map(([k, v]) => `${settingWords(k)} ${v === MISSING ? "not set" : v}`).join(" · ");
		const titled = split && split.name.toLowerCase() !== keyWords.toLowerCase() ? split.name : "";
		const name = titled || (fromSettings ? cap(fromSettings) : style === "overrides" ? "Baseline settings" : "Same settings");

		// Its state is its best member's; ties in state go to the better average.
		const score = (id: string) => { const v = e.variants?.[id]; return v && v.n > 0 && Number.isFinite(v.mean) ? v.mean : null; };
		const better = (a: number | null, b: number | null) => (a == null ? false : b == null ? true : hib ? a > b : a < b);
		let lead = members[0];
		for (const id of members) {
			const r = tagRank(info.get(id)?.tag ?? ""), lr = tagRank(info.get(lead)?.tag ?? "");
			if (r < lr || (r === lr && better(score(id), score(lead)))) lead = id;
		}
		const leadTag = info.get(lead)?.tag ?? "not run yet";
		const tag = leadTag === "current" ? "trying" : leadTag;
		const tone: Tone = leadTag === "current" ? "running" : info.get(lead)?.tone ?? "idle";
		let bestId: string | null = null;
		for (const id of members) if (score(id) != null && (bestId == null || better(score(id), score(bestId)))) bestId = id;
		const best = bestId ? {
			id: bestId, label: info.get(bestId)?.label ?? bestId, value: values[bestId], mean: score(bestId)!,
			text: fmtMetricValue(score(bestId)!, unit, metric),
		} : null;
		const sig = shared.filter(([, v]) => v !== MISSING).map(([k, v]) => `${k}=${v}`).join("&");
		return {
			id: `fam:${e.id}:${key.replace(/:/g, "_")}~${hash(sig)}`,
			experiment: e.id, key, members, values, name, keyWords,
			sub: `${keyWords} ${members.map((id) => values[id]).join(" · ")}`,
			tag, tone, lead,
			n: members.reduce((a, id) => a + (info.get(id)?.n ?? 0), 0),
			best,
		};
	});
}

/** A family's state in words, for its panel and its row in the list. */
export function familyStatus(f: VersionFamily): { tone: Tone; text: string } {
	const lead = `${cap(f.keyWords)} ${f.values[f.lead]}`;
	const withResults = f.n > 0;
	if (f.tag === "winning") return { tone: "ok", text: `Winning: ${f.keyWords} ${f.values[f.lead]}` };
	if (f.tag === "leading") return { tone: "ok", text: `${lead} leads the experiment` };
	if (f.tag === "tied") return { tone: "running", text: "Tied with other versions so far" };
	if (f.tag === "can't tell apart") return { tone: "running", text: `${lead} is its best, but can't tell apart yet` };
	if (f.tag.startsWith("passed ")) return { tone: "running", text: `${lead} ${f.tag}` };
	if (f.tag.startsWith("stopped at")) return { tone: "idle", text: `All ${f.members.length} stopped — the furthest at ${f.tag.slice("stopped at ".length)}` };
	if (f.tag === "ran, no score") return { tone: "attention", text: "Ran, but recorded no score yet" };
	if (f.tag === "not run yet" || !withResults) return { tone: "idle", text: `None of its ${f.members.length} versions has run yet` };
	return { tone: "running", text: `Trying ${f.members.length} versions — none leads the experiment` };
}

/** "Best: concurrency 12 — 75.3 J per request" — from the grid's best (the
 *  furthest step's number) when it is a member, else the members' averages. */
export function familyBestWords(f: VersionFamily, at?: { version: string; value: number; unit: string; metric: string; step?: string } | null): string {
	if (at && f.members.includes(at.version)) {
		return `Best: ${f.keyWords} ${f.values[at.version]} — ${fmtMetricValue(at.value, at.unit, at.metric)}${at.step ? ` at ${at.step}` : ""}`;
	}
	return f.best ? `Best: ${f.keyWords} ${f.best.value} — ${f.best.text}` : "";
}

/** "4 versions that differ only in concurrency" */
export function familyLine(f: VersionFamily): string {
	return `${f.members.length} versions that differ only in ${f.keyWords}`;
}

/**
 * The research tree with families (`buildResearchTree`'s output in): each
 * family becomes ONE node under its experiment, where its version nodes were.
 * `members: true` keeps the versions, hung under the family (the List view's
 * expander); otherwise they aren't drawn and `drawnAs` maps a hidden version's
 * node id to its family's, so selecting a version lights its family.
 */
export function withFamilies(tree: { nodes: MapNode[]; edges: MapEdge[] }, exps: MeExperiment[], opts: { members?: boolean } = {}): {
	nodes: MapNode[]; edges: MapEdge[]; families: Map<string, VersionFamily>; drawnAs: Map<string, string>;
} {
	const byExp = new Map(exps.map((e) => [e.id, e]));
	const families = new Map<string, VersionFamily>();
	const famOf = new Map<string, VersionFamily>();
	for (const n of tree.nodes) {
		if (n.kind !== "experiment") continue;
		const e = byExp.get(n.ref);
		if (!e) continue;
		for (const f of versionFamilies(e)) {
			families.set(f.id, f);
			for (const m of f.members) famOf.set(`ver:${e.id}:${m}`, f);
		}
	}
	const drawnAs = new Map<string, string>();
	if (!families.size) return { nodes: tree.nodes, edges: tree.edges, families, drawnAs };
	const byId = new Map(tree.nodes.map((n) => [n.id, n]));
	const nodes: MapNode[] = [];
	const placed = new Set<string>();
	for (const n of tree.nodes) {
		const f = famOf.get(n.id);
		if (!f) { nodes.push(n); continue; }
		if (placed.has(f.id)) continue;
		placed.add(f.id);
		nodes.push({ id: f.id, kind: "family", depth: n.depth, ref: f.id, parent: n.parent });
		for (const m of f.members) {
			const vid = `ver:${f.experiment}:${m}`;
			const v = byId.get(vid);
			if (opts.members && v) nodes.push({ ...v, depth: v.depth + 1, parent: f.id });
			else drawnAs.set(vid, f.id);
		}
	}
	const edges: MapEdge[] = [];
	const linked = new Set<string>();
	for (const ed of tree.edges) {
		const f = famOf.get(ed.target);
		if (!f) { edges.push(ed); continue; }
		if (!linked.has(f.id)) { linked.add(f.id); edges.push({ id: `${ed.source}->${f.id}`, source: ed.source, target: f.id }); }
		if (opts.members) edges.push({ ...ed, id: `${f.id}->${ed.target}`, source: f.id });
	}
	return { nodes, edges, families, drawnAs };
}

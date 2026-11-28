// ResearchTable — the research space as a table (round 9, 2026-11-27: "besides
// research graph, need list view"). Built from the same tree as the graph
// (buildResearchTree), so it holds exactly what the graph draws: workflows
// (variants under their workflow, grouped in nodes) → experiments → versions,
// then "Ideas to try". Five columns, all in words:
//
//   Name · Status · Last runs (a dot is a run) · Best result · Last run
//
// A row click selects it — the same selection, and the same side panel, as a
// click on the graph. Versions carry a checkbox; two or more give "Compare N".
//
// Phone (below 640 px, 2026-11-28): one column. The name wraps instead of
// being cut to "C…", and the status and best result sit under it.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Lightbulb, Search, Scale } from "lucide-react";
import type { MeExperiment, MeWorkflowRow } from "@/api/me";
import type { SpecNode, SpecWorkflow } from "@/lib/app-spec";
import {
	buildResearchTree, DOT_SIZE, experimentStatus, humanId, rowStatus, versionLabel, versionsOf, OTHER_NODE,
	type MapNode, type Proposal, type Tone, experimentLabel} from "@/lib/research-map";
import { bestResult } from "@/lib/research-dashboard";
import { useRunsFeed } from "@/components/activity/hooks";
import { fmtAgo } from "@/lib/activity";
import { cn } from "@/lib/utils";

type Filter = "all" | "running" | "failing" | "winning" | "idle";
const FILTERS: Array<{ id: Filter; label: string }> = [
	{ id: "all", label: "All" }, { id: "running", label: "Running" }, { id: "failing", label: "Failing" },
	{ id: "winning", label: "Winning" }, { id: "idle", label: "Not run yet" },
];

interface Row {
	node: MapNode;
	depth: number;
	name: string;
	sub?: string;
	status: { text: string; tone: Tone | "ok" };
	/** Oldest → newest; "o" done, "x" failed, "." running, "_" skipped. */
	spark?: string;
	best?: string;
	when?: string;
	/** Compare key for a version ("<exp>:<version>"). */
	pick?: string;
	match: Filter[];
	kids: string[];
}

const TONE_TEXT: Record<string, string> = { ok: "text-gold-700", failing: "text-brick-700", running: "text-lagoon-700", attention: "text-ember-700", idle: "text-ink-600" };

export default function ResearchTable({ app, exps, pending, workflows, groups, rows, wfLabel, selected, onSelect, compareHref }: {
	app: string;
	exps: MeExperiment[];
	pending: Proposal[];
	workflows: SpecWorkflow[];
	groups: SpecNode[];
	rows: Map<string, MeWorkflowRow>;
	wfLabel: (w: SpecWorkflow) => string;
	selected: string | null;
	onSelect: (id: string) => void;
	/** Where "Compare N" goes for these versions ("<exp>:<version>"). */
	compareHref: (versions: string[]) => string;
}) {
	const [q, setQ] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [closed, setClosed] = useState<Set<string>>(() => new Set());
	const [picked, setPicked] = useState<string[]>([]);
	// A workflow's last runs (oldest → newest) from the 7-day feed, for rows
	// whose summary carries no run_spark. One read, shared with the tiles.
	const { runs } = useRunsFeed(7);
	const sparkOf = useMemo(() => {
		const m = new Map<string, string>();
		for (const r of [...(runs || [])].sort((a, b) => a.started_at - b.started_at)) {
			if (!(r.app === app || r.workflow_slug.startsWith(`${app}:`))) continue;
			const id = r.workflow_slug.includes(":") ? r.workflow_slug.slice(r.workflow_slug.indexOf(":") + 1) : r.workflow_slug;
			const c = r.state === "succeeded" ? "o" : r.state === "failed" ? "x" : r.state === "running" || r.state === "queued" ? "." : "_";
			m.set(id, ((m.get(id) ?? "") + c).slice(-14));
		}
		return m;
	}, [runs, app]);

	const table = useMemo(() => {
		const tree = buildResearchTree(app, exps, pending, workflows, groups);
		const expById = new Map(exps.map((e) => [e.id, e]));
		const wfById = new Map(workflows.map((w) => [w.id, w]));
		const groupById = new Map(groups.map((g) => [g.id, g]));
		const kids = new Map<string, string[]>();
		for (const n of tree.nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
		const byId = new Map(tree.nodes.map((n) => [n.id, n]));
		const out: Row[] = [];
		const ideas: Row[] = [];
		const visit = (id: string, depth: number) => {
			const n = byId.get(id);
			if (!n) return;
			const children = kids.get(id) ?? [];
			let row: Row | null = null;
			if (n.kind === "workflow") {
				const w = wfById.get(n.ref);
				const r = rows.get(n.ref);
				const st = rowStatus(r);
				const match: Filter[] = [st.tone === "running" ? "running" : st.tone === "failing" ? "failing" : st.tone === "idle" ? "idle" : "all"];
				row = { node: n, depth, name: w ? wfLabel(w) : humanId(n.ref), sub: w?.parent ? "variant" : undefined, status: st, spark: r?.run_spark || sparkOf.get(n.ref), when: r?.last_run_ts ? fmtAgo(r.last_run_ts) : undefined, match, kids: children };
			} else if (n.kind === "node") {
				const g = groupById.get(n.ref);
				// "Other workflows" holds the housekeeping ones, which the tree doesn't draw.
				const held = n.ref === OTHER_NODE ? workflows.filter((w) => w.helper && !(w.parent && wfById.has(w.parent))).length : children.length;
				row = { node: n, depth, name: n.ref === OTHER_NODE ? "Other workflows" : g?.title || humanId(n.ref), sub: n.ref === OTHER_NODE ? "housekeeping" : "node", status: { text: n.ref === OTHER_NODE ? `${held} helper workflow${held === 1 ? "" : "s"}` : `${held} workflow${held === 1 ? "" : "s"}`, tone: "idle" }, match: [], kids: children };
			} else if (n.kind === "experiment") {
				const e = expById.get(n.ref);
				const st = e ? experimentStatus(e) : { text: "", tone: "idle" as Tone };
				const b = e ? bestResult(e) : null;
				const match: Filter[] = [st.tone === "ok" ? "winning" : st.tone === "failing" ? "failing" : st.tone === "running" ? "running" : !e?.n_results ? "idle" : "all"];
				row = { node: n, depth, name: e ? experimentLabel(e) : n.ref, sub: "experiment", status: st, best: b ? `${b.leader}: ${b.metric} ${b.valueText}` : undefined, when: e?.updated_at ? fmtAgo(Date.parse(e.updated_at) / 1000) : undefined, match, kids: children };
			} else if (n.kind === "version") {
				const [, expId, vid] = n.id.split(":");
				const e = expById.get(expId);
				const v = e ? versionsOf(e).find((x) => x.id === vid) : undefined;
				const match: Filter[] = [v?.tag === "winning" ? "winning" : v?.tag === "not run yet" ? "idle" : "all"];
				row = { node: n, depth, name: e && vid ? versionLabel(e, vid) : humanId(vid ?? n.ref), status: { text: v?.tag ?? "", tone: v?.tone ?? "idle" }, best: v && v.n ? v.line : undefined, pick: `${expId}:${vid}`, match, kids: children };
			} else if (n.kind === "suggested") {
				const p = pending.find((x) => x.id === n.ref);
				ideas.push({ node: n, depth: 1, name: humanId(n.ref), status: { text: "Waiting for you", tone: "attention" }, best: p?.est_runs ? `about ${p.est_runs} runs` : undefined, match: ["all"], kids: [] });
				return;
			}
			if (row) out.push(row);
			for (const c of children) visit(c, row ? depth + 1 : depth);
		};
		for (const c of kids.get(`app:${app}`) ?? []) visit(c, 0);
		return { rows: out, ideas };
	}, [app, exps, pending, workflows, groups, rows, wfLabel, sparkOf]);

	// A row shows when it (or something under it) matches the search and the
	// filter, and no ancestor is folded.
	const visible = useMemo(() => {
		const needle = q.trim().toLowerCase();
		const hit = (r: Row) => (!needle || r.name.toLowerCase().includes(needle)) && (filter === "all" || r.match.includes(filter));
		const keep = new Set<string>();
		const byId = new Map(table.rows.map((r) => [r.node.id, r]));
		for (const r of table.rows) {
			if (!hit(r)) continue;
			let cur: Row | undefined = r;
			while (cur) { keep.add(cur.node.id); cur = cur.node.parent ? byId.get(cur.node.parent) : undefined; }
		}
		const hiddenBy = (r: Row): boolean => { let p = r.node.parent ? byId.get(r.node.parent) : undefined; while (p) { if (closed.has(p.node.id)) return true; p = p.node.parent ? byId.get(p.node.parent) : undefined; } return false; };
		return table.rows.filter((r) => keep.has(r.node.id) && (needle || filter !== "all" || !hiddenBy(r)));
	}, [table, q, filter, closed]);

	const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
	const pick = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= 5 ? p : [...p, k]));

	const cell = "px-2 py-1.5 align-middle";
	return (
		<div className="flex h-full min-h-0 flex-col" data-research-table>
			<div className="flex flex-wrap items-center gap-2 pb-2">
				<label className="relative flex min-w-[10rem] flex-1 items-center">
					<Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-500" aria-hidden />
					<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a workflow, experiment or version"
						className="h-8 w-full rounded-lg border border-ink-200 bg-card pl-7 pr-2 text-caption text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-ring/40" />
				</label>
				<div role="group" aria-label="Show" className="flex flex-wrap gap-1">
					{FILTERS.map((f) => (
						<button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
							className={cn("rounded-lg px-2 py-1 text-micro", filter === f.id ? "bg-ink-800 text-white" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900")}>{f.label}</button>
					))}
				</div>
			</div>
			<div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto rounded-xl border border-ink-200 bg-card">
				<table className="w-full table-fixed text-caption">
					<thead className="sticky top-0 z-[1] bg-card">
						<tr className="border-b border-ink-100 text-left text-micro text-ink-600">
							<th className={cn(cell, "w-full font-medium sm:w-[30%]")}>Name</th>
							<th className={cn(cell, "hidden w-[22%] font-medium sm:table-cell")}>Status</th>
							<th className={cn(cell, "hidden w-[15%] font-medium md:table-cell")}>Last runs</th>
							<th className={cn(cell, "hidden w-[25%] font-medium sm:table-cell")}>Best result</th>
							<th className={cn(cell, "hidden w-[8%] font-medium lg:table-cell")}>Last run</th>
						</tr>
					</thead>
					<tbody>
						{visible.map((r) => <TableRow key={r.node.id} r={r} selected={selected === r.node.id} open={!closed.has(r.node.id)} onToggle={() => toggle(r.node.id)}
							onSelect={() => onSelect(r.node.id)} picked={!!r.pick && picked.includes(r.pick)} onPick={r.pick ? () => pick(r.pick!) : undefined} cell={cell} />)}
						{visible.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-caption text-ink-600">Nothing matches{q ? ` "${q}"` : ""}.</td></tr>}
						{table.ideas.length > 0 && filter === "all" && !q && (
							<>
								<tr><td colSpan={5} className="border-t border-ink-100 px-2 pb-1 pt-3"><span className="eyebrow inline-flex items-center gap-1"><Lightbulb className="h-3 w-3 text-ember-600" aria-hidden />Ideas to try</span></td></tr>
								{table.ideas.map((r) => <TableRow key={r.node.id} r={r} selected={selected === r.node.id} open onToggle={() => {}} onSelect={() => onSelect(r.node.id)} picked={false} cell={cell} />)}
							</>
						)}
					</tbody>
				</table>
			</div>
			{picked.length > 0 && (
				<div className="mt-2 flex items-center gap-2 rounded-xl border border-plum-200 bg-plum-50 px-3 py-1.5 text-caption text-plum-900">
					<Scale className="h-3.5 w-3.5" aria-hidden />
					<span>{picked.length === 1 ? "Pick one more version to compare" : `${picked.length} versions picked`}</span>
					<button type="button" onClick={() => setPicked([])} className="text-micro text-plum-800 underline">clear</button>
					{picked.length >= 2 && (
						<Link to={compareHref(picked)} className="ml-auto rounded-lg bg-plum-700 px-2.5 py-1 text-caption font-medium text-white hover:bg-plum-800">Compare {picked.length}</Link>
					)}
				</div>
			)}
		</div>
	);
}

function TableRow({ r, selected, open, onToggle, onSelect, picked, onPick, cell }: {
	r: Row; selected: boolean; open: boolean; onToggle: () => void; onSelect: () => void; picked: boolean; onPick?: () => void; cell: string;
}) {
	const size = r.node.kind === "workflow" ? (r.sub === "variant" ? DOT_SIZE.variant : DOT_SIZE.workflow)
		: r.node.kind === "node" ? DOT_SIZE.node : r.node.kind === "experiment" ? DOT_SIZE.experiment : r.node.kind === "version" ? DOT_SIZE.version : DOT_SIZE.suggested;
	const dot = r.node.kind === "node" ? "border-2 border-dashed border-plum-500 bg-card" : r.node.kind === "suggested" ? "border border-dashed border-gold-600 bg-card"
		: r.status.tone === "failing" ? "bg-brick-500" : r.node.kind === "workflow" ? "bg-plum-600" : r.node.kind === "experiment" ? "bg-plum-500" : "bg-plum-400";
	const spark = (r.spark || "").slice(-14).split("");
	return (
		<tr aria-selected={selected} onClick={onSelect}
			className={cn("cursor-pointer border-b border-ink-100 last:border-0 hover:bg-ink-50", selected && "bg-plum-50 hover:bg-plum-50")}>
			<td className={cell}>
				<div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: r.depth * 16 }}>
					{r.kids.length > 0 ? (
						<button type="button" aria-label={open ? "Fold" : "Unfold"} aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}
							className="-ml-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-ink-600 hover:bg-ink-100">
							{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
						</button>
					) : onPick ? (
						<input type="checkbox" checked={picked} onClick={(e) => e.stopPropagation()} onChange={onPick} aria-label={`Compare ${r.name}`}
							className="h-3.5 w-3.5 flex-shrink-0 accent-plum-700" />
					) : <span className="w-4 flex-shrink-0" />}
					<span className={cn("flex-shrink-0 rounded-full", dot)} style={{ width: size, height: size }} aria-hidden />
					<span className={cn("min-w-0 break-words sm:truncate", r.node.kind === "version" ? "text-ink-800" : "font-medium text-ink-900")}>{r.name}</span>
					{r.sub && r.node.kind !== "experiment" && <span className="flex-shrink-0 text-micro text-ink-600">{r.sub}</span>}
				</div>
				{/* Phones: one stacked row — the status and best result under the name,
				    so the name gets the width (it was cut to "Bac…" at 390 px). */}
				{(r.status.text || r.best) && (
					<div className="mt-0.5 space-y-0.5 sm:hidden" style={{ paddingLeft: r.depth * 16 + 30 }}>
						{r.status.text && <div className={cn("text-micro leading-snug", TONE_TEXT[r.status.tone] ?? "text-ink-700")}>{r.status.text}</div>}
						{r.best && <div className="break-words font-mono text-micro tabular-nums text-ink-700">{r.best}</div>}
					</div>
				)}
			</td>
			<td className={cn(cell, "hidden truncate sm:table-cell", TONE_TEXT[r.status.tone] ?? "text-ink-700")} title={r.status.text}>{r.status.text}</td>
			<td className={cn(cell, "hidden md:table-cell")}>
				{spark.length > 0 && (
					<span className="flex items-center gap-[3px]" aria-label={`Last ${spark.length} runs`}>
						{spark.map((c, i) => (
							<span key={i} className={cn("h-2 w-2 flex-shrink-0 rounded-sm", c === "o" ? "bg-gold-500" : c === "x" ? "bg-brick-500" : c === "." ? "bg-lagoon-500 animate-lumen-breathe" : "border border-ink-300")} />
						))}
					</span>
				)}
			</td>
			<td className={cn(cell, "hidden truncate font-mono tabular-nums text-ink-800 sm:table-cell")} title={r.best}>{r.best}</td>
			<td className={cn(cell, "hidden truncate text-ink-600 lg:table-cell")}>{r.when}</td>
		</tr>
	);
}


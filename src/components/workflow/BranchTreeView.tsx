// BranchTreeView — #16 + #17. A BRANCH-AWARE lineage tree of a loop's run
// history, plus a right-click control menu and a two-run comparison.
//
// Where TrajectoryGraph draws the VARIANT trajectory (baseline→variants, scored
// by an experiment), this draws the RUN LINEAGE: every run in /me/cycles, linked
// parent→child by the cycle.json `parent_run_id` the backend (G3c) writes.
// Siblings of one parent = branches. When lineage fields are absent (older
// cycles, the common case today), it degrades to a linear newest→oldest chain —
// each run's parent is simply the run before it in time.
//
// GENERIC: no app names. The node metric comes from the cycle's key_metric
// (lineage payload) when present, else the run's summary.metrics headline.
//
// Right-click any node (here, OR a casebook case row via the shared menu in the
// parent) → a context menu. The items that have a destination already (view
// data / view log / explain score / compare) are wired through callbacks the
// parent passes down; the RUNTIME ops (branch out / re-run / run variant /
// promote / discard) call me.ts. If the backend isn't ready (404/501) the item
// still shows but toasts "runtime coming" — never crashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	ReactFlow, Background, Controls, Position,
	type Node, type Edge, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch, Loader2, GitCommitVertical } from "lucide-react";
import { me, type MeCycleListItem, type MeCycleDetail } from "@/api/me";
import RunContextMenu, { type RunMenuActions, type RunMenuTarget } from "@/components/workflow/RunContextMenu";
import { cn } from "@/lib/utils";

// ── node geometry (mirrors TrajectoryGraph's vertical tree) ──
const NODE_W = 184;
const ROW_Y = 116;
const COL_X = 216;

export interface LineageNode {
	ts: string;
	parentTs?: string;
	branchLabel?: string;
	ok?: boolean;
	running?: boolean;
	metricName?: string;
	metricValue?: number;
	depth: number;
}

function fmtScore(v?: number): string {
	if (v == null) return "—";
	if (v >= -1 && v <= 1) return `${Math.round(v * 100)}%`;
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}
function cycleDate(ts?: string): string | null {
	if (!ts) return null;
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return ts;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Read a run's headline metric from its cycle list row (key_metric) defensively.
function metricOf(row: MeCycleListItem): { name?: string; value?: number } {
	const k = row.key_metric;
	if (typeof k === "number") return { value: k };
	if (k && typeof k === "object") return { name: k.name, value: typeof k.value === "number" ? k.value : undefined };
	return {};
}

// Build the lineage model. Newest-first input. If ANY row carries a
// parent_run_id we honor the real tree; otherwise we synthesize a linear chain
// (each run's parent = the next-older run) so the view never collapses to a
// disconnected scatter for pre-lineage data.
export function buildLineage(rows: MeCycleListItem[]): { nodes: LineageNode[]; hasRealLineage: boolean } {
	const byTs = new Map(rows.map((r) => [r.ts, r] as const));
	const hasRealLineage = rows.some((r) => !!r.parent_run_id && byTs.has(r.parent_run_id));
	// chronological (oldest→newest) for depth assignment
	const chrono = [...rows].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
	const depth = new Map<string, number>();
	const nodes: LineageNode[] = [];
	for (let i = 0; i < chrono.length; i++) {
		const r = chrono[i];
		const parentTs = hasRealLineage
			? (r.parent_run_id && byTs.has(r.parent_run_id) ? r.parent_run_id : undefined)
			: (i > 0 ? chrono[i - 1].ts : undefined);
		const d = parentTs != null && depth.has(parentTs) ? depth.get(parentTs)! + 1 : 0;
		depth.set(r.ts, d);
		const mk = metricOf(r);
		nodes.push({
			ts: r.ts, parentTs, branchLabel: r.branch_label,
			ok: r.ok, running: r.running, metricName: mk.name, metricValue: mk.value, depth: d,
		});
	}
	return { nodes, hasRealLineage };
}

// A node as actually drawn: linear-spine runs are collapsed, so a node's drawn
// parent may be several real runs up the chain (`elided` counts the hidden ones)
// and `displayDepth` is its position in the COLLAPSED tree, not the raw lineage.
type DisplayNode = LineageNode & { displayParentTs?: string; elided: number; displayDepth: number };

// Collapse long single-child "spine" segments so the drawn depth tracks BRANCH
// structure, not raw run count. Without this a 50-run linear history renders as
// a 50-deep vertical thread — tiny when fit-to-view and impossible to read (the
// "tree is long → ugly" problem). We ALWAYS keep: roots, branch points and
// leaves (child count ≠ 1), the first node of each branch, labeled forks, the
// focused + compare-selected runs, and the most recent KEEP_RECENT runs (so the
// active area is never hidden). Every other run on a straight spine folds into
// the connecting edge as a "+N runs" badge.
const KEEP_RECENT = 6;

function buildDisplay(lineage: LineageNode[], atTs: string | undefined, compare: Set<string>): DisplayNode[] {
	const byTs = new Map(lineage.map((n) => [n.ts, n] as const));
	const kids = new Map<string | undefined, LineageNode[]>();
	for (const n of lineage) { const a = kids.get(n.parentTs) || []; a.push(n); kids.set(n.parentTs, a); }
	const nKids = (ts: string) => (kids.get(ts) || []).length;
	const recent = new Set(
		[...lineage].sort((a, b) => (b.ts || "").localeCompare(a.ts || "")).slice(0, KEEP_RECENT).map((n) => n.ts),
	);
	const isSig = (n: LineageNode) =>
		!n.parentTs || !byTs.has(n.parentTs) ||              // root
		nKids(n.ts) !== 1 ||                                 // branch point or leaf
		(n.parentTs ? nKids(n.parentTs) !== 1 : false) ||    // first node of a branch
		!!n.branchLabel || n.ts === atTs || compare.has(n.ts) || recent.has(n.ts);
	const sig = lineage.filter(isSig);            // lineage is chrono (parents first)
	const sigSet = new Set(sig.map((n) => n.ts));
	const depthCache = new Map<string, number>();
	const out: DisplayNode[] = [];
	for (const n of sig) {
		let p = n.parentTs, elided = 0;
		while (p && byTs.has(p) && !sigSet.has(p)) { elided++; p = byTs.get(p)!.parentTs; }
		const displayParentTs = p && byTs.has(p) && sigSet.has(p) ? p : undefined;
		const dd = displayParentTs != null ? (depthCache.get(displayParentTs) ?? 0) + 1 : 0;
		depthCache.set(n.ts, dd);
		out.push({ ...n, displayParentTs, elided, displayDepth: dd });
	}
	return out;
}

// Tidy vertical tree (Knuth post-order): leaves pack left→right into COL_X slots,
// every parent is centered over the span of its children — sibling subtrees can
// never overlap (the old fixed-offset fan did), and a linear history draws as a
// straight vertical trunk. Operates on the COLLAPSED display nodes.
function layout(nodes: DisplayNode[]): Map<string, { x: number; y: number }> {
	const pos = new Map<string, { x: number; y: number }>();
	const byParent = new Map<string | undefined, DisplayNode[]>();
	for (const n of nodes) { const a = byParent.get(n.displayParentTs) || []; a.push(n); byParent.set(n.displayParentTs, a); }
	for (const arr of byParent.values()) arr.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
	let leaf = 0;
	const seen = new Set<string>();
	const place = (n: DisplayNode): number => {
		if (seen.has(n.ts)) return pos.get(n.ts)?.x ?? 0;   // cycle guard
		seen.add(n.ts);
		const ch = (byParent.get(n.ts) || []).filter((k) => !seen.has(k.ts));
		let x: number;
		if (!ch.length) { x = leaf * COL_X; leaf++; }
		else { const xs = ch.map(place); x = (xs[0] + xs[xs.length - 1]) / 2; }
		pos.set(n.ts, { x, y: n.displayDepth * ROW_Y });
		return x;
	};
	(byParent.get(undefined) || []).forEach(place);
	for (const n of nodes) if (!pos.has(n.ts)) { pos.set(n.ts, { x: (leaf++) * COL_X, y: n.displayDepth * ROW_Y }); }
	const xs = [...pos.values()].map((p) => p.x);
	if (xs.length) { const mid = (Math.min(...xs) + Math.max(...xs)) / 2; for (const p of pos.values()) p.x -= mid; }
	return pos;
}

export default function BranchTreeView({
	app, loop, atTs, onBack, actions, selectedForCompare, onToggleCompare,
}: {
	app: string;
	loop: string;
	atTs?: string;
	onBack: () => void;
	actions: RunMenuActions;
	// Two-run comparison selection (owned by the parent so "compare with…" from
	// any surface flows through one place). ts[] of length 0–2.
	selectedForCompare: string[];
	onToggleCompare: (ts: string) => void;
}) {
	const [rows, setRows] = useState<MeCycleListItem[] | null>(null);
	const [menu, setMenu] = useState<{ x: number; y: number; target: RunMenuTarget } | null>(null);

	const load = useCallback(() => {
		me.cyclesList(app, loop, 50)
			.then((r) => setRows((r.cycles || []).filter((c) => c.ts)))
			.catch(() => setRows([]));
	}, [app, loop]);
	useEffect(() => { setRows(null); load(); }, [load]);

	const { nodes: lineage, hasRealLineage } = useMemo(() => buildLineage(rows || []), [rows]);
	const byTs = useMemo(() => new Map(lineage.map((n) => [n.ts, n] as const)), [lineage]);

	const { nodes, edges } = useMemo(() => {
		const sel = new Set(selectedForCompare);
		const display = buildDisplay(lineage, atTs, sel);
		const shownByTs = new Map(display.map((n) => [n.ts, n] as const));
		const pos = layout(display);
		const cut = atTs || "";
		const nodes: Node[] = display.map((n) => {
			const isAt = n.ts === cut;
			const isSel = sel.has(n.ts);
			const tone = n.running ? "rgb(56 189 248)" : n.ok === false ? "rgb(225 29 72)" : "rgb(176 143 69)";
			return {
				id: n.ts,
				position: pos.get(n.ts) || { x: 0, y: n.displayDepth * ROW_Y },
				data: {
					label: (
						<div className="px-2.5 py-1.5 text-left" style={{ width: NODE_W }}>
							<div className="flex items-center gap-1.5">
								<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tone }} />
								<span className="text-[12px] truncate flex-1 font-medium text-slate-800">
									{n.branchLabel || cycleDate(n.ts) || n.ts}
								</span>
								{isSel && <span className="text-[9px] font-semibold text-sky-600 flex-shrink-0">compare</span>}
							</div>
							{n.branchLabel && <div className="text-[10px] text-slate-400 truncate mt-0.5">{cycleDate(n.ts)}</div>}
							<div className="flex items-center gap-1.5 mt-0.5">
								{n.running ? (
									<span className="text-[10px] uppercase tracking-wide text-sky-500">running</span>
								) : typeof n.metricValue === "number" ? (
									<span className="text-[11px] tabular-nums text-slate-600" title={n.metricName}>
										{n.metricName ? `${n.metricName.replace(/_/g, " ")}: ` : ""}{fmtScore(n.metricValue)}
									</span>
								) : (
									<span className="text-[10px] uppercase tracking-wide text-slate-400">{n.ok === false ? "failed" : "no score"}</span>
								)}
							</div>
						</div>
					),
				},
				sourcePosition: Position.Bottom,
				targetPosition: Position.Top,
				style: {
					background: "white",
					border: `2px solid ${isSel ? "rgb(56 189 248)" : isAt ? "rgb(150 119 58)" : "rgb(203 213 225)"}`,
					borderRadius: 12,
					padding: 0,
					minWidth: NODE_W,
					boxShadow: isAt
						? "0 0 0 3px rgba(176,143,69,0.18), 0 1px 3px rgba(15,23,42,0.08)"
						: isSel ? "0 0 0 3px rgba(56,189,248,0.35)" : "0 1px 2px rgba(15,23,42,0.05)",
					cursor: "pointer",
				},
			};
		});
		const edges: Edge[] = [];
		for (const n of display) {
			if (!n.displayParentTs || !shownByTs.has(n.displayParentTs)) continue;
			edges.push({
				id: `e:${n.displayParentTs}->${n.ts}`,
				source: n.displayParentTs,
				target: n.ts,
				type: "smoothstep",
				// A collapsed spine of N hidden runs gets a "+N runs" badge so the
				// elided history is legible without inflating the tree's depth.
				label: n.elided > 0 ? `+${n.elided} run${n.elided > 1 ? "s" : ""}` : undefined,
				labelShowBg: n.elided > 0,
				labelBgPadding: [6, 2],
				labelBgBorderRadius: 8,
				labelStyle: { fill: "rgb(100 116 139)", fontSize: 10, fontWeight: 500 },
				labelBgStyle: { fill: "rgb(248 250 252)", stroke: "rgb(226 232 240)" },
				style: { stroke: "rgb(203 213 225)", strokeWidth: n.elided > 0 ? 1.75 : 1.5, strokeDasharray: n.elided > 0 ? "5 3" : undefined },
			});
		}
		return { nodes, edges };
	}, [lineage, atTs, selectedForCompare]);

	// Close the menu on outside click / Escape (mirrors TrajectoryGraph).
	useEffect(() => {
		if (!menu) return;
		const h = () => setMenu(null);
		const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
		window.addEventListener("click", h);
		window.addEventListener("keydown", k);
		return () => { window.removeEventListener("click", h); window.removeEventListener("keydown", k); };
	}, [menu]);

	const onInit = useCallback((inst: ReactFlowInstance) => {
		requestAnimationFrame(() => {
			inst.fitView({ padding: 0.16, maxZoom: 1, minZoom: 0.35 });
			const vp = inst.getViewport();
			inst.setViewport({ ...vp, y: 16 });
		});
	}, []);

	return (
		<div className="relative h-full rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 flex-shrink-0">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<GitBranch className="w-3.5 h-3.5 text-gold-500 flex-shrink-0" />
					<span className="text-sm font-medium text-slate-900">Lineage</span>
					<span className="text-[11px] text-slate-400 truncate">· {hasRealLineage ? "runs by parent → child" : "runs over time (no branches yet)"}</span>
				</div>
				{selectedForCompare.length > 0 && (
					<span className="ml-auto text-[10px] text-sky-600 flex-shrink-0">{selectedForCompare.length}/2 selected to compare</span>
				)}
				<span className="ml-auto text-[10px] text-slate-300 normal-case tracking-normal flex-shrink-0">right-click a run for actions</span>
			</div>
			<div className="flex-1 min-h-0 relative">
				{rows === null ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading lineage…</div>
				) : lineage.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400 p-6">
						<GitCommitVertical className="w-6 h-6 text-slate-300" />
						<div className="text-sm text-slate-500">No runs yet.</div>
						<div className="text-xs max-w-xs">Each run becomes a node here. When a run forks from another, they branch into a tree.</div>
					</div>
				) : (
					<ReactFlow
						key={`lineage:${lineage.length}`}
						nodes={nodes}
						edges={edges}
						onInit={onInit}
						fitView={false}
						proOptions={{ hideAttribution: true }}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable
						zoomOnScroll={false}
						panOnScroll
						panOnDrag
						onNodeClick={(_e, node) => { const n = byTs.get(node.id); if (n) actions.focusRun?.(n.ts); }}
						onNodeContextMenu={(e, node) => {
							e.preventDefault();
							const n = byTs.get(node.id);
							if (n) setMenu({ x: e.clientX, y: e.clientY, target: { kind: "run", ts: n.ts, label: n.branchLabel || cycleDate(n.ts) || n.ts } });
						}}
					>
						<Background gap={16} color="rgb(241 245 249)" />
						<Controls showInteractive={false} />
					</ReactFlow>
				)}
				{menu && createPortal(
					<RunContextMenu
						x={menu.x} y={menu.y} target={menu.target} actions={actions}
						selectedForCompare={selectedForCompare} onToggleCompare={onToggleCompare}
						onClose={() => setMenu(null)} onAfterRuntimeOp={load}
					/>,
					document.body,
				)}
			</div>
		</div>
	);
}

// ── Comparison view (#16) — side-by-side metric delta of two runs ──────────
// Reuses cycleDetail's summary.metrics for each run and diffs them. Generic over
// whatever numeric metrics the runs recorded.

function readMetrics(d: MeCycleDetail | null): Record<string, number> {
	const out: Record<string, number> = {};
	const m = (d?.summary?.metrics ?? {}) as Record<string, unknown>;
	for (const [k, v] of Object.entries(m)) {
		if (typeof v === "number" && Number.isFinite(v) && !/^(xpio_ingested|auto_reflect)/.test(k)) out[k] = v;
	}
	// fold in cost/duration as comparable numbers too
	if (typeof d?.summary?.cost?.cost_usd === "number") out["cost_usd"] = d.summary.cost.cost_usd!;
	return out;
}

export function RunCompareView({ app, loop, tsA, tsB, onBack }: {
	app: string; loop: string; tsA: string; tsB: string; onBack: () => void;
}) {
	const [a, setA] = useState<MeCycleDetail | null | undefined>(undefined);
	const [b, setB] = useState<MeCycleDetail | null | undefined>(undefined);

	useEffect(() => {
		let live = true;
		setA(undefined); setB(undefined);
		me.cycleDetail(app, loop, tsA).then((d) => { if (live) setA(d); }).catch(() => { if (live) setA(null); });
		me.cycleDetail(app, loop, tsB).then((d) => { if (live) setB(d); }).catch(() => { if (live) setB(null); });
		return () => { live = false; };
	}, [app, loop, tsA, tsB]);

	const loading = a === undefined || b === undefined;
	const mA = readMetrics(a ?? null);
	const mB = readMetrics(b ?? null);
	const keys = [...new Set([...Object.keys(mA), ...Object.keys(mB)])].sort();
	const betterDown = (m: string) => /loss|error|regress|drawdown|latency|cost|fail/i.test(m);
	const num = (v: number) => (v >= -1 && v <= 1 ? `${Math.round(v * 100)}%` : Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Lineage</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<GitBranch className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />
					<span className="text-sm font-medium text-slate-900">Compare runs</span>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{loading ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading both runs…</div>
				) : keys.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400">
						<div className="text-sm text-slate-500">No numeric metrics recorded on either run.</div>
						<div className="text-xs max-w-xs">These runs didn't log comparable metrics — open each run's pipeline to inspect its steps.</div>
					</div>
				) : (
					<table className="w-full text-[12px]">
						<thead>
							<tr className="text-[10px] uppercase tracking-wide text-slate-400">
								<th className="text-left font-semibold py-1.5">metric</th>
								<th className="text-right font-semibold py-1.5 px-2 truncate" title={tsA}>{cycleDate(tsA)}</th>
								<th className="text-right font-semibold py-1.5 px-2 truncate" title={tsB}>{cycleDate(tsB)}</th>
								<th className="text-right font-semibold py-1.5">Δ</th>
							</tr>
						</thead>
						<tbody>
							{keys.map((k) => {
								const va = mA[k]; const vb = mB[k];
								const has = typeof va === "number" && typeof vb === "number";
								const delta = has ? vb - va : NaN;
								const changed = has && Math.abs(delta) > 1e-9;
								const good = changed && (betterDown(k) ? delta < 0 : delta > 0);
								return (
									<tr key={k} className={cn("border-t border-slate-100", changed && "bg-slate-50/40")}>
										<td className="py-1.5 text-slate-600">{k.replace(/_/g, " ")}{changed && <span className="ml-1 text-[9px] uppercase tracking-wide text-slate-300">changed</span>}</td>
										<td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{typeof va === "number" ? num(va) : "—"}</td>
										<td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{typeof vb === "number" ? num(vb) : "—"}</td>
										<td className={cn("py-1.5 text-right tabular-nums font-medium", !changed ? "text-slate-300" : good ? "text-gold-600" : "text-rose-500")}>
											{has ? (changed ? `${delta > 0 ? "+" : ""}${num(delta)}` : "·") : "—"}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

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
const COL_X = 208;

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

// Vertical layout: depth→y; the trunk (a node that is its parent's FIRST child)
// keeps the parent's x; later siblings (branches) fan out left/right.
function layout(nodes: LineageNode[]): Map<string, { x: number; y: number }> {
	const pos = new Map<string, { x: number; y: number }>();
	const byParent = new Map<string | undefined, LineageNode[]>();
	for (const n of nodes) {
		const a = byParent.get(n.parentTs) || [];
		a.push(n);
		byParent.set(n.parentTs, a);
	}
	// roots
	const roots = byParent.get(undefined) || [];
	roots.forEach((r, i) => pos.set(r.ts, { x: (i - (roots.length - 1) / 2) * COL_X, y: 0 }));
	// BFS children, fanning siblings around the parent's x
	const queue = [...roots];
	const seen = new Set(roots.map((r) => r.ts));
	while (queue.length) {
		const p = queue.shift()!;
		const px = pos.get(p.ts)?.x ?? 0;
		const kids = (byParent.get(p.ts) || []).filter((k) => !seen.has(k.ts));
		kids.forEach((k, i) => {
			// first child stays on the trunk; others fan -, +, -, + …
			const x = i === 0 ? px : px + (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * COL_X;
			pos.set(k.ts, { x, y: k.depth * ROW_Y });
			seen.add(k.ts);
			queue.push(k);
		});
	}
	// any orphan (cycle in lineage / unseen) → stack by depth
	let orphan = 0;
	for (const n of nodes) if (!pos.has(n.ts)) pos.set(n.ts, { x: (++orphan) * COL_X, y: n.depth * ROW_Y });
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
		const pos = layout(lineage);
		const cut = atTs || "";
		const sel = new Set(selectedForCompare);
		const nodes: Node[] = lineage.map((n) => {
			const isAt = n.ts === cut;
			const isSel = sel.has(n.ts);
			const tone = n.running ? "rgb(56 189 248)" : n.ok === false ? "rgb(225 29 72)" : "rgb(176 143 69)";
			return {
				id: n.ts,
				position: pos.get(n.ts) || { x: 0, y: n.depth * ROW_Y },
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
		for (const n of lineage) {
			if (!n.parentTs || !byTs.has(n.parentTs)) continue;
			edges.push({
				id: `e:${n.parentTs}->${n.ts}`,
				source: n.parentTs,
				target: n.ts,
				type: "smoothstep",
				style: { stroke: "rgb(203 213 225)", strokeWidth: 1.75 },
			});
		}
		return { nodes, edges };
	}, [lineage, byTs, atTs, selectedForCompare]);

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

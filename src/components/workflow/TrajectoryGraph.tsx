// TrajectoryGraph — the Runs view as an EVOLVING TREE (top→bottom), not a list.
//
// Each node is a variant (a config point the loop explored). The tree flows
// vertically: a baseline at the top, each cycle's variants below it, the
// best-so-far champion forming a highlighted gold trunk. Degrades to a linear
// run chain for apps without experiments.
//
// Overlays (informative, not busy):
//   • TREND    — node fill encodes the metric vs baseline (gold above / rose
//                below / slate neutral / dashed = not yet scored).
//   • LEARNING — per-cycle "+N" badges (memories banked that cycle).
//   • TIME     — each node shows its run's execution time.
//
// Interaction:
//   • Click a node → the view SLIDES (no popup) from the tree to that run's
//     exact pipeline; Back slides home with the tree exactly where you left it.
//   • Right-click a node → control menu (e.g. "Branch from here" queues a
//     signal the loop explores from next cycle; queued branches show as ghosts).

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
	ReactFlow, Background, Controls, Position,
	type Node, type Edge, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch, Trophy, Sparkles, Loader2, Clock, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import {
	fetchTrajectory, fetchTrajectorySignals, postTrajectorySignal,
	type Trajectory, type TrajectoryNode, type TrajectorySignal,
} from "@/api/trajectory";
import { me, type MeCycleDetail, type LoopDefinition } from "@/api/me";
import WorkflowCanvas from "@/components/workflow/WorkflowCanvas";
import { cn } from "@/lib/utils";

const NODE_W = 184;
const NODE_H = 66;
const ROW_Y = 124; // vertical gap between depths (cycles)
const COL_X = 208; // horizontal gap between sibling variants

type GNode = TrajectoryNode & { proposed?: boolean; note?: string };

function fmtScore(v?: number): string {
	if (v == null) return "—";
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}
function fmtDur(s?: number): string | null {
	if (s == null || s <= 0) return null;
	if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
	const m = Math.floor(s / 60);
	const r = Math.round(s % 60);
	return r ? `${m}m ${r}s` : `${m}m`;
}

function tone(n: GNode, baseline: number | null | undefined, hib: boolean) {
	if (n.proposed) return { border: "rgb(176 143 69)", dot: "rgb(176 143 69)", dashed: true };
	if (n.kind === "baseline") return { border: "rgb(100 116 139)", dot: "rgb(100 116 139)", dashed: false };
	if (!n.scored || n.score == null) return { border: "rgb(203 213 225)", dot: "rgb(203 213 225)", dashed: true };
	const d =
		n.delta_vs_baseline != null ? n.delta_vs_baseline
			: baseline != null ? (hib ? n.score - baseline : baseline - n.score) : 0;
	if (d > 1e-6) return { border: "rgb(150 119 58)", dot: "rgb(176 143 69)", dashed: false };
	if (d < -1e-6) return { border: "rgb(190 18 60)", dot: "rgb(225 29 72)", dashed: false };
	return { border: "rgb(148 163 184)", dot: "rgb(148 163 184)", dashed: false };
}

// Vertical tree: depth → y; champion stays on the parent's trunk x, siblings
// fan left/right. Ghost (queued-branch) nodes hang under their source.
function buildModel(traj: Trajectory | null, signals: TrajectorySignal[]): {
	model: GNode[]; byId: Map<string, GNode>;
} {
	const real: GNode[] = (traj?.nodes || []).map((n) => ({ ...n }));
	const byId = new Map(real.map((n) => [n.id, n] as const));
	const ghosts: GNode[] = [];
	signals
		.filter((s) => s.action === "branch" && (s.status ?? "pending") === "pending" && s.from_id)
		.forEach((s, i) => {
			const parent = byId.get(s.from_id!);
			if (!parent) return;
			ghosts.push({
				id: `ghost:${i}`, kind: "run", proposed: true, parent_id: s.from_id,
				depth: parent.depth + 1, label: "branch · queued", note: s.note,
				config: (s.config as Record<string, string | number | boolean>) || parent.config,
				scored: false,
			});
		});
	const model = [...real, ...ghosts];
	for (const g of ghosts) byId.set(g.id, g);
	return { model, byId };
}

function layout(model: GNode[]): Map<string, { x: number; y: number }> {
	const pos = new Map<string, { x: number; y: number }>();
	const real = model.filter((n) => !n.proposed);
	const depths = new Map<number, GNode[]>();
	for (const n of real) {
		const a = depths.get(n.depth) || [];
		a.push(n);
		depths.set(n.depth, a);
	}
	for (const d of [...depths.keys()].sort((a, b) => a - b)) {
		const group = depths.get(d)!;
		const champ = group.find((n) => n.is_champion) || (group.length === 1 ? group[0] : undefined);
		let trunkX = 0;
		if (champ?.parent_id && pos.has(champ.parent_id)) trunkX = pos.get(champ.parent_id)!.x;
		if (champ) {
			pos.set(champ.id, { x: trunkX, y: d * ROW_Y });
			group.filter((n) => n.id !== champ.id).forEach((n, i) => {
				const k = Math.floor(i / 2) + 1;
				const sign = i % 2 === 0 ? -1 : 1;
				pos.set(n.id, { x: trunkX + sign * k * COL_X, y: d * ROW_Y });
			});
		} else {
			group.forEach((n, i) => pos.set(n.id, { x: (i - (group.length - 1) / 2) * COL_X, y: d * ROW_Y }));
		}
	}
	// Ghosts hang just below + offset from their source.
	for (const g of model.filter((n) => n.proposed)) {
		const p = g.parent_id ? pos.get(g.parent_id) : undefined;
		pos.set(g.id, p ? { x: p.x + COL_X * 0.7, y: p.y + ROW_Y * 0.72 } : { x: 0, y: 0 });
	}
	return pos;
}

function Inner({ app, loop, definition }: { app: string; loop: string; definition?: LoopDefinition | null }) {
	const [traj, setTraj] = useState<Trajectory | null>(null);
	const [signals, setSignals] = useState<TrajectorySignal[]>([]);
	const [loading, setLoading] = useState(true);
	const [picked, setPicked] = useState<GNode | null>(null);
	const [view, setView] = useState<"tree" | "pipeline">("tree");
	const [cycle, setCycle] = useState<MeCycleDetail | null>(null);
	const [cycleLoading, setCycleLoading] = useState(false);
	const [menu, setMenu] = useState<{ x: number; y: number; node: GNode } | null>(null);

	useEffect(() => {
		let live = true;
		setLoading(true);
		Promise.all([fetchTrajectory(app, loop).catch(() => null), fetchTrajectorySignals(app, loop).catch(() => [])])
			.then(([t, s]) => { if (live) { setTraj(t); setSignals(s); } })
			.finally(() => { if (live) setLoading(false); });
		return () => { live = false; };
	}, [app, loop]);

	const reloadSignals = useCallback(() => { fetchTrajectorySignals(app, loop).then(setSignals).catch(() => {}); }, [app, loop]);

	const { model, byId } = useMemo(() => buildModel(traj, signals), [traj, signals]);
	const hib = traj?.higher_is_better !== false;
	const baseline = traj?.baseline ?? null;

	const { nodes, edges } = useMemo(() => {
		const pos = layout(model);
		const nodes: Node[] = model.map((n) => {
			const t = tone(n, baseline, hib);
			const dur = fmtDur(n.duration_s);
			const learned = n.is_champion ? (traj?.cycles || [])[n.depth - 1]?.learned || 0 : 0;
			const sel = picked?.id === n.id;
			return {
				id: n.id,
				position: pos.get(n.id) || { x: 0, y: n.depth * ROW_Y },
				data: {
					label: (
						<div className="px-2.5 py-1.5 text-left" style={{ width: NODE_W }}>
							<div className="flex items-center gap-1.5">
								<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.dot }} />
								<span className={cn("text-[12px] truncate flex-1 font-medium", n.proposed ? "text-gold-700 italic" : "text-slate-800")}>{n.label}</span>
								{n.is_champion && <Trophy className="w-3 h-3 text-gold-500 flex-shrink-0" />}
							</div>
							<div className="flex items-center gap-1.5 mt-0.5">
								{n.proposed ? (
									<span className="text-[10px] uppercase tracking-wide text-gold-500">queued</span>
								) : n.scored && n.score != null ? (
									<span className="text-[11px] tabular-nums text-slate-600">{fmtScore(n.score)}</span>
								) : n.kind !== "baseline" ? (
									<span className="text-[10px] uppercase tracking-wide text-slate-400">not scored</span>
								) : (
									<span className="text-[10px] uppercase tracking-wide text-slate-400">baseline</span>
								)}
								{n.delta_vs_baseline != null && Math.abs(n.delta_vs_baseline) > 1e-6 && (
									<span className={cn("text-[10px] tabular-nums", n.delta_vs_baseline > 0 ? "text-gold-600" : "text-rose-500")}>
										{n.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(n.delta_vs_baseline)}
									</span>
								)}
								{dur && (
									<span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-slate-400 tabular-nums" title="execution time">
										<Clock className="w-2.5 h-2.5" />{dur}
									</span>
								)}
								{learned > 0 && (
									<span className={cn("inline-flex items-center gap-0.5 text-[10px] text-gold-600", dur ? "" : "ml-auto")} title={`${learned} memories banked this cycle`}>
										<Sparkles className="w-2.5 h-2.5" />{learned}
									</span>
								)}
							</div>
						</div>
					),
				},
				sourcePosition: Position.Bottom,
				targetPosition: Position.Top,
				style: {
					background: n.proposed ? "rgb(254 252 245)" : "white",
					border: `2px ${t.dashed ? "dashed" : "solid"} ${t.border}`,
					borderRadius: 12,
					padding: 0,
					minWidth: NODE_W,
					boxShadow: n.is_champion
						? "0 0 0 3px rgba(176,143,69,0.18), 0 1px 3px rgba(15,23,42,0.08)"
						: sel ? "0 0 0 3px rgba(56,189,248,0.4)" : "0 1px 2px rgba(15,23,42,0.05)",
					transition: "box-shadow .2s",
					cursor: n.proposed ? "default" : "pointer",
				},
			};
		});
		const edges: Edge[] = [];
		for (const n of model) {
			if (!n.parent_id) continue;
			const parent = byId.get(n.parent_id);
			const trunk = !!n.is_champion && (!!parent?.is_champion || parent?.kind === "baseline");
			edges.push({
				id: `e:${n.parent_id}->${n.id}`,
				source: n.parent_id,
				target: n.id,
				type: "smoothstep",
				animated: trunk || !!n.proposed,
				style: n.proposed
					? { stroke: "rgb(176 143 69)", strokeWidth: 1.5, strokeDasharray: "5 4" }
					: trunk
						? { stroke: "rgb(176 143 69)", strokeWidth: 2.5 }
						: { stroke: "rgb(203 213 225)", strokeWidth: 1.5, strokeDasharray: n.scored ? undefined : "5 4" },
			});
		}
		return { nodes, edges };
	}, [model, byId, baseline, hib, picked, traj]);

	const openPipeline = useCallback((tn: GNode) => {
		setPicked(tn);
		setView("pipeline");
		setCycle(null);
		if (tn.run_ts) {
			setCycleLoading(true);
			me.cycleDetail(app, loop, tn.run_ts).then(setCycle).catch(() => setCycle(null)).finally(() => setCycleLoading(false));
		}
	}, [app, loop]);

	const branchFrom = useCallback(async (tn: GNode) => {
		setMenu(null);
		try {
			await postTrajectorySignal(app, { loop, action: "branch", from_id: tn.id, from_variant_id: tn.variant_id, config: tn.config });
			toast.success("Branch queued — the loop will explore from here next cycle.");
			reloadSignals();
		} catch {
			toast.error("Could not queue the branch.");
		}
	}, [app, loop, reloadSignals]);

	// Close the context menu on any outside click / Escape.
	useEffect(() => {
		if (!menu) return;
		const h = () => setMenu(null);
		const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
		window.addEventListener("click", h);
		window.addEventListener("keydown", k);
		return () => { window.removeEventListener("click", h); window.removeEventListener("keydown", k); };
	}, [menu]);

	const onInit = useCallback((inst: ReactFlowInstance) => {
		// Vertical: fit horizontally + cap zoom, then pin to the TOP so the tree
		// begins at the top and pans/scrolls downward.
		requestAnimationFrame(() => {
			inst.fitView({ padding: 0.16, maxZoom: 1, minZoom: 0.35 });
			const vp = inst.getViewport();
			inst.setViewport({ ...vp, y: 16 });
		});
	}, []);

	if (loading)
		return <div className="h-full flex items-center justify-center text-xs text-slate-400 rounded-xl border border-slate-200 bg-white"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading trajectory…</div>;
	if (!traj || (traj.nodes?.length ?? 0) === 0)
		return (
			<div className="h-full flex flex-col items-center justify-center gap-2 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6">
				<GitBranch className="w-6 h-6 text-slate-300" />
				<div className="text-sm text-slate-500">No run trajectory yet.</div>
				<div className="text-xs text-slate-400 max-w-xs">Each run becomes a node here — and when this workflow explores variants, they branch into a tree with the best-so-far on the trunk.</div>
			</div>
		);

	const totalLearned = (traj.cycles || []).reduce((n, c) => n + (c.learned || 0), 0);
	const champ = (traj.nodes || []).filter((n) => n.is_champion).slice(-1)[0];

	return (
		<div className="relative h-full rounded-xl border border-slate-200 bg-white overflow-hidden">
			<div
				className="flex h-full w-[200%]"
				style={{ transform: view === "pipeline" ? "translateX(-50%)" : "translateX(0)", transition: "transform .55s cubic-bezier(0.22,1,0.36,1)" }}
			>
				{/* ── PANE 1 · the trajectory tree ── */}
				<div className="w-1/2 h-full relative">
					{/* header rollup — trend + learning, at a glance */}
					<div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-3 py-2 bg-gradient-to-b from-white via-white/90 to-transparent pointer-events-none">
						<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide"><GitBranch className="w-3.5 h-3.5 text-gold-500" /> Trajectory</span>
						{traj.has_variants && traj.metric && (
							<span className="text-[11px] text-slate-400">{traj.nodes.length} variants · <span className="font-mono text-slate-600">{traj.metric}</span>{traj.baseline != null && <> · base <span className="tabular-nums">{fmtScore(traj.baseline)}</span></>}</span>
						)}
						{champ?.score != null && (
							<span className="inline-flex items-center gap-1 text-[11px] text-gold-700"><Trophy className="w-3 h-3" /> best <span className="tabular-nums font-medium">{fmtScore(champ.score)}</span>{champ.delta_vs_baseline != null && Math.abs(champ.delta_vs_baseline) > 1e-6 && <span className="tabular-nums">({champ.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(champ.delta_vs_baseline)})</span>}</span>
						)}
						{totalLearned > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-gold-600"><Sparkles className="w-3 h-3" /> {totalLearned} learned</span>}
						<span className="ml-auto text-[10px] text-slate-300 normal-case tracking-normal">click a node · right-click to branch</span>
					</div>

					<ReactFlow
						key={`${nodes.length}`}
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
						onNodeClick={(_e, node) => { const tn = byId.get(node.id); if (tn && !tn.proposed) openPipeline(tn); }}
						onNodeContextMenu={(e, node) => { e.preventDefault(); const tn = byId.get(node.id); if (tn) setMenu({ x: e.clientX, y: e.clientY, node: tn }); }}
					>
						<Background gap={16} color="rgb(241 245 249)" />
						<Controls showInteractive={false} />
					</ReactFlow>

					{menu && (
						<div className="fixed z-50 min-w-[180px] rounded-lg border border-slate-200 bg-white shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
							<div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 truncate">{menu.node.label}</div>
							{!menu.node.proposed && (
								<button onClick={() => openPipeline(menu.node)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 text-left"><FlaskConical className="w-3.5 h-3.5 text-slate-400" /> Open pipeline</button>
							)}
							<button onClick={() => branchFrom(menu.node)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-gold-50 text-left"><GitBranch className="w-3.5 h-3.5 text-gold-500" /> Branch from here</button>
						</div>
					)}
				</div>

				{/* ── PANE 2 · the selected run's pipeline ── */}
				<div className="w-1/2 h-full flex flex-col bg-white">
					<div className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-100">
						<button onClick={() => setView("tree")} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
						{picked && (
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									{picked.is_champion && <Trophy className="w-3.5 h-3.5 text-gold-500" />}
									<span className="text-sm font-medium text-slate-900 truncate">{picked.label}</span>
								</div>
								<div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
									{picked.scored && picked.score != null && <span className="tabular-nums">{traj.metric || "score"}: <span className="text-slate-700 font-medium">{fmtScore(picked.score)}</span></span>}
									{picked.delta_vs_baseline != null && Math.abs(picked.delta_vs_baseline) > 1e-6 && <span className={cn("tabular-nums", picked.delta_vs_baseline > 0 ? "text-gold-600" : "text-rose-500")}>{picked.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(picked.delta_vs_baseline)} vs base</span>}
									{fmtDur(picked.duration_s) && <span className="inline-flex items-center gap-0.5 tabular-nums"><Clock className="w-3 h-3" />{fmtDur(picked.duration_s)}</span>}
								</div>
							</div>
						)}
					</div>
					{picked?.config && Object.keys(picked.config).length > 0 && (
						<div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1.5">
							{Object.entries(picked.config).slice(0, 10).map(([k, v]) => (
								<span key={k} className="inline-flex items-center gap-1 text-[10.5px] rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5">
									<span className="text-slate-400">{k.split(".").pop()?.replace(/_/g, " ")}</span>
									<span className="text-slate-700 font-mono">{String(v)}</span>
								</span>
							))}
						</div>
					)}
					<div className="flex-1 min-h-0 p-3">
						{cycleLoading ? (
							<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading run…</div>
						) : definition ? (
							view === "pipeline" ? <WorkflowCanvas definition={definition} cycle={cycle} height="100%" /> : null
						) : (
							<div className="h-full flex items-center justify-center text-xs text-slate-400">No pipeline declared.</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export default function TrajectoryGraph({ app, loop, definition }: { app: string; loop: string; definition?: LoopDefinition | null }) {
	// No shared ReactFlowProvider: the trajectory <ReactFlow> and the pipeline
	// pane's WorkflowCanvas <ReactFlow> must each own an isolated store —
	// otherwise interacting with the pipeline clobbers the trajectory's nodes
	// (and the tree vanishes on return). Each bare <ReactFlow> self-stores.
	return <Inner app={app} loop={loop} definition={definition} />;
}

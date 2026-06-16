// TrajectoryGraph — the Runs view as an EVOLVING TREE, not a flat list.
//
// Each node is a variant (a config point an autoresearch loop explored).
// The tree is a baseline root → each cycle's variants branching off the
// running champion → the champion forms a highlighted gold trunk. For apps
// without experiments it degrades to a linear run chain.
//
// Overlays (so the view is informative, not busy):
//   • TREND    — node fill encodes the metric vs baseline (gold = above,
//                rose = below, slate = neutral, dashed = not yet scored);
//                the champion trunk is the rising line.
//   • LEARNING — per-cycle "+N" badges (memories banked that cycle).
//
// Interaction: click a node → the canvas PANS to it with motion, then the
// exact workflow pipeline for that run blooms in over a blurred backdrop.

import { useMemo, useState, useEffect, useCallback } from "react";
import {
	ReactFlow, ReactFlowProvider, Background, Controls, Position,
	useReactFlow, type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X, GitBranch, Trophy, Sparkles, Loader2, FlaskConical } from "lucide-react";
import { fetchTrajectory, type Trajectory, type TrajectoryNode } from "@/api/trajectory";
import { me, type MeCycleDetail, type LoopDefinition } from "@/api/me";
import WorkflowCanvas from "@/components/workflow/WorkflowCanvas";
import { cn } from "@/lib/utils";

const NODE_W = 178;
const NODE_H = 58;
const COL_X = 226; // horizontal gap between depths (cycles)
const ROW_Y = 88; // vertical gap between sibling variants

// ── tone: node fill/border by metric vs baseline (the TREND overlay) ──
function tone(n: TrajectoryNode, baseline: number | null | undefined, hib: boolean) {
	if (n.kind === "baseline")
		return { border: "rgb(100 116 139)", dot: "rgb(100 116 139)", dashed: false };
	if (!n.scored || n.score == null)
		return { border: "rgb(203 213 225)", dot: "rgb(203 213 225)", dashed: true };
	const d =
		n.delta_vs_baseline != null
			? n.delta_vs_baseline
			: baseline != null
				? (hib ? n.score - baseline : baseline - n.score)
				: 0;
	if (d > 1e-6) return { border: "rgb(150 119 58)", dot: "rgb(176 143 69)", dashed: false }; // gold
	if (d < -1e-6) return { border: "rgb(190 18 60)", dot: "rgb(225 29 72)", dashed: false }; // rose
	return { border: "rgb(148 163 184)", dot: "rgb(148 163 184)", dashed: false }; // slate
}

function fmtScore(v?: number): string {
	if (v == null) return "—";
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}

// Lay the tree out: depth → x column; champion stays on the parent's trunk
// line, siblings fan above/below it.
function buildGraph(
	traj: Trajectory,
	selectedId: string | null,
	cyclesByDepth: Map<number, { learned?: number }>,
): { nodes: Node[]; edges: Edge[] } {
	const ns = traj.nodes || [];
	const hib = traj.higher_is_better !== false;
	const baseline = traj.baseline ?? null;

	const depths = new Map<number, TrajectoryNode[]>();
	for (const n of ns) {
		const arr = depths.get(n.depth) || [];
		arr.push(n);
		depths.set(n.depth, arr);
	}
	const pos = new Map<string, { x: number; y: number }>();
	const sorted = [...depths.keys()].sort((a, b) => a - b);
	for (const d of sorted) {
		const group = depths.get(d)!;
		const champ = group.find((n) => n.is_champion) || (group.length === 1 ? group[0] : undefined);
		let trunkY = 0;
		if (champ?.parent_id && pos.has(champ.parent_id)) trunkY = pos.get(champ.parent_id)!.y;
		if (champ) {
			pos.set(champ.id, { x: d * COL_X, y: trunkY });
			const others = group.filter((n) => n.id !== champ.id);
			others.forEach((n, i) => {
				const k = Math.floor(i / 2) + 1;
				const sign = i % 2 === 0 ? -1 : 1;
				pos.set(n.id, { x: d * COL_X, y: trunkY + sign * k * ROW_Y });
			});
		} else {
			group.forEach((n, i) => pos.set(n.id, { x: d * COL_X, y: (i - (group.length - 1) / 2) * ROW_Y }));
		}
	}

	const nodes: Node[] = ns.map((n) => {
		const t = tone(n, baseline, hib);
		const p = pos.get(n.id) || { x: n.depth * COL_X, y: 0 };
		const sel = n.id === selectedId;
		const learned = n.is_champion ? cyclesByDepth.get(n.depth)?.learned || 0 : 0;
		return {
			id: n.id,
			position: p,
			data: {
				label: (
					<div className="px-2.5 py-1.5 text-left" style={{ width: NODE_W }}>
						<div className="flex items-center gap-1.5">
							<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.dot }} />
							<span className="text-[12px] text-slate-800 truncate flex-1 font-medium">{n.label}</span>
							{n.is_champion && <Trophy className="w-3 h-3 text-gold-500 flex-shrink-0" />}
						</div>
						<div className="flex items-center gap-1.5 mt-0.5">
							{n.scored && n.score != null ? (
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
							{learned > 0 && (
								<span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-gold-600" title={`${learned} memories banked this cycle`}>
									<Sparkles className="w-2.5 h-2.5" />{learned}
								</span>
							)}
						</div>
					</div>
				),
			},
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			style: {
				background: "white",
				border: `2px ${t.dashed ? "dashed" : "solid"} ${t.border}`,
				borderRadius: 12,
				padding: 0,
				minWidth: NODE_W,
				boxShadow: n.is_champion
					? "0 0 0 3px rgba(176,143,69,0.18), 0 1px 3px rgba(15,23,42,0.08)"
					: sel
						? "0 0 0 3px rgba(56,189,248,0.35)"
						: "0 1px 2px rgba(15,23,42,0.05)",
				transition: "box-shadow .2s, transform .2s",
				cursor: "pointer",
			},
		};
	});

	const byId = new Map(ns.map((n) => [n.id, n]));
	const edges: Edge[] = [];
	for (const n of ns) {
		if (!n.parent_id) continue;
		const parent = byId.get(n.parent_id);
		const trunk = !!n.is_champion && (!!parent?.is_champion || parent?.kind === "baseline");
		edges.push({
			id: `e:${n.parent_id}->${n.id}`,
			source: n.parent_id,
			target: n.id,
			type: "smoothstep",
			animated: trunk,
			style: trunk
				? { stroke: "rgb(176 143 69)", strokeWidth: 2.5 }
				: { stroke: "rgb(203 213 225)", strokeWidth: 1.5, strokeDasharray: n.scored ? undefined : "5 4" },
		});
	}
	return { nodes, edges };
}

function Inner({
	traj, selectedId, onPick,
}: {
	traj: Trajectory;
	selectedId: string | null;
	onPick: (n: TrajectoryNode, center: () => void) => void;
}) {
	const rf = useReactFlow();
	const cyclesByDepth = useMemo(() => {
		const m = new Map<number, { learned?: number }>();
		// cycles[] is ordered oldest→newest; depth of a cycle = index+1.
		(traj.cycles || []).forEach((c, i) => m.set(i + 1, { learned: c.learned }));
		return m;
	}, [traj.cycles]);
	const { nodes, edges } = useMemo(
		() => buildGraph(traj, selectedId, cyclesByDepth),
		[traj, selectedId, cyclesByDepth],
	);
	const byId = useMemo(() => new Map((traj.nodes || []).map((n) => [n.id, n])), [traj.nodes]);

	const handleClick = useCallback(
		(_e: React.MouseEvent, node: Node) => {
			const tn = byId.get(node.id);
			if (!tn) return;
			onPick(tn, () =>
				rf.setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, { zoom: 1.1, duration: 650 }),
			);
		},
		[byId, onPick, rf],
	);

	return (
		<ReactFlow
			key={`${nodes.length}:${traj.nodes?.length || 0}`}
			nodes={nodes}
			edges={edges}
			fitView
			fitViewOptions={{ padding: 0.18, maxZoom: 1.1, minZoom: 0.3 }}
			proOptions={{ hideAttribution: true }}
			nodesDraggable={false}
			nodesConnectable={false}
			elementsSelectable
			zoomOnScroll={false}
			panOnScroll
			panOnDrag
			onNodeClick={handleClick}
		>
			<Background gap={16} color="rgb(241 245 249)" />
			<Controls showInteractive={false} />
		</ReactFlow>
	);
}

export default function TrajectoryGraph({
	app, loop, definition,
}: {
	app: string;
	loop: string;
	definition?: LoopDefinition | null;
}) {
	const [traj, setTraj] = useState<Trajectory | null>(null);
	const [loading, setLoading] = useState(true);
	const [picked, setPicked] = useState<TrajectoryNode | null>(null);
	const [reveal, setReveal] = useState(false); // pipeline overlay shown (after the pan)
	const [cycle, setCycle] = useState<MeCycleDetail | null>(null);
	const [cycleLoading, setCycleLoading] = useState(false);

	useEffect(() => {
		let live = true;
		setLoading(true);
		fetchTrajectory(app, loop)
			.then((t) => { if (live) setTraj(t); })
			.catch(() => { if (live) setTraj(null); })
			.finally(() => { if (live) setLoading(false); });
		return () => { live = false; };
	}, [app, loop]);

	// Click a node → pan the canvas (motion), then bloom the pipeline in.
	const onPick = useCallback((n: TrajectoryNode, center: () => void) => {
		setPicked(n);
		center(); // animated setCenter on the trajectory
		setReveal(false);
		setCycle(null);
		// Load the run behind this variant for the pipeline overlay.
		if (n.run_ts) {
			setCycleLoading(true);
			me.cycleDetail(app, loop, n.run_ts)
				.then((d) => setCycle(d))
				.catch(() => setCycle(null))
				.finally(() => setCycleLoading(false));
		}
		// Reveal the pipeline AFTER the pan is visible (motion first).
		window.setTimeout(() => setReveal(true), 360);
	}, [app, loop]);

	const close = useCallback(() => { setReveal(false); setPicked(null); setCycle(null); }, []);

	const totalLearned = (traj?.cycles || []).reduce((n, c) => n + (c.learned || 0), 0);
	const champ = (traj?.nodes || []).filter((n) => n.is_champion).slice(-1)[0];

	if (loading)
		return (
			<div className="h-full flex items-center justify-center text-xs text-slate-400 rounded-xl border border-slate-200 bg-white">
				<Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading trajectory…
			</div>
		);

	if (!traj || (traj.nodes?.length ?? 0) === 0)
		return (
			<div className="h-full flex flex-col items-center justify-center gap-2 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6">
				<GitBranch className="w-6 h-6 text-slate-300" />
				<div className="text-sm text-slate-500">No run trajectory yet.</div>
				<div className="text-xs text-slate-400 max-w-xs">Each run becomes a node here — and when this workflow explores variants, they branch into a tree with the best-so-far on the trunk.</div>
			</div>
		);

	return (
		<div className="relative h-full rounded-xl border border-slate-200 bg-white overflow-hidden">
			{/* Overlay header — what the graph is, + the live trend/learning rollup. */}
			<div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-3 py-2 bg-gradient-to-b from-white via-white/90 to-transparent pointer-events-none">
				<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<GitBranch className="w-3.5 h-3.5 text-gold-500" /> Trajectory
				</span>
				{traj.has_variants && traj.metric && (
					<span className="text-[11px] text-slate-400">
						{traj.nodes.length} variants · metric <span className="font-mono text-slate-600">{traj.metric}</span>
						{traj.baseline != null && <> · baseline <span className="tabular-nums">{fmtScore(traj.baseline)}</span></>}
					</span>
				)}
				{champ?.score != null && (
					<span className="inline-flex items-center gap-1 text-[11px] text-gold-700">
						<Trophy className="w-3 h-3" /> best <span className="tabular-nums font-medium">{fmtScore(champ.score)}</span>
						{champ.delta_vs_baseline != null && Math.abs(champ.delta_vs_baseline) > 1e-6 && (
							<span className="tabular-nums">({champ.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(champ.delta_vs_baseline)})</span>
						)}
					</span>
				)}
				{totalLearned > 0 && (
					<span className="inline-flex items-center gap-1 text-[11px] text-gold-600">
						<Sparkles className="w-3 h-3" /> {totalLearned} learned
					</span>
				)}
			</div>

			<ReactFlowProvider>
				<Inner traj={traj} selectedId={picked?.id ?? null} onPick={onPick} />
			</ReactFlowProvider>

			{/* Pipeline reveal — blooms in over a blurred backdrop AFTER the pan. */}
			{picked && reveal && (
				<div className="absolute inset-0 z-20 flex animate-in fade-in duration-200">
					<button
						onClick={close}
						className="absolute inset-0 bg-white/55 backdrop-blur-[3px] cursor-zoom-out"
						aria-label="Back to trajectory"
					/>
					<div className="relative ml-auto h-full w-full sm:w-[62%] max-w-2xl bg-white border-l border-slate-200 shadow-2xl shadow-slate-300/40 flex flex-col animate-in slide-in-from-right-4 fade-in duration-300">
						{/* Variant header */}
						<div className="flex items-start gap-2 px-4 py-3 border-b border-slate-100">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									{picked.is_champion && <Trophy className="w-3.5 h-3.5 text-gold-500" />}
									<span className="text-sm font-medium text-slate-900 truncate">{picked.label}</span>
								</div>
								<div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
									{picked.scored && picked.score != null && <span className="tabular-nums">{traj.metric || "score"}: <span className="text-slate-700 font-medium">{fmtScore(picked.score)}</span></span>}
									{picked.delta_vs_baseline != null && Math.abs(picked.delta_vs_baseline) > 1e-6 && (
										<span className={cn("tabular-nums", picked.delta_vs_baseline > 0 ? "text-gold-600" : "text-rose-500")}>
											{picked.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(picked.delta_vs_baseline)} vs baseline
										</span>
									)}
									{!picked.scored && picked.kind === "variant" && <span className="uppercase tracking-wide text-slate-400">not scored yet</span>}
								</div>
							</div>
							<button onClick={close} className="flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="w-4 h-4" /></button>
						</div>

						{/* Variant config (the knobs that define this variant) */}
						{picked.config && Object.keys(picked.config).length > 0 && (
							<div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-1.5">
								{Object.entries(picked.config).slice(0, 10).map(([k, v]) => (
									<span key={k} className="inline-flex items-center gap-1 text-[10.5px] rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5">
										<span className="text-slate-400">{k.split(".").pop()?.replace(/_/g, " ")}</span>
										<span className="text-slate-700 font-mono">{String(v)}</span>
									</span>
								))}
							</div>
						)}

						{/* The exact pipeline for this run */}
						<div className="flex-1 min-h-0 p-3">
							<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 flex items-center gap-1">
								<FlaskConical className="w-3 h-3" /> Pipeline {picked.run_ts ? "· this run" : "· declared shape"}
							</div>
							{cycleLoading ? (
								<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading run…</div>
							) : definition ? (
								<WorkflowCanvas definition={definition} cycle={cycle} height="100%" />
							) : (
								<div className="h-full flex items-center justify-center text-xs text-slate-400">No pipeline declared.</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

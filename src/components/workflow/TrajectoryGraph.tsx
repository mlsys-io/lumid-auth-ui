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
//   • Right-click a node → control menu (e.g. "Branch out" queues a
//     signal the loop explores from next cycle; queued branches show as ghosts).

import { useMemo, useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
	ReactFlow, Background, Controls, Position,
	type Node, type Edge, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch, Trophy, Sparkles, Loader2, Clock, FlaskConical, MessageSquare, MoreHorizontal, Eye } from "lucide-react";
import { toast } from "sonner";
import {
	fetchTrajectory, fetchTrajectorySignals, postTrajectorySignal,
	type Trajectory, type TrajectoryNode, type TrajectorySignal,
} from "@/api/trajectory";
import { me, type MeCycleDetail, type LoopDefinition } from "@/api/me";
import WorkflowCanvas, { type CanvasStepRef } from "@/components/workflow/WorkflowCanvas";
import RunContextMenu, { type RunMenuActions } from "@/components/workflow/RunContextMenu";
import StepInspectorPanel from "@/components/workflow/StepInspectorPanel";
import { ReviewQueue, OffersPanel, type ReviewItem, type CompoundOffer } from "@/pages/studio/inspector";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { cn } from "@/lib/utils";

// Open a cycle's session as a floating conversation in the main chatbox
// (StudioChat listens for studio:open-session and renders it with its own
// MessageBubble). ts="latest" → the running cycle.
function openSession(app: string, loop: string, ts: string) {
	window.dispatchEvent(new CustomEvent("studio:open-session", { detail: { app, loop, ts } }));
}

// Ground the Studio chatbox on a run / step / variant and (optionally) ask.
// The chat picks up the context override at send time (StudioChat studio:ask).
function askAboutRun(app: string, loop: string, ts: string | undefined, prompt: string, stepId?: string) {
	window.dispatchEvent(new CustomEvent("studio:ask", {
		detail: {
			prompt,
			autosend: true,
			// Grounded observability queries need the me_agent data tools, which
			// only fire on a tool-capable provider. Hint kvrun-minimax; the
			// backend re-checks the role (degrades to the role default — also
			// tool-capable — if the user can't use minimax) and would auto-route
			// anyway, so this is belt-and-suspenders.
			model: "kvrun-minimax",
			context: ts ? { app, loop, cycle: { app, loop, ts }, ...(stepId ? { step_id: stepId } : {}) } : { app, loop },
		},
	}));
}

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
// Run timestamp → "Jun 12, 11:20" (full ts) or "Jun 11" (day-bucketed cycle).
function fmtWhen(ts?: string): string | null {
	if (!ts) return null;
	let m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	m = ts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
		.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	return null;
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

// A node as drawn after collapsing the champion trunk: `displayParentId` may be
// several generations up (with `elided` champion-only cycles hidden between),
// and `displayDepth` is the row in the COLLAPSED tree.
type DisplayG = GNode & { displayParentId?: string; elided: number; displayDepth: number };
const KEEP_RECENT = 5;

// Collapse long champion-only stretches of the trunk so the drawn height tracks
// BRANCH structure, not raw cycle count — a long regression sweep otherwise
// renders one row per cycle, growing into a tall thread that's tiny when fit and
// unreadable. We always keep: the baseline/root, any generation that explored
// variants (branch points) and every variant, leaves, nodes needing a decision,
// queued ghosts, the focused node, and the most recent KEEP_RECENT champions.
// Each collapsed run folds into the connecting trunk edge as a "+N cycles" badge.
function buildDisplay(model: GNode[], pickedId: string | null): DisplayG[] {
	const byId = new Map(model.map((n) => [n.id, n] as const));
	const parentOf = (n: GNode) => (n.parent_id && byId.has(n.parent_id) ? n.parent_id : undefined);
	const kids = new Map<string | undefined, GNode[]>();
	for (const n of model) { const k = parentOf(n); const a = kids.get(k) || []; a.push(n); kids.set(k, a); }
	const nKids = (id: string) => (kids.get(id) || []).length;
	const recent = new Set(
		model.filter((n) => n.is_champion).sort((a, b) => a.depth - b.depth).slice(-KEEP_RECENT).map((n) => n.id),
	);
	const isSig = (n: GNode) =>
		n.proposed ||                                            // queued ghost
		!parentOf(n) ||                                          // baseline / root
		nKids(n.id) !== 1 ||                                     // branch point or leaf
		(parentOf(n) ? nKids(parentOf(n)!) !== 1 : false) ||     // first node off a branch
		!n.is_champion ||                                        // any variant always shows
		!!n.needs_decision || n.id === pickedId || recent.has(n.id);
	const sig = model.filter(isSig).sort((a, b) => a.depth - b.depth); // parents first
	const sigSet = new Set(sig.map((n) => n.id));
	const ddCache = new Map<string, number>();
	const out: DisplayG[] = [];
	for (const n of sig) {
		let p = parentOf(n), elided = 0;
		while (p && !sigSet.has(p)) { elided++; p = parentOf(byId.get(p)!); }
		const displayParentId = p && sigSet.has(p) ? p : undefined;
		const dd = displayParentId != null ? (ddCache.get(displayParentId) ?? 0) + 1 : 0;
		ddCache.set(n.id, dd);
		out.push({ ...n, displayParentId, elided, displayDepth: dd });
	}
	return out;
}

// Tidy vertical tree (Knuth post-order): leaves pack left→right into COL_X slots,
// every parent is centered over its children's span — variants never overlap and
// the champion trunk stays straight. Operates on the COLLAPSED display nodes.
function layout(nodes: DisplayG[]): Map<string, { x: number; y: number }> {
	const pos = new Map<string, { x: number; y: number }>();
	const byParent = new Map<string | undefined, DisplayG[]>();
	for (const n of nodes) { const a = byParent.get(n.displayParentId) || []; a.push(n); byParent.set(n.displayParentId, a); }
	// champion first (keeps the trunk on the left of its branch fan), then by age
	for (const arr of byParent.values())
		arr.sort((a, b) => (b.is_champion ? 1 : 0) - (a.is_champion ? 1 : 0) || a.depth - b.depth || a.id.localeCompare(b.id));
	let leaf = 0;
	const seen = new Set<string>();
	const place = (n: DisplayG): number => {
		if (seen.has(n.id)) return pos.get(n.id)?.x ?? 0;     // cycle guard
		seen.add(n.id);
		const ch = (byParent.get(n.id) || []).filter((k) => !seen.has(k.id));
		let x: number;
		if (!ch.length) { x = leaf * COL_X; leaf++; }
		else { const xs = ch.map(place); x = (xs[0] + xs[xs.length - 1]) / 2; }
		pos.set(n.id, { x, y: n.displayDepth * ROW_Y });
		return x;
	};
	(byParent.get(undefined) || []).forEach(place);
	for (const n of nodes) if (!pos.has(n.id)) { pos.set(n.id, { x: (leaf++) * COL_X, y: n.displayDepth * ROW_Y }); }
	const xs = [...pos.values()].map((p) => p.x);
	if (xs.length) { const mid = (Math.min(...xs) + Math.max(...xs)) / 2; for (const p of pos.values()) p.x -= mid; }
	return pos;
}

// LinearTrajectory — a straight champion chain (no branches) reads far better as
// a metric TREND than a tall vertical node tree: the tree forces fitView to zoom
// out for many cycles, which both buries the shape and shrinks the label text
// below the rest of the page. This renders the chain as a compact line chart +
// a wrapped row of clickable cycle chips — plain HTML/SVG, page-consistent text,
// no zoom. Same click/right-click affordances as the tree nodes.
function LinearTrajectory({ chain, metric, baseline, hib, pickedId, onFocus, onOpen, onMenu }: {
	chain: GNode[]; metric?: string | null; baseline?: number | null; hib: boolean;
	pickedId?: string; onFocus: (n: GNode) => void; onOpen: (n: GNode) => void;
	onMenu: (e: ReactMouseEvent, n: GNode) => void;
}) {
	const scored = chain.filter((n) => n.scored && typeof n.score === "number");
	const W = 1000, H = 200, padL = 12, padR = 12, padT = 14, padB = 14;
	const vals = scored.map((n) => n.score as number);
	const lo = vals.length ? Math.min(...vals, ...(baseline != null ? [baseline] : [])) : 0;
	const hi = vals.length ? Math.max(...vals, ...(baseline != null ? [baseline] : [])) : 1;
	const rng = hi - lo || 1;
	const px = (i: number) => padL + (scored.length <= 1 ? (W - padL - padR) / 2 : (i / (scored.length - 1)) * (W - padL - padR));
	const py = (v: number) => padT + (1 - (v - lo) / rng) * (H - padT - padB);
	const pts = scored.map((n, i) => `${px(i)},${py(n.score as number)}`);
	const first = scored[0], last = scored[scored.length - 1];
	return (
		<div className="h-full w-full overflow-y-auto px-3 pt-9 pb-3 flex flex-col gap-3">
			<div className="text-[11px] text-slate-500">
				Straight-line run tree · {scored.length} scored {scored.length === 1 ? "run" : "runs"}
				{metric && <> · <span className="font-mono text-slate-600">{metric}</span></>}
				{baseline != null && <> · <span title="baseline">starting point</span> <span className="tabular-nums">{fmtScore(baseline)}</span></>}
			</div>
			{scored.length >= 2 && (
				<div className="rounded-lg border border-slate-200/70 bg-white p-2 flex-shrink-0">
					<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 150 }}>
						{baseline != null && (
							<line x1={padL} x2={W - padR} y1={py(baseline)} y2={py(baseline)} stroke="rgb(148 163 184)" strokeDasharray="6 5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
						)}
						<polyline points={pts.join(" ")} fill="none" stroke="rgb(176 143 69)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
						{scored.map((n, i) => {
							const t = tone(n, baseline, hib);
							const sel = n.id === pickedId;
							return (
								<circle key={n.id} cx={px(i)} cy={py(n.score as number)} r={sel ? 6 : 4}
									fill={t.dot} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke"
									className="cursor-pointer" onClick={() => onFocus(n)}
									onContextMenu={(e) => onMenu(e, n)}>
									<title>{`${fmtWhen(n.run_ts || n.cycle_ts) || ""} · ${fmtScore(n.score as number)}`}</title>
								</circle>
							);
						})}
					</svg>
					<div className="flex justify-between text-[10px] text-slate-400 tabular-nums mt-1">
						<span>{fmtWhen(first?.run_ts || first?.cycle_ts)} · {first && fmtScore(first.score as number)}</span>
						<span>{fmtWhen(last?.run_ts || last?.cycle_ts)} · {last && fmtScore(last.score as number)}</span>
					</div>
				</div>
			)}
			{/* clickable cycle chips — page-consistent text, wraps instead of zooming */}
			<div className="flex flex-wrap gap-1.5 content-start">
				{chain.map((n) => {
					const t = tone(n, baseline, hib);
					const sel = n.id === pickedId;
					return (
						<button key={n.id} type="button"
							onClick={() => onFocus(n)}
							onDoubleClick={() => !n.proposed && onOpen(n)}
							onContextMenu={(e) => { e.preventDefault(); onMenu(e, n); }}
							title="click to focus · double-click for the pipeline · ⋯ for actions"
							className={cn(
								"inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-colors",
								sel ? "border-sky-400 ring-1 ring-sky-200 bg-sky-50/40" : "border-slate-200 bg-white hover:bg-slate-50",
							)}>
							<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.dot }} />
							<span className="text-[11px] text-slate-600 tabular-nums">{fmtWhen(n.run_ts || n.cycle_ts) || n.label}</span>
							{n.is_champion && <span title="champion — best so far"><Trophy className="w-3 h-3 text-gold-500 flex-shrink-0" /></span>}
							{n.scored && n.score != null
								? <span className="text-[11px] font-semibold tabular-nums text-slate-800">{fmtScore(n.score)}</span>
								: <span className="text-[10px] uppercase tracking-wide text-slate-400" title={n.kind === "baseline" ? "baseline" : undefined}>{n.kind === "baseline" ? "start" : "—"}</span>}
							{!n.proposed && (
								<span role="button" tabIndex={0}
									onClick={(e) => { e.stopPropagation(); onMenu(e, n); }}
									className="ml-0.5 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
									title="More actions">
									<MoreHorizontal className="w-3 h-3" />
								</span>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export interface TrajectoryVersion { cycleTs?: string; runTs?: string; label: string; ts?: string }

function Inner({ app, loop, definition, onSelectVersion, running, onShowLog, actions, selectedForCompare, onToggleCompare, mode = "improve" }: {
	app: string; loop: string; definition?: LoopDefinition | null;
	onSelectVersion?: (v: TrajectoryVersion | null) => void;
	running?: boolean;
	// Clicking a run's node/time-chip opens its within-run log (the panel
	// swaps the canvas to the transcript) — replaces the old "Run log" button.
	onShowLog?: (ts: string) => void;
	// The shared run-context menu wiring (the single trajectory tree now carries
	// every entrance: data, log, compare, promote, discard). When omitted, the
	// node menu falls back to a minimal branch-only menu.
	actions?: RunMenuActions;
	selectedForCompare?: string[];
	onToggleCompare?: (ts: string) => void;
	mode?: "observe" | "improve";
}) {
	const [traj, setTraj] = useState<Trajectory | null>(null);
	const [signals, setSignals] = useState<TrajectorySignal[]>([]);
	const [loading, setLoading] = useState(true);
	const [picked, setPicked] = useState<GNode | null>(null);
	const [view, setView] = useState<"tree" | "pipeline">("tree");
	const [cycle, setCycle] = useState<MeCycleDetail | null>(null);
	const [cycleLoading, setCycleLoading] = useState(false);
	const [menu, setMenu] = useState<{ x: number; y: number; node: GNode } | null>(null);
	const [canvasStep, setCanvasStep] = useState<CanvasStepRef | null>(null);

	// Switching workflow snaps back to the trajectory (tree) view — a pipeline
	// drilled into the old workflow's run is meaningless for the new one.
	useEffect(() => {
		setView("tree");
		setPicked(null);
		setCycle(null);
		setCanvasStep(null);
		setMenu(null);
	}, [app, loop]);

	// Load (or reload) the trajectory + signals. Reused by the mount effect
	// and the chat→page refetch bus so a run triggered elsewhere (e.g. the
	// agent's run_loop_now, or "Run now") shows up here without a manual
	// refresh — the "I started a run but the Runs tab shows nothing" fix.
	const trajSigRef = useRef("");
	const load = useCallback((withSpinner = false) => {
		if (withSpinner) setLoading(true);
		let live = true;
		Promise.all([fetchTrajectory(app, loop).catch(() => null), fetchTrajectorySignals(app, loop).catch(() => [])])
			.then(([t, s]) => {
				if (!live || !t) return;
				// Skip the rebuild + ReactFlow re-render when the tree is unchanged
				// (bus events fire on any run/cycle change, often unrelated).
				const sig = JSON.stringify({ n: t.nodes?.length, c: t.cycles?.length, last: t.nodes?.[t.nodes.length - 1]?.id, sc: t.nodes?.map((x) => x.score), sg: (s as TrajectorySignal[]).length });
				if (sig !== trajSigRef.current) { trajSigRef.current = sig; setTraj(t); setSignals(s); }
			})
			.finally(() => { if (live) setLoading(false); });
		return () => { live = false; };
	}, [app, loop]);

	useEffect(() => load(true), [load]);
	// Re-fetch when a run/cycle changes anywhere (chat tools, Run now) so the
	// trajectory reflects new + in-flight runs live.
	useStudioRefetch(["runs", "cycles", "loops", "workflows"], load);
	// When a run finishes (running true→false), reload so the just-completed
	// cycle materializes as a node (its cycle.json has now landed).
	const wasRunning = useRef(false);
	useEffect(() => {
		if (wasRunning.current && !running) load();
		wasRunning.current = !!running;
	}, [running, load]);

	const reloadSignals = useCallback(() => { fetchTrajectorySignals(app, loop).then(setSignals).catch(() => {}); }, [app, loop]);

	const { model, byId } = useMemo(() => buildModel(traj, signals), [traj, signals]);
	const hib = traj?.higher_is_better !== false;
	const baseline = traj?.baseline ?? null;

	// Set after openPipeline is defined; the node's "details" link calls it
	// (the node label is built above openPipeline, so it can't reference it
	// directly without a temporal-dead-zone error).
	const openPipelineRef = useRef<(tn: GNode) => void>(() => {});
	// WS-3 — open the run menu from a VISIBLE ⋯ button on the node (not just
	// right-click). Positioned at the click point.
	const openMenuRef = useRef<(e: ReactMouseEvent, tn: GNode) => void>(() => {});

	const { nodes, edges } = useMemo(() => {
		const display = buildDisplay(model, picked?.id ?? null);
		const shown = new Set(display.map((n) => n.id));
		const pos = layout(display);
		const nodes: Node[] = display.map((n) => {
			const t = tone(n, baseline, hib);
			const dur = fmtDur(n.duration_s);
			const when = n.proposed ? null : fmtWhen(n.run_ts || n.cycle_ts);
			const learned = n.is_champion ? (traj?.cycles || [])[n.depth - 1]?.learned || 0 : 0;
			const sel = picked?.id === n.id;
			return {
				id: n.id,
				position: pos.get(n.id) || { x: 0, y: n.displayDepth * ROW_Y },
				data: {
					label: (
						<div className="px-2.5 py-1.5 text-left" style={{ width: NODE_W }}>
							<div className="flex items-center gap-1.5">
								<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.dot }} />
								<span className={cn("text-[12px] truncate flex-1 font-medium", n.proposed ? "text-gold-700 italic" : "text-slate-800")}>{n.label}</span>
								{n.needs_decision && <span title="needs a decision — suggestions or held actions" className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 animate-pulse" />}
								{n.is_champion && <Trophy className="w-3 h-3 text-gold-500 flex-shrink-0" />}
							</div>
							{when && <div className="text-[10px] text-slate-400 tabular-nums mt-0.5 truncate">{when}</div>}
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
							{!n.proposed && (
								<div className="mt-1 flex items-center justify-end gap-1.5">
									<button
										type="button"
										onClick={(e) => { e.stopPropagation(); openPipelineRef.current(n); }}
										className="text-[10px] font-medium text-sky-600 hover:text-sky-700 hover:underline pointer-events-auto nodrag"
										title="Open this run's pipeline (step-by-step)"
									>
										details →
									</button>
									<button
										type="button"
										onClick={(e) => { e.stopPropagation(); openMenuRef.current(e, n); }}
										className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 pointer-events-auto nodrag"
										title="More actions — observe / improve this run"
									>
										<MoreHorizontal className="w-3.5 h-3.5" />
									</button>
								</div>
							)}
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
		for (const n of display) {
			if (!n.displayParentId || !shown.has(n.displayParentId)) continue;
			const parent = byId.get(n.displayParentId);
			const trunk = !!n.is_champion && (!!parent?.is_champion || parent?.kind === "baseline");
			edges.push({
				id: `e:${n.displayParentId}->${n.id}`,
				source: n.displayParentId,
				target: n.id,
				type: "smoothstep",
				animated: (trunk || !!n.proposed) && n.elided === 0,
				// A collapsed run of champion-only cycles gets a "+N cycles" badge so
				// the elided history reads without inflating the tree's height.
				label: n.elided > 0 ? `+${n.elided} cycle${n.elided > 1 ? "s" : ""}` : undefined,
				labelShowBg: n.elided > 0,
				labelBgPadding: [6, 2],
				labelBgBorderRadius: 8,
				labelStyle: { fill: "rgb(100 116 139)", fontSize: 10, fontWeight: 500 },
				labelBgStyle: { fill: "rgb(248 250 252)", stroke: "rgb(226 232 240)" },
				style: n.proposed
					? { stroke: "rgb(176 143 69)", strokeWidth: 1.5, strokeDasharray: "5 4" }
					: trunk
						? { stroke: "rgb(176 143 69)", strokeWidth: 2.5, strokeDasharray: n.elided > 0 ? "6 3" : undefined }
						: { stroke: "rgb(203 213 225)", strokeWidth: 1.5, strokeDasharray: n.scored ? undefined : "5 4" },
			});
		}
		return { nodes, edges };
	}, [model, byId, baseline, hib, picked, traj]);

	const openPipeline = useCallback((tn: GNode) => {
		setPicked(tn);
		setView("pipeline");
		setCycle(null);
		setCanvasStep(null);
		// Move the data asset (casebook) to this run's version too.
		onSelectVersion?.({ cycleTs: tn.cycle_ts, runTs: tn.run_ts, label: tn.label });
		if (tn.run_ts) {
			setCycleLoading(true);
			me.cycleDetail(app, loop, tn.run_ts).then(setCycle).catch(() => setCycle(null)).finally(() => setCycleLoading(false));
		}
	}, [app, loop, onSelectVersion]);
	openPipelineRef.current = openPipeline;
	openMenuRef.current = (e: ReactMouseEvent, tn: GNode) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node: tn }); };

	// Plain click = FOCUS this run (don't drill in): highlight the node and move
	// the data version pointer + related panels (casebook/metrics) to it. The
	// "details →" link drills into the pipeline; right-click → branch / convo.
	const focusRun = useCallback((tn: GNode) => {
		setPicked(tn);
		onSelectVersion?.({ cycleTs: tn.cycle_ts, runTs: tn.run_ts, label: tn.label });
		// Clicking a run's node/chip opens its within-run log (consolidated into
		// the trajectory view — no separate "Run log" button). Ghosts have no run.
		const ts = tn.run_ts || tn.cycle_ts;
		if (ts && !tn.proposed) onShowLog?.(ts);
	}, [onSelectVersion, onShowLog]);

	const branchFrom = useCallback(async (tn: GNode) => {
		setMenu(null);
		// Optimistic: show the ghost node instantly (no reload). Dedupe so
		// repeat clicks on the same node don't stack ghosts.
		setSignals((prev) => prev.some((s) => s.action === "branch" && (s.status ?? "pending") === "pending" && s.from_id === tn.id)
			? prev
			: [...prev, { action: "branch", loop, from_id: tn.id, from_variant_id: tn.variant_id, config: tn.config, status: "pending" }]);
		try {
			await postTrajectorySignal(app, { loop, action: "branch", from_id: tn.id, from_variant_id: tn.variant_id, config: tn.config });
			toast.success("Branch queued — the loop will explore from here next cycle.");
			reloadSignals();
		} catch {
			toast.error("Could not queue the branch.");
			reloadSignals(); // reconcile: drop the optimistic ghost if the post failed
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
				{running ? (
					<>
						<Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
						<div className="text-sm text-slate-600">First run in progress…</div>
						<div className="text-xs text-slate-400 max-w-xs">It’ll appear here as a node when it finishes.</div>
					</>
				) : (<>
				<GitBranch className="w-6 h-6 text-slate-300" />
				<div className="text-sm text-slate-500">No run trajectory yet.</div>
				<div className="text-xs text-slate-400 max-w-xs">Each run becomes a node here — and when this workflow explores variants, they branch into a tree with the best-so-far on the trunk.</div>
				</>)}
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
						{mode === "observe" ? (
							<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-600 uppercase tracking-wide" title="watch runs — read-only"><Eye className="w-3.5 h-3.5" /> Watching</span>
						) : (
							<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gold-600 uppercase tracking-wide" title="experiment — branch, compare, promote, discard"><FlaskConical className="w-3.5 h-3.5" /> Experiment</span>
						)}
						<span className="text-[10px] text-slate-300 normal-case tracking-normal">· {mode === "observe" ? "Run history" : "Run tree"}</span>
						<span className="ml-auto text-[10px] text-slate-300 normal-case tracking-normal">{mode === "observe" ? "click a run to read its log · ⋯ for stages & metrics" : "⋯ a run to branch · compare · promote · discard"}</span>
					</div>

					{/* ONE run view for both modes — the runs (time · score per node)
					    appear exactly once. The mode changes interaction, not the data:
					    Observe → click a node to read its log; Improve → adds the
					    experiment affordances (⋯ branch/compare/promote, compare-select,
					    the best/baseline rollup below). No duplicate list. */}
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
						onNodeClick={(_e, node) => {
							const tn = byId.get(node.id);
							if (!tn || tn.proposed) return;
							// Observe = read: a click opens the run's log. Improve = focus
							// the node for experiment ops.
							if (mode === "observe") onShowLog?.(tn.run_ts || tn.cycle_ts || "");
							else focusRun(tn);
						}}
						onNodeContextMenu={(e, node) => { e.preventDefault(); const tn = byId.get(node.id); if (tn) setMenu({ x: e.clientX, y: e.clientY, node: tn }); }}
					>
						<Background gap={16} color="rgb(241 245 249)" />
						<Controls showInteractive={false} />
					</ReactFlow>

					{/* stats rollup — experiment-flavored (variants/best/baseline), so
					    show it only in Improve; Observe stays a clean read surface. */}
					{mode !== "observe" && ((traj.has_variants && traj.metric) || champ?.score != null || totalLearned > 0) && (
						<div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-3 py-2 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none">
							{traj.has_variants && traj.metric && (
								<span className="text-[11px] text-slate-400">{traj.nodes.length} variants · <span className="font-mono text-slate-600">{traj.metric}</span>{traj.baseline != null && <> · base <span className="tabular-nums">{fmtScore(traj.baseline)}</span></>}</span>
							)}
							{champ?.score != null && (
								<span className="inline-flex items-center gap-1 text-[11px] text-gold-700"><Trophy className="w-3 h-3" /> best <span className="tabular-nums font-medium">{fmtScore(champ.score)}</span>{champ.delta_vs_baseline != null && Math.abs(champ.delta_vs_baseline) > 1e-6 && <span className="tabular-nums">({champ.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(champ.delta_vs_baseline)})</span>}</span>
							)}
							{totalLearned > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-gold-600"><Sparkles className="w-3 h-3" /> {totalLearned} learned</span>}
						</div>
					)}

					{menu && createPortal(
						(menu.node.proposed || !actions || !(menu.node.run_ts || menu.node.cycle_ts)) ? (
							// Ghost/proposed node (or no shared-menu wiring): a minimal menu
							// — branching a ghost materializes it (bespoke branchFrom).
							<div className="fixed z-[80] min-w-[180px] rounded-lg border border-slate-200 bg-white shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
								<div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 truncate">{menu.node.label}</div>
								{!menu.node.proposed && (
									<button onClick={() => openPipeline(menu.node)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 text-left"><FlaskConical className="w-3.5 h-3.5 text-slate-400" /> Open pipeline</button>
								)}
								<button onClick={() => branchFrom(menu.node)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-gold-700 hover:bg-gold-50 text-left"><GitBranch className="w-3.5 h-3.5 text-gold-500" /> Branch out</button>
							</div>
						) : (
							// Real run node: the SINGLE shared menu — Trajectory's own items
							// (pipeline/conversation/ask) folded in alongside the restored
							// data/log/compare/promote/discard entrances.
							<RunContextMenu
								x={menu.x} y={menu.y}
								target={{ kind: "run", ts: menu.node.run_ts || menu.node.cycle_ts, label: menu.node.label }}
								actions={{
									...actions,
									app, loop,
									openPipeline: () => { openPipeline(menu.node); },
									viewConversation: (ts) => { openSession(app, loop, ts); },
									ask: () => { askAboutRun(app, loop, menu.node.run_ts, `About this run (${menu.node.label})${menu.node.config ? ` with config ${JSON.stringify(menu.node.config)}` : ""}: what happened, and what would improve the goal?`); },
								}}
								selectedForCompare={selectedForCompare || []}
								onToggleCompare={onToggleCompare || (() => {})}
								mode={mode}
								onClose={() => setMenu(null)}
								onAfterRuntimeOp={load}
							/>
						),
						document.body,
					)}
				</div>

				{/* ── PANE 2 · the selected run's pipeline ── */}
				<div className="w-1/2 h-full flex flex-col bg-white">
					<div className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-100">
						<button onClick={() => { setView("tree"); setCanvasStep(null); }} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Run tree</button>
						{picked && (
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									{picked.is_champion && <Trophy className="w-3.5 h-3.5 text-gold-500" />}
									<span className="text-sm font-medium text-slate-900 truncate flex-1">{picked.label}</span>
									<button
										onClick={() => askAboutRun(app, loop, picked.run_ts, `About this run (${picked.label})${picked.config ? ` with config ${JSON.stringify(picked.config)}` : ""}: what happened, and what would improve the goal?`)}
										title="Ask the assistant about this run"
										className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gold-700 bg-gold-50 border border-gold-200 rounded-full px-2 py-0.5 hover:bg-gold-100 transition-colors"
									><MessageSquare className="w-3 h-3" /> Ask</button>
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
					{/* Decisions — the advisor's suggestions + held actions for this
					    run. Suggestions (kind=improvement) get Branch/Ask; held
					    items get Approve/Reject; other offers Adopt/Dismiss. */}
					{(() => {
						const sum = (cycle?.summary || {}) as Record<string, unknown>;
						const rq = (Array.isArray(sum.review_queue) ? sum.review_queue : []) as ReviewItem[];
						const allOffers = (Array.isArray(sum.offers) ? sum.offers : []) as CompoundOffer[];
						const sugg = allOffers.filter((o) => (o as { kind?: string }).kind === "improvement");
						const other = allOffers.filter((o) => (o as { kind?: string }).kind !== "improvement");
						if (!rq.length && !allOffers.length) return null;
						return (
							<div className="px-3 py-2 border-b border-slate-100 space-y-2 max-h-[42%] overflow-y-auto">
								{sugg.length > 0 && (
									<div className="rounded-lg border border-gold-200 bg-gold-50/40 p-2 space-y-1.5">
										<div className="text-[10px] uppercase tracking-wide text-gold-700 font-semibold flex items-center gap-1"><Sparkles className="w-3 h-3" /> Advisor suggestions</div>
										{sugg.map((s, i) => {
											const o = s as { title?: string; detail?: string };
											return (
												<div key={i} className="text-[11.5px]">
													<div className="text-slate-800 font-medium">{o.title}</div>
													{o.detail && <div className="text-slate-500 leading-snug">{o.detail}</div>}
													<div className="mt-0.5 flex gap-2">
														<button onClick={() => branchFrom(picked!)} className="inline-flex items-center gap-1 text-[10.5px] text-gold-700 hover:text-gold-900"><GitBranch className="w-3 h-3" /> Branch this</button>
														<button onClick={() => askAboutRun(app, loop, picked?.run_ts, `The advisor suggested: "${o.title}". ${o.detail || ""} How do I act on this to move the goal?`)} className="inline-flex items-center gap-1 text-[10.5px] text-gold-700 hover:text-gold-900"><MessageSquare className="w-3 h-3" /> Ask</button>
													</div>
												</div>
											);
										})}
									</div>
								)}
								{rq.length > 0 && picked?.run_ts && (
									<ReviewQueue app={app} loop={loop} ts={picked.run_ts} items={rq} onActed={() => picked && openPipeline(picked)} />
								)}
								{other.length > 0 && (
									<OffersPanel offers={other} app={app} loop={loop} ts={picked?.run_ts} />
								)}
							</div>
						);
					})()}
					<div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
						{cycleLoading ? (
							<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading run…</div>
						) : definition ? (
							view === "pipeline" ? (
								<>
									<div className="flex-1 min-h-0">
										<WorkflowCanvas definition={definition} cycle={cycle} height="100%" onStepSelect={(ref) => setCanvasStep(ref)} />
									</div>
									{/* Click a step → its intermediate I/O in-place (the light peek);
									    the "ask" hands off to chat for anything deeper. */}
									{canvasStep && (
										<div className="shrink-0 max-h-[45%] overflow-y-auto">
											<StepInspectorPanel
												step={canvasStep} app={app} loop={loop} ts={picked?.run_ts || undefined}
												onClose={() => setCanvasStep(null)}
											/>
											<button
												onClick={() => askAboutRun(app, loop, picked?.run_ts, `In this run, the step "${canvasStep.step_id}"${canvasStep.skill ? ` (skill ${canvasStep.skill})` : ""}: explain its input/output and whether it helped the goal.`, canvasStep.step_id)}
												className="mt-1 inline-flex items-center gap-1 text-[11px] text-gold-700 hover:text-gold-900"
											><MessageSquare className="w-3 h-3" /> Ask about this step</button>
										</div>
									)}
								</>
							) : null
						) : (
							<div className="h-full flex items-center justify-center text-xs text-slate-400">No pipeline declared.</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export default function TrajectoryGraph({ app, loop, definition, onSelectVersion, running, onShowLog, actions, selectedForCompare, onToggleCompare, mode = "improve" }: {
	app: string; loop: string; definition?: LoopDefinition | null;
	onSelectVersion?: (v: TrajectoryVersion | null) => void;
	running?: boolean;
	onShowLog?: (ts: string) => void;
	actions?: RunMenuActions;
	selectedForCompare?: string[];
	onToggleCompare?: (ts: string) => void;
	/** observe = read-only watching (no branch/compare/promote); improve = experiment. */
	mode?: "observe" | "improve";
}) {
	// No shared ReactFlowProvider: the trajectory <ReactFlow> and the pipeline
	// pane's WorkflowCanvas <ReactFlow> must each own an isolated store —
	// otherwise interacting with the pipeline clobbers the trajectory's nodes
	// (and the tree vanishes on return). Each bare <ReactFlow> self-stores.
	return <Inner app={app} loop={loop} definition={definition} onSelectVersion={onSelectVersion} running={running} onShowLog={onShowLog} actions={actions} selectedForCompare={selectedForCompare} onToggleCompare={onToggleCompare} mode={mode} />;
}

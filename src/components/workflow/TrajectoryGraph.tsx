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

import { useMemo, useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
	ReactFlow, Background, Controls, Position,
	BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath,
	type Node, type Edge, type EdgeProps, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch, Trophy, Sparkles, Loader2, FlaskConical, MessageSquare, MoreHorizontal, Eye, ChevronDown, ChevronUp } from "lucide-react";
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

const NODE_W = 132;
const NODE_H = 44;
const ROW_Y = 66;  // vertical gap between depths (cycles)
const COL_X = 146; // horizontal gap between sibling variants
const SNAKE_ROW_Y = 66;  // vertical gap between snake rows (compact nodes)
const SNAKE_MIN = 9;     // chain length past which a LINEAR tree wraps into a snake

type GNode = TrajectoryNode & { proposed?: boolean; note?: string };

function fmtScore(v?: number): string {
	if (v == null) return "—";
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
}
// Run timestamp → "Jun 12, 23:20" (full ts, 24h) or "Jun 11" (day-bucketed).
function fmtWhen(ts?: string): string | null {
	if (!ts) return null;
	let m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
	m = ts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
		.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	return null;
}

// A meaningful menu/header label for a node — its version (+ model), falling
// back to the run date, then the raw label. Avoids surfacing the backend's
// placeholder "variant" label in the context menu / prompts.
function menuNodeLabel(n: GNode): string {
	if (n.proposed) return n.label;
	if (n.agent_version) return n.model ? `${n.agent_version} · ${n.model}` : n.agent_version;
	if (n.label && n.label !== "variant") return n.label;
	return fmtWhen(n.run_ts || n.cycle_ts) || "run";
}

// Node boxes share a UNIFORM neutral border so the tree reads calmly — the
// trend (better/worse vs baseline) lives in the colored status DOT + the
// signed delta text inside each node (and the header version dots), not in a
// sea of red/gold borders. `border` here is the box outline; `dot` is the trend.
const _UNIFORM_BORDER = "rgb(203 213 225)"; // slate-300 — same for every node
function tone(n: GNode, baseline: number | null | undefined, hib: boolean) {
	if (n.proposed) return { border: "rgb(176 143 69)", dot: "rgb(176 143 69)", dashed: true };
	if (n.kind === "baseline") return { border: _UNIFORM_BORDER, dot: "rgb(100 116 139)", dashed: false };
	if (!n.scored || n.score == null) return { border: _UNIFORM_BORDER, dot: "rgb(203 213 225)", dashed: true };
	const d =
		n.delta_vs_baseline != null ? n.delta_vs_baseline
			: baseline != null ? (hib ? n.score - baseline : baseline - n.score) : 0;
	// Uniform border for every scored node; the DOT carries the trend.
	if (d > 1e-6) return { border: _UNIFORM_BORDER, dot: "rgb(176 143 69)", dashed: false };
	if (d < -1e-6) return { border: _UNIFORM_BORDER, dot: "rgb(225 29 72)", dashed: false };
	return { border: _UNIFORM_BORDER, dot: "rgb(148 163 184)", dashed: false };
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
function buildDisplay(model: GNode[], pickedId: string | null, expanded: Set<string>): DisplayG[] {
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
	const sigSet = new Set(model.filter(isSig).map((n) => n.id));
	// Expanded "+N cycles" badges: reveal the elided champion-only cycles between
	// an expanded anchor and its display parent by promoting them to significant.
	for (const anchor of expanded) {
		if (!sigSet.has(anchor)) continue;
		let p = parentOf(byId.get(anchor)!);
		while (p && !sigSet.has(p)) { sigSet.add(p); p = parentOf(byId.get(p)!); }
	}
	const sig = model.filter((n) => sigSet.has(n.id)).sort((a, b) => a.depth - b.depth); // parents first
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

// A trunk edge that hides a run of champion-only cycles. Renders the path plus a
// clickable pill — "+N cycles" to expand the hidden runs, "collapse" to fold them
// back. The pill is the ONLY interactive bit (nodrag/nopan + pointerEvents).
type CollapsibleEdgeData = {
	elided?: number;
	collapsed?: boolean;       // true = "+N cycles" (expand); false = "collapse"
	anchorId?: string;
	snake?: boolean;
	onToggle?: (id: string) => void;
};
function CollapsibleEdge(props: EdgeProps) {
	const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style } = props;
	const d = (props.data || {}) as CollapsibleEdgeData;
	const [path, labelX, labelY] = d.snake
		? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
		: getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
	const n = d.elided || 0;
	return (
		<>
			<BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={style} />
			<EdgeLabelRenderer>
				<button
					type="button"
					className="nodrag nopan inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium bg-white text-slate-500 border-slate-200 hover:border-gold-300 hover:text-gold-700 shadow-sm transition-colors"
					style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
					title={d.collapsed ? "Show the hidden cycles" : "Hide these cycles again"}
					onClick={(e) => { e.stopPropagation(); if (d.anchorId) d.onToggle?.(d.anchorId); }}
				>
					{d.collapsed
						? <><ChevronDown className="w-2.5 h-2.5" />+{n} cycle{n > 1 ? "s" : ""}</>
						: <><ChevronUp className="w-2.5 h-2.5" />collapse</>}
				</button>
			</EdgeLabelRenderer>
		</>
	);
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

// snakeLayout — when the display is a SINGLE linear chain (no forks) longer than
// SNAKE_MIN, lay it out as a boustrophedon "snake": fill a row left→right, drop
// to the next row, fill it right→left, and so on. A long history then reads as a
// compact wrapped grid instead of one very tall column. Returns null when the
// tree isn't linear (any fork) — the caller falls back to the vertical tree.
// Also returns per-node source/target handle sides so edges flow along the snake
// (horizontal within a row, vertical at the turns).
function snakeLayout(nodes: DisplayG[]): {
	pos: Map<string, { x: number; y: number }>;
	srcPos: Map<string, Position>;
	tgtPos: Map<string, Position>;
} | null {
	if (nodes.length <= SNAKE_MIN) return null;
	const byParent = new Map<string | undefined, DisplayG[]>();
	for (const n of nodes) { const a = byParent.get(n.displayParentId) || []; a.push(n); byParent.set(n.displayParentId, a); }
	const roots = byParent.get(undefined) || [];
	if (roots.length !== 1) return null;          // need a single root
	for (const [, arr] of byParent) if (arr.length > 1) return null; // any fork → not linear
	// walk the chain root→leaf
	const order: DisplayG[] = [];
	const seen = new Set<string>();
	let cur: DisplayG | undefined = roots[0];
	while (cur && !seen.has(cur.id)) { seen.add(cur.id); order.push(cur); cur = (byParent.get(cur.id) || [])[0]; }
	if (order.length !== nodes.length) return null; // disconnected → bail
	// Aim for a squarish grid (was *1.7 = wide-and-short, which fitView could only
	// shrink to fit width, leaving the nodes tiny). A narrower/taller snake lets
	// fitView zoom in and fill the canvas, so the nodes read larger.
	const cols = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(order.length))));
	const pos = new Map<string, { x: number; y: number }>();
	const srcPos = new Map<string, Position>();
	const tgtPos = new Map<string, Position>();
	order.forEach((n, k) => {
		const row = Math.floor(k / cols);
		const ltr = row % 2 === 0;
		const col = ltr ? k % cols : cols - 1 - (k % cols);
		pos.set(n.id, { x: col * COL_X, y: row * SNAKE_ROW_Y });
	});
	order.forEach((n, k) => {
		const row = Math.floor(k / cols), ltr = row % 2 === 0;
		if (k < order.length - 1) // outgoing handle → next node
			srcPos.set(n.id, Math.floor((k + 1) / cols) !== row ? Position.Bottom : ltr ? Position.Right : Position.Left);
		if (k > 0)               // incoming handle ← prev node
			tgtPos.set(n.id, Math.floor((k - 1) / cols) !== row ? Position.Top : ltr ? Position.Left : Position.Right);
	});
	return { pos, srcPos, tgtPos };
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

export interface TrajectoryVersion { cycleTs?: string; runTs?: string; label: string; ts?: string; agentVersion?: string; dataVersion?: string; metric?: string; score?: number }

function Inner({ app, loop, definition, onSelectVersion, running, onShowLog, actions, selectedForCompare, onToggleCompare, mode = "improve", headerRight }: {
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
	/** Rendered at the right of the "Run tree" header (e.g. the run-state chip). */
	headerRight?: ReactNode;
}) {
	const [traj, setTraj] = useState<Trajectory | null>(null);
	const [signals, setSignals] = useState<TrajectorySignal[]>([]);
	const [loading, setLoading] = useState(true);
	// Which "+N cycles" badges are expanded (keyed by the anchor node id).
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const toggleExpand = useCallback((id: string) => setExpanded((s) => {
		const next = new Set(s);
		if (next.has(id)) next.delete(id); else next.add(id);
		return next;
	}), []);
	const edgeTypes = useMemo(() => ({ collapsible: CollapsibleEdge }), []);
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
		const display = buildDisplay(model, picked?.id ?? null, expanded);
		const shown = new Set(display.map((n) => n.id));
		// A long, fork-free chain wraps into a snake; otherwise the vertical tree.
		const snake = snakeLayout(display);
		const pos = snake ? snake.pos : layout(display);
		// The trophy + gold lineage mark the GENUINE best run — the single
		// best-scoring node. (The backend flags every cycle's best variant as
		// "champion", but with one variant per cycle that's every node — meaningless.)
		let bestId: string | null = null, bestScore = 0;
		for (const d of display) {
			if (d.proposed || d.kind === "baseline" || !d.scored || d.score == null) continue;
			if (bestId === null || (hib ? d.score > bestScore : d.score < bestScore)) { bestId = d.id; bestScore = d.score; }
		}
		// the path root→best is the trunk (gold); the rest of the tree stays neutral.
		const displayById = new Map(display.map((d) => [d.id, d] as const));
		const trunkSet = new Set<string>();
		for (let c = bestId ? displayById.get(bestId) : undefined; c; c = c.displayParentId ? displayById.get(c.displayParentId) : undefined) trunkSet.add(c.id);
		const nodes: Node[] = display.map((n) => {
			const t = tone(n, baseline, hib);
			const when = n.proposed ? null : fmtWhen(n.run_ts || n.cycle_ts);
			const learned = n.learned ?? 0;
			const sel = picked?.id === n.id;
			const isBase = n.kind === "baseline";
			const isBest = n.id === bestId;
			// Delta is vs the PREVIOUS version (this run's parent), not the fixed
			// baseline — so it reads as the step-by-step gain/loss along the branch.
			const parentNode = !isBase && n.parent_id ? byId.get(n.parent_id) : undefined;
			const dParent = (!n.proposed && n.scored && n.score != null && parentNode?.scored && parentNode.score != null)
				? (hib ? n.score - parentNode.score : parentNode.score - n.score) : null;
			// The node's headline is its VERSION in the agent's history (the run tree
			// is that history). A ghost shows its queued label; baseline says so.
			const primary = n.proposed ? n.label : isBase ? "baseline" : (n.agent_version || "run");
			// Only surface a config descriptor when it's actually informative (the
			// backend emits "variant" for an empty config — not worth showing).
			const configLabel = !n.proposed && !isBase && n.label && n.label !== "variant" ? n.label : null;
			return {
				id: n.id,
				position: pos.get(n.id) || { x: 0, y: n.displayDepth * ROW_Y },
				data: {
					label: (
						<div className="group relative px-2 py-1 text-left w-full h-full flex flex-col justify-center overflow-hidden">
							<div className="flex items-center gap-1">
								<span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: t.dot }} />
								<span className={cn("text-[11px] font-semibold flex-shrink-0 leading-none", n.proposed ? "text-gold-700 italic" : isBase ? "text-slate-500" : "text-slate-800")}
									title={isBase ? "starting point — the score before any run" : `version ${primary} — this run's place in the agent's history`}>{primary}</span>
								{/* data version (e.g. v0.7.6) is omitted on the node — constant across runs; shown in the drill-in header + Data panel. */}
								<span className="flex-1" />
								{n.needs_decision && <span title="needs a decision — suggestions or held actions" className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 animate-pulse" />}
								{isBest && <span title="best run — highest score in this tree"><Trophy className="w-2.5 h-2.5 text-gold-500 flex-shrink-0" /></span>}
								<span className="flex-1" />
								{n.model && <span title={`model — the LLM this run used (${n.model})`} className="flex-shrink-0 text-[8px] uppercase tracking-wide rounded px-1 border text-violet-700 bg-violet-50 border-violet-200 leading-[1.6]">{n.model}</span>}
							</div>
							<div className="flex items-center gap-1.5 mt-1 text-[10px] leading-none">
								{configLabel && <span className="text-slate-500 truncate max-w-[54px]" title={configLabel}>{configLabel}</span>}
								{when && <span className="text-slate-400 tabular-nums">{when}</span>}
								{n.proposed ? (
									<span className="text-[10px] uppercase tracking-wide text-gold-500">queued</span>
								) : n.scored && n.score != null ? (
									<span className="tabular-nums text-slate-700 font-medium" title={`${traj?.metric || "score"} = ${fmtScore(n.score)} — this run's metric on the dataset`}>{fmtScore(n.score)}</span>
								) : !isBase ? (
									<span className="uppercase tracking-wide text-slate-400">not scored</span>
								) : (
									<span className="uppercase tracking-wide text-slate-400">start</span>
								)}
								{dParent != null && Math.abs(dParent) > 1e-6 && (
									<span title="change vs the previous version (parent run)" className={cn("tabular-nums", dParent > 0 ? "text-gold-600" : "text-rose-500")}>
										{dParent > 0 ? "+" : ""}{fmtScore(dParent)}
									</span>
								)}
								{/* runtime (e.g. 4m43s) removed — not a tracked metric. */}
								{learned > 0 && (
									<span className="ml-auto inline-flex items-center gap-0.5 text-gold-600" title={`${learned} memories banked this run`}>
										<Sparkles className="w-2.5 h-2.5" />{learned}
									</span>
								)}
							</div>
							{!n.proposed && (
								<div className="absolute bottom-0.5 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 rounded shadow-sm px-0.5 pointer-events-auto">
									<button
										type="button"
										onClick={(e) => { e.stopPropagation(); openPipelineRef.current(n); }}
										className="inline-flex items-center p-0.5 text-sky-600 hover:text-sky-700 pointer-events-auto nodrag"
										title="Open this run's pipeline (step-by-step)"
									>
										<Eye className="w-3 h-3" />
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
				sourcePosition: snake ? (snake.srcPos.get(n.id) ?? Position.Bottom) : Position.Bottom,
				targetPosition: snake ? (snake.tgtPos.get(n.id) ?? Position.Top) : Position.Top,
				style: {
					background: n.proposed ? "rgb(254 252 245)" : "white",
					border: `1.5px ${t.dashed ? "dashed" : "solid"} ${t.border}`,
					borderRadius: 12,
					padding: 0,
					// FIXED width AND height so every node is the same box regardless of
					// content (model chip / config label / learned badge / baseline).
					width: NODE_W,
					height: NODE_H,
					boxSizing: "border-box",
					overflow: "hidden",
					boxShadow: isBest
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
			const trunk = trunkSet.has(n.id) && trunkSet.has(n.displayParentId);
			// A trunk edge hides cycles (elided>0 → "+N cycles" expand pill) OR is an
			// already-expanded anchor (→ "collapse" pill). Either gets the custom
			// interactive edge; everything else is a plain edge.
			const collapsible = n.elided > 0 || expanded.has(n.id);
			edges.push({
				id: `e:${n.displayParentId}->${n.id}`,
				source: n.displayParentId,
				target: n.id,
				// Bezier curves for the branched tree (diagonal forks read cleanly);
				// smoothstep only for the snake grid, where right-angles fit the rows.
				type: collapsible ? "collapsible" : snake ? "smoothstep" : "default",
				animated: (trunk || !!n.proposed) && n.elided === 0,
				data: collapsible
					? { elided: n.elided, collapsed: n.elided > 0, anchorId: n.id, snake: !!snake, onToggle: toggleExpand }
					: undefined,
				style: n.proposed
					? { stroke: "rgb(176 143 69)", strokeWidth: 1.5, strokeDasharray: "5 4" }
					: trunk
						? { stroke: "rgb(176 143 69)", strokeWidth: 2.5, strokeDasharray: n.elided > 0 ? "6 3" : undefined }
						: { stroke: "rgb(203 213 225)", strokeWidth: 1.5, strokeDasharray: n.scored ? undefined : "5 4" },
			});
		}
		return { nodes, edges };
	}, [model, byId, baseline, hib, picked, traj, expanded, toggleExpand]);

	const openPipeline = useCallback((tn: GNode) => {
		setPicked(tn);
		setView("pipeline");
		setCycle(null);
		setCanvasStep(null);
		// Move the data asset (casebook) to this run's version too.
		onSelectVersion?.({ cycleTs: tn.cycle_ts, runTs: tn.run_ts, label: tn.label, agentVersion: tn.agent_version, dataVersion: tn.data_version, metric: traj?.metric, score: tn.score });
		if (tn.run_ts) {
			setCycleLoading(true);
			me.cycleDetail(app, loop, tn.run_ts).then(setCycle).catch(() => setCycle(null)).finally(() => setCycleLoading(false));
		}
	}, [app, loop, onSelectVersion]);
	openPipelineRef.current = openPipeline;
	openMenuRef.current = (e: ReactMouseEvent, tn: GNode) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node: tn }); };

	// Plain click = FOCUS this run: highlight the node and LINK the left
	// Data/Agents panels to this run's versions (metric+score, data version,
	// agent version) by pinning it — staying on the tree. We deliberately do NOT
	// open the log here: onShowLog pushes a stack frame whose version carries no
	// metric/score, which would OVERRIDE the pinned version and make the left
	// metric card vanish. The run log/pipeline open explicitly via the node's
	// hover actions (details → pipeline) and ⋯ menu (View run log).
	const focusRun = useCallback((tn: GNode) => {
		setPicked(tn);
		onSelectVersion?.({ cycleTs: tn.cycle_ts, runTs: tn.run_ts, label: tn.label, agentVersion: tn.agent_version, dataVersion: tn.data_version, metric: traj?.metric, score: tn.score });
	}, [onSelectVersion, traj]);

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
		// Fit the whole tree to the canvas and CENTER it. Double-rAF so ReactFlow
		// has measured node sizes before fitView computes bounds (a single frame
		// runs pre-measure → wrong bounds → the tree lands low with dead space
		// above). maxZoom 1.75 lets a small/compact trajectory zoom IN to fill the
		// canvas instead of floating tiny in the middle.
		requestAnimationFrame(() => requestAnimationFrame(() => {
			inst.fitView({ padding: 0.1, maxZoom: 1.75, minZoom: 0.3 });
		}));
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
				<div className="text-xs text-slate-400 max-w-xs">Each run becomes a node here — and when this workflow explores experiments, they branch into a tree with the best-so-far on the trunk.</div>
				</>)}
			</div>
		);

	const totalLearned = (traj.cycles || []).reduce((n, c) => n + (c.learned || 0), 0);
	const champ = (traj.nodes || []).filter((n) => n.kind !== "baseline" && n.scored && n.score != null)
		.sort((a, b) => (hib ? (b.score as number) - (a.score as number) : (a.score as number) - (b.score as number)))[0];


	return (
		<div className="relative h-full rounded-xl border border-slate-200 bg-white overflow-hidden">
			<div
				className="flex h-full w-[200%]"
				style={{ transform: view === "pipeline" ? "translateX(-50%)" : "translateX(0)", transition: "transform .55s cubic-bezier(0.22,1,0.36,1)" }}
			>
				{/* ── PANE 1 · the trajectory tree ── */}
				<div className="w-1/2 h-full relative">
					{/* header rollup — trend + learning, at a glance */}
					<div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-white via-white/90 to-transparent pointer-events-none">
						<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex-shrink-0" title="branching tree of experiments"><GitBranch className="w-3.5 h-3.5 text-gold-500" /> Run tree</span>
						<span className="text-[10px] text-slate-300 normal-case tracking-normal truncate hidden xl:inline">click a run to link the panels · ⋯ for log, branch, compare</span>
						{headerRight && <div className="ml-auto flex-shrink-0 pointer-events-auto">{headerRight}</div>}
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
						edgeTypes={edgeTypes}
						onInit={onInit}
						fitView={false}
						proOptions={{ hideAttribution: true }}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable
						zoomOnScroll
						zoomOnPinch
						minZoom={0.2}
						maxZoom={2}
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
						<div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-end gap-3 px-3 py-2 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none">
							{traj.has_variants && traj.metric && (
								<span className="text-[11px] text-slate-400">{traj.nodes.filter((n) => n.kind !== "baseline").length} runs · <span className="font-mono text-slate-600">{traj.metric}</span>{traj.baseline != null && <> · start <span className="tabular-nums">{fmtScore(traj.baseline)}</span></>}</span>
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
								<div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 truncate">{menuNodeLabel(menu.node)}</div>
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
								target={{ kind: "run", ts: menu.node.run_ts || menu.node.cycle_ts, label: menuNodeLabel(menu.node) }}
								actions={{
									...actions,
									app, loop,
									openPipeline: () => { openPipeline(menu.node); },
									ask: () => { askAboutRun(app, loop, menu.node.run_ts, `About this run (${menuNodeLabel(menu.node)})${menu.node.config ? ` with config ${JSON.stringify(menu.node.config)}` : ""}: what happened, and what would improve the goal?`); },
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
									{champ && picked.id === champ.id && <Trophy className="w-3.5 h-3.5 text-gold-500" />}
									<span className="text-sm font-medium text-slate-900 flex-shrink-0" title="this run's version in the agent's history">{picked.agent_version || picked.label}</span>
									{picked.model && <span title={`model — ${picked.model}`} className="flex-shrink-0 text-[9px] uppercase tracking-wide rounded-full px-1.5 py-0.5 border text-violet-700 bg-violet-50 border-violet-200">{picked.model}</span>}
									{picked.data_version && <span title="dataset version this run was evaluated on" className="flex-shrink-0 text-[9px] font-mono rounded-full px-1.5 py-0.5 border text-sky-700 bg-sky-50 border-sky-200">{picked.data_version}</span>}
									<span className="flex-1" />
									<button
										onClick={() => askAboutRun(app, loop, picked.run_ts, `About this run (${picked.label})${picked.config ? ` with config ${JSON.stringify(picked.config)}` : ""}: what happened, and what would improve the goal?`)}
										title="Ask the assistant about this run"
										className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gold-700 bg-gold-50 border border-gold-200 rounded-full px-2 py-0.5 hover:bg-gold-100 transition-colors"
									><MessageSquare className="w-3 h-3" /> Ask</button>
								</div>
								<div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
									{picked.scored && picked.score != null && <span className="tabular-nums">{traj.metric || "score"}: <span className="text-slate-700 font-medium">{fmtScore(picked.score)}</span></span>}
									{picked.delta_vs_baseline != null && Math.abs(picked.delta_vs_baseline) > 1e-6 && <span className={cn("tabular-nums", picked.delta_vs_baseline > 0 ? "text-gold-600" : "text-rose-500")}>{picked.delta_vs_baseline > 0 ? "+" : ""}{fmtScore(picked.delta_vs_baseline)} vs base</span>}
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

export default function TrajectoryGraph({ app, loop, definition, onSelectVersion, running, onShowLog, actions, selectedForCompare, onToggleCompare, mode = "improve", headerRight }: {
	app: string; loop: string; definition?: LoopDefinition | null;
	onSelectVersion?: (v: TrajectoryVersion | null) => void;
	running?: boolean;
	onShowLog?: (ts: string) => void;
	actions?: RunMenuActions;
	selectedForCompare?: string[];
	onToggleCompare?: (ts: string) => void;
	/** observe = read-only watching (no branch/compare/promote); improve = experiment. */
	mode?: "observe" | "improve";
	headerRight?: ReactNode;
}) {
	// No shared ReactFlowProvider: the trajectory <ReactFlow> and the pipeline
	// pane's WorkflowCanvas <ReactFlow> must each own an isolated store —
	// otherwise interacting with the pipeline clobbers the trajectory's nodes
	// (and the tree vanishes on return). Each bare <ReactFlow> self-stores.
	return <Inner app={app} loop={loop} definition={definition} onSelectVersion={onSelectVersion} running={running} onShowLog={onShowLog} actions={actions} selectedForCompare={selectedForCompare} onToggleCompare={onToggleCompare} mode={mode} headerRight={headerRight} />;
}

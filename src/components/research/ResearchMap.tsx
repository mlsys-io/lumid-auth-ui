// ResearchMap — the app home's answer to "what is this app exploring, what
// came from what, and what should it try next?"
//
//   [Quant Research] ── KOL alpha ─────── Current version · Musk v1 · Musk LLM scored
//                    ├─ Backtest evidence ─ Current version · Tape covered
//                    └┄ Suggested: Symbol over signal            (dashed)
//   For your approval 1/4 · Try … · Cost ~40 runs · Done when … [Not now] [Go ahead]
//
// Novix's look (the tree grows on first view; clicking a card lights its path
// with moving dashes, dims the rest, and moves the camera), Lumid's clarity
// (readable cards with a status in words, no modes, no counters). Logic and
// wording live in lib/research-map.ts. Phones get a list — a zoomed-out map
// at 390px is unreadable.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
	ReactFlow, ReactFlowProvider, Handle, Position, getBezierPath, useReactFlow,
	type Node, type Edge, type NodeProps, type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { ArrowRight, FlaskConical, MessagesSquare, Sparkles } from "lucide-react";
import apiClient from "@/api/client";
import { me, type MeExperiment, type MeExperimentDetail } from "@/api/me";
import EvolutionChart, { type EvoSeries } from "@/components/research/EvolutionChart";
import BestScoreChart from "@/components/research/BestScoreChart";
import VersionChain from "@/components/research/VersionChain";
import { buildEvolution } from "@/lib/evolution";
import ApprovalCard, { readNotNow, writeNotNow } from "@/components/research/ApprovalCard";
import {
	buildResearchTree, comparabilityNote, criteriaInWords, experimentStatus, humanId, mapSummary, pathTo, versionsOf,
	type MapNode, type Proposal, type Tone, type VersionInfo,
} from "@/lib/research-map";
import { humanMetric, fmtMetricValue } from "@/lib/run-answer";
import { workflowPath } from "@/lib/run-routes";
import { loopLabel } from "@/lib/workflow-names";
import { appTitle } from "@/components/workflow/AppCard";
import { StrandAvatar } from "@/components/illustrations/StrandAvatar";
import { TONES } from "@/lib/tones";
import { Button } from "@/components/ui/button";
import { useShellActivity } from "@/components/activity/useShellActivity";
import { useOncePerSession } from "@/components/activity/hooks";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<Tone, string> = {
	ok: "text-gold-700", running: "text-lagoon-700", failing: "text-brick-700", attention: "text-ember-700", idle: "text-ink-600",
};
const dot = (t: Tone) => cn("w-1.5 h-1.5 rounded-full flex-shrink-0", TONES[t].dot);

// ── data ──────────────────────────────────────────────────────────────────

interface MapData { exps: MeExperiment[]; proposals: Proposal[]; asOf: number }
const cache = new Map<string, MapData>();

function useResearchData(app: string) {
	const [data, setData] = useState<MapData | null>(() => cache.get(app) ?? null);
	const load = useCallback(async () => {
		const [ex, pr] = await Promise.allSettled([
			me.experiments(app),
			// An app's own tool: absent on most apps, which is "no suggestions".
			apiClient.get(`/api/v1/me/apps/${encodeURIComponent(app)}/data?tool=proposals`),
		]);
		const exps = ex.status === "fulfilled" ? (ex.value.experiments || []) : (cache.get(app)?.exps ?? []);
		const raw = pr.status === "fulfilled" ? (pr.value.data?.data?.proposals ?? pr.value.data?.proposals) : null;
		// A failed request keeps the last list; only an answer can empty it.
		const proposals: Proposal[] = pr.status === "rejected"
			? (cache.get(app)?.proposals ?? [])
			: Array.isArray(raw) ? raw.filter((p: Proposal) => p && typeof p.id === "string") : [];
		const d = { exps, proposals, asOf: Date.now() };
		cache.set(app, d);
		setData(d);
	}, [app]);
	useEffect(() => { setData(cache.get(app) ?? null); void load(); }, [app, load]);
	useStudioRefetch(["experiments", "runs"], load);
	return { data, reload: load };
}

function useWide(): boolean {
	const q = "(min-width: 640px)";
	const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia(q).matches);
	useEffect(() => {
		const m = window.matchMedia(q);
		const h = () => setWide(m.matches);
		m.addEventListener("change", h);
		return () => m.removeEventListener("change", h);
	}, []);
	return wide;
}

// ── nodes ─────────────────────────────────────────────────────────────────

const SIZE: Record<MapNode["kind"], { w: number; h: number }> = {
	// Real rendered heights (title + 2-line question + 2-line status), not
	// minimums: dagre spaces by these, and short ones made cards overlap.
	app: { w: 200, h: 64 }, experiment: { w: 260, h: 118 }, version: { w: 220, h: 72 }, suggested: { w: 240, h: 80 },
};

interface NodeData extends Record<string, unknown> {
	kind: MapNode["kind"];
	dim: boolean; selected: boolean; grow: boolean; delay: number;
	app?: string; running?: boolean; count?: number;
	exp?: MeExperiment; version?: VersionInfo; proposal?: Proposal;
}

const hidden = "!opacity-0 !w-1 !h-1 !min-w-0 !min-h-0 !border-0";

function Shell({ d, className, children }: { d: NodeData; className?: string; children: React.ReactNode }) {
	// Two layers: the OUTER one grows in (its animation holds opacity with
	// fill-mode both), the INNER one dims / rings on selection — on one element
	// the finished animation pinned opacity at 1 and nothing ever dimmed.
	return (
		<div className={cn(d.grow && "animate-lumen-rise")} style={{ animationDelay: d.grow ? `${d.delay}ms` : undefined }}>
			<div
				className={cn(
					"relative rounded-xl border bg-card px-3 py-2 shadow-e1 cursor-pointer transition-[opacity,filter,box-shadow] duration-300",
					d.dim && "opacity-40 blur-[1px]",
					d.selected && "ring-2 ring-gold-400 shadow-e2",
					className,
				)}
				style={{ width: SIZE[d.kind].w, minHeight: SIZE[d.kind].h }}
			>
				<Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
				{children}
				<Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
			</div>
		</div>
	);
}

const AppNode = memo(({ data: d }: NodeProps<Node<NodeData>>) => (
	<Shell d={d} className="border-ink-300">
		{/* Glow rings while any of the app's workflows is running. */}
		{d.running && <span aria-hidden className="absolute -inset-1.5 rounded-2xl ring-2 ring-lagoon-300 animate-lumen-breathe pointer-events-none" />}
		<div className="flex items-center gap-2">
			<StrandAvatar slug={d.app!} size={28} />
			<div className="min-w-0">
				<div className="text-meta font-semibold text-ink-900 truncate">{appTitle(d.app!)}</div>
				<div className={cn("text-micro", d.running ? "text-lagoon-700" : "text-ink-600")}>{d.running ? "Running now" : `${d.count} experiment${d.count === 1 ? "" : "s"}`}</div>
			</div>
		</div>
	</Shell>
));

const ExperimentNode = memo(({ data: d }: NodeProps<Node<NodeData>>) => {
	const e = d.exp!;
	const st = experimentStatus(e);
	const q = (e as { description?: string }).description || e.hypothesis;
	return (
		<Shell d={d} className={st.tone === "idle" && /^Done/.test(st.text) ? "border-ink-200 opacity-80" : "border-ink-200"}>
			<div className="flex items-center gap-1.5">
				<FlaskConical className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" aria-hidden />
				<div className="text-meta font-semibold text-ink-900 truncate">{humanId(e.id)}</div>
			</div>
			{q && <div className="text-micro text-ink-600 leading-snug line-clamp-2 mt-0.5">{q}</div>}
			<div className={cn("flex items-start gap-1.5 text-micro font-medium mt-1 leading-snug", TONE_TEXT[st.tone])}>
				<span className={cn(dot(st.tone), "mt-1")} /> <span className="line-clamp-2">{st.text}</span>
			</div>
		</Shell>
	);
});

const TAG_CLS: Record<string, string> = {
	winning: "bg-gold-700 text-white border-gold-700",
	leading: "border-gold-300 text-gold-800 bg-gold-50",
	current: "border-ink-200 text-ink-700 bg-ink-50",
	"not run yet": "border-dashed border-ink-300 text-ink-600",
	trying: "border-lagoon-200 text-lagoon-700 bg-lagoon-50",
	"can't tell apart": "border-ember-200 text-ember-700 bg-ember-50",
};

const VersionNode = memo(({ data: d }: NodeProps<Node<NodeData>>) => {
	const v = d.version!;
	return (
		<Shell d={d} className={cn(v.tag === "winning" ? "border-gold-300" : "border-ink-200", v.tag === "not run yet" && "border-dashed")}>
			<div className="flex items-center gap-1.5 min-w-0">
				<span className="text-caption font-medium text-ink-900 truncate">{v.label}</span>
				<span className={cn("ml-auto flex-shrink-0 px-1.5 rounded-full border text-nano font-medium", TAG_CLS[v.tag])}>{v.tag}</span>
			</div>
			<div className="text-micro text-ink-600 tabular-nums truncate mt-0.5">{v.line}</div>
			{v.progress != null && v.progress < 1 && (
				<div className="mt-1 h-1 rounded-full bg-ink-100 overflow-hidden" title="toward the results needed to judge it">
					<div className="h-full rounded-full bg-lagoon-400" style={{ width: `${Math.round(v.progress * 100)}%` }} />
				</div>
			)}
		</Shell>
	);
});

const SuggestedNode = memo(({ data: d }: NodeProps<Node<NodeData>>) => {
	const p = d.proposal!;
	return (
		<Shell d={d} className="border-dashed border-gold-300 bg-gold-50/40 shadow-none">
			<div className="flex items-center gap-1.5 text-nano font-semibold uppercase tracking-wide text-gold-700">
				<Sparkles className="w-3 h-3" aria-hidden /> Suggested
			</div>
			<div className="text-caption font-medium text-ink-900 truncate">{humanId(p.id)}</div>
			{p.est_runs ? <div className="text-micro text-ink-600">~{p.est_runs} runs</div> : null}
		</Shell>
	);
});

const nodeTypes = { app: AppNode, experiment: ExperimentNode, version: VersionNode, suggested: SuggestedNode };

// ── edges: draw in on first view, flow along the selected path ─────────────

interface EdgeData extends Record<string, unknown> { dashed?: boolean; onPath: boolean; dim: boolean; grow: boolean; delay: number; label?: string }
function ResearchEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<EdgeData>>) {
	const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
	const d = data!;
	// Our own <path> (not BaseEdge) so it can carry pathLength=100: the draw-in
	// is one dash rule for every edge, whatever its real length.
	const line = (
		<path
			id={id}
			d={path}
			fill="none"
			pathLength={100}
			className={cn(
				"react-flow__edge-path research-edge",
				d.onPath ? "research-edge-flow" : d.dashed ? "research-edge-dashed" : d.grow && "research-edge-draw",
				d.dim && "research-edge-dim",
			)}
			style={{ animationDelay: d.grow && !d.onPath ? `${d.delay}ms` : undefined }}
		/>
	);
	// Edges that carry a relation say which ("suggested next", "forked from").
	// "forked from" always (it is the derivation); "suggested next" only on the
	// selected path — the card already says SUGGESTED, and three labels at one
	// fork piled up.
	const showLabel = d.label === "forked from" || (d.label === "suggested next" && d.onPath);
	return showLabel ? (
		<g>
			{line}
			<text x={lx} y={ly} dy="-0.4em" textAnchor="middle" className={cn("research-edge-label text-nano", d.dim && "opacity-25")}>{d.label}</text>
		</g>
	) : line;
}
const edgeTypes = { research: ResearchEdge };

// ── layout ────────────────────────────────────────────────────────────────

function layout(nodes: MapNode[], edges: Array<{ source: string; target: string }>) {
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 64, marginx: 8, marginy: 8 });
	g.setDefaultEdgeLabel(() => ({}));
	for (const n of nodes) g.setNode(n.id, { width: SIZE[n.kind].w, height: SIZE[n.kind].h });
	for (const e of edges) g.setEdge(e.source, e.target);
	dagre.layout(g);
	const pos = new Map<string, { x: number; y: number }>();
	for (const n of nodes) {
		const p = g.node(n.id);
		pos.set(n.id, { x: p.x - SIZE[n.kind].w / 2, y: p.y - SIZE[n.kind].h / 2 });
	}
	return { pos, height: (g.graph().height as number) || 300, width: (g.graph().width as number) || 800 };
}

// ── the map ───────────────────────────────────────────────────────────────

function MapCanvas({ app, exps, proposals, selected, onSelect, grow }: {
	app: string; exps: MeExperiment[]; proposals: Proposal[];
	selected: string | null; onSelect: (id: string | null) => void; grow: boolean;
}) {
	const running = useShellActivity()?.runningApps.includes(app) ?? false;
	const tree = useMemo(() => buildResearchTree(app, exps, proposals), [app, exps, proposals]);
	const { pos, height, width } = useMemo(() => layout(tree.nodes, tree.edges), [tree]);
	// Size the canvas so the whole tree fits at a READABLE zoom: the zoom is set
	// by the width we have, and the height follows (a fixed box shrank a
	// nine-row tree to unreadable cards).
	const boxRef = useRef<HTMLDivElement>(null);
	const [boxW, setBoxW] = useState(0);
	useEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const lit = useMemo(() => (selected ? pathTo(tree.nodes, selected) : null), [tree, selected]);
	const expById = useMemo(() => new Map(exps.map((e) => [e.id, e])), [exps]);
	const propById = useMemo(() => new Map(proposals.map((p) => [p.id, p])), [proposals]);

	// Growth order: by depth, then top to bottom — the tree unfolds from the app.
	const order = useMemo(() => {
		const o = new Map<string, number>();
		[...tree.nodes].sort((a, b) => a.depth - b.depth || (pos.get(a.id)!.y - pos.get(b.id)!.y)).forEach((n, i) => o.set(n.id, i));
		return o;
	}, [tree, pos]);
	const delayOf = (id: string) => (tree.nodes.find((n) => n.id === id)?.depth ?? 0) * 260 + (order.get(id) ?? 0) * 25;

	const nodes: Node<NodeData>[] = tree.nodes.map((n) => {
		const [, a, b] = n.id.split(":");
		return {
			id: n.id, type: n.kind, position: pos.get(n.id)!, draggable: false, selectable: false,
			data: {
				kind: n.kind, dim: !!lit && !lit.has(n.id), selected: selected === n.id, grow, delay: delayOf(n.id),
				app, running, count: exps.length,
				exp: n.kind === "experiment" ? expById.get(n.ref) : undefined,
				version: n.kind === "version" ? versionsOf(expById.get(a)!).find((v) => v.id === b) : undefined,
				proposal: n.kind === "suggested" ? propById.get(n.ref) : undefined,
			},
		};
	});
	const edges: Edge<EdgeData>[] = tree.edges.map((e) => ({
		id: e.id, source: e.source, target: e.target, type: "research",
		data: { dashed: e.dashed, label: e.label, onPath: !!lit && lit.has(e.source) && lit.has(e.target), dim: !!lit && !(lit.has(e.source) && lit.has(e.target)), grow, delay: delayOf(e.target) - 120 },
	}));

	// Camera: frame the selected path (600ms), or everything when cleared.
	const rf = useReactFlow();
	const first = useRef(true);
	useEffect(() => {
		if (first.current) { first.current = false; return; }
		const ids = lit ? [...lit] : tree.nodes.map((n) => n.id);
		rf.fitView({ nodes: ids.map((id) => ({ id })), duration: 600, padding: 0.25, maxZoom: 1.1 });
	}, [lit, rf, tree.nodes]);

	const zoom = boxW ? Math.min(1, (boxW - 24) / width) : 0.9;
	const h = Math.max(220, Math.min(900, height * zoom + 32));
	return (
		<div ref={boxRef} style={{ height: h }} className="research-map rounded-xl border border-ink-200 bg-ink-50/40 overflow-hidden">
			<ReactFlow
				nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
				onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
				onPaneClick={() => onSelect(null)}
				key={boxW ? "sized" : "unsized"}
				fitView fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
				nodesConnectable={false} nodesDraggable={false} elementsSelectable={false}
				zoomOnScroll={false} preventScrolling={false} panOnScroll={false}
				minZoom={0.3} maxZoom={1.5}
				proOptions={{ hideAttribution: true }}
			/>
		</div>
	);
}

// ── what's selected, in words ─────────────────────────────────────────────

// The experiment's results over time (detail endpoint; identity v0.5.474
// serves cloud apps from the run store). Cached per experiment.
type SeriesData = { series: MeExperimentDetail["series"]; runningMean: boolean };
const seriesCache = new Map<string, SeriesData>();
function useSeries(app: string, id: string) {
	const key = `${app}:${id}`;
	const [s, setS] = useState<SeriesData | null>(() => seriesCache.get(key) ?? null);
	useEffect(() => {
		let live = true;
		setS(seriesCache.get(key) ?? null);
		me.experiment(app, id)
			.then((d) => {
				const v = { series: d.series || [], runningMean: (d as { series_kind?: string }).series_kind === "running_mean" };
				seriesCache.set(key, v);
				if (live) setS(v);
			})
			.catch(() => { if (live) setS((cur) => cur ?? { series: [], runningMean: false }); });
		return () => { live = false; };
	}, [app, id, key]);
	return s;
}

function ExperimentDetail({ app, e }: { app: string; e: MeExperiment }) {
	const st = experimentStatus(e);
	const seriesData = useSeries(app, e.id);
	const series = seriesData?.series ?? null;
	const versions = versionsOf(e);
	// Lines in DECLARED version order, so colours follow the version. A series
	// the server only GUESSED a version for (arm_inferred: runs that named none,
	// filed under "current") is left off: on kol_alpha it averaged 13M ticks
	// against the experiment's own 122k for that version.
	const isInferred = (x: { arm_inferred?: boolean }) => !!x.arm_inferred;
	const unlabelledRuns = (series || []).filter((x) => isInferred(x as { arm_inferred?: boolean })).reduce((a, x) => a + x.points.length, 0);
	const evo: EvoSeries[] = (series || []).filter((x) => !isInferred(x as { arm_inferred?: boolean }))
		.map((s) => ({ s, i: versions.findIndex((v) => v.id === s.variant_id) }))
		.sort((a, b) => (a.i < 0 ? 99 : a.i) - (b.i < 0 ? 99 : b.i))
		.map(({ s }) => ({
			id: s.variant_id,
			label: versions.find((v) => v.id === s.variant_id)?.label ?? humanId(s.variant_id),
			points: s.points,
		}));
	const metric = e.metric?.name || e.metric_name;
	const m = metric ? humanMetric(metric) : null;
	const hib = !(e.higher_is_better === false || e.metric?.higher_is_better === false);
	const labelOf = (arm: string) => versions.find((v) => v.id === arm)?.label ?? humanId(arm);
	const colorOf = (arm: string) => Math.max(0, versions.findIndex((v) => v.id === arm));
	const evolution = useMemo(() => buildEvolution(
		evo.map((x) => ({ id: x.id, points: x.points })),
		{
			runningMean: !!seriesData?.runningMean, minSamples: e.min_samples, higherIsBetter: hib,
			declaredArms: versions.map((v) => v.id),
			decided: !!e.criteria_met && e.comparable !== false, winner: e.best_variant,
		},
	// eslint-disable-next-line react-hooks/exhaustive-deps
	), [series, seriesData?.runningMean, e.id, e.min_samples, hib, e.criteria_met, e.best_variant, e.comparable]);
	const loop = e.dispatch?.loop || e.loops?.[0];
	const done = criteriaInWords(e.success_criteria);
	const q = (e as { description?: string }).description;
	return (
		<div className="rounded-xl border border-ink-200 bg-card p-3 space-y-2.5 animate-lumen-rise">
			<div>
				<div className="text-body font-semibold text-ink-900">{humanId(e.id)}</div>
				{q && <div className="text-meta text-ink-700">{q}</div>}
			</div>
			<div className={cn("flex items-center gap-1.5 text-meta font-medium", TONE_TEXT[st.tone])}><span className={dot(st.tone)} />{st.text}</div>
			{comparabilityNote(e) && <div className="text-caption text-ink-700">{comparabilityNote(e)}</div>}
			<dl className="grid gap-1 text-caption">
				{e.hypothesis && e.hypothesis !== q && <div><dt className="inline text-ink-600">Expecting: </dt><dd className="inline text-ink-800">{e.hypothesis}</dd></div>}
				{m && <div><dt className="inline text-ink-600">Measures: </dt><dd className="inline text-ink-800">{m.label}{m.unit ? ` (${m.unit})` : ""} — {e.higher_is_better === false || e.metric?.higher_is_better === false ? "lower" : "higher"} is better</dd></div>}
				{done && <div><dt className="inline text-ink-600">Done when: </dt><dd className="inline text-ink-800">{done}</dd></div>}
			</dl>
			{series === null ? (
				<div className="h-24 lumen-skeleton rounded-lg" role="status" aria-label="Loading how it evolved" />
			) : evolution && metric && e.comparable !== false ? (
				// Comparable versions: Novix's best-so-far story on one axis.
				<BestScoreChart evo={evolution} labelOf={labelOf} colorOf={colorOf} metricKey={metric} unit={m?.unit ?? ""}
					higherIsBetter={hib} minSamples={Math.max(1, e.min_samples || 1)} />
			) : evo.some((x) => x.points.length > 1) && metric ? (
				// Measured differently: one small chart per version, never ranked.
				<EvolutionChart series={evo} metricKey={metric} unit={m?.unit ?? ""} higherIsBetter={hib}
					comparable={false} unlabelledRuns={unlabelledRuns} alreadyMeans={!!seriesData?.runningMean} />
			) : null}
			{/* The versions in the order they were tried, each with its state —
			    from the results over time when there are any, else the totals. */}
			{evolution ? (
				<VersionChain chain={evolution.chain} labelOf={labelOf} valueOf={(v) => fmtMetricValue(v, m?.unit ?? "", metric || "")} />
			) : (
				<ul className="space-y-1">
					{versions.map((v) => (
						<li key={v.id} className="flex items-center gap-2 text-caption">
							<span className="font-medium text-ink-900 min-w-0 truncate">{v.label}</span>
							<span className={cn("px-1.5 rounded-full border text-nano font-medium flex-shrink-0", TAG_CLS[v.tag])}>{v.tag}</span>
							<span className="ml-auto text-ink-600 tabular-nums truncate">{v.line}</span>
						</li>
					))}
				</ul>
			)}
			<div className="flex items-center gap-2 flex-wrap pt-0.5">
				{loop && (
					<Button asChild size="sm" variant="secondary">
						<Link to={workflowPath(app, loop, { tab: "experiments" })}>Open {loopLabel("", loop)} <ArrowRight className="w-3.5 h-3.5" /></Link>
					</Button>
				)}
				<Button size="sm" variant="ghost"
					onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: `Where does the ${humanId(e.id)} experiment stand, and what should I do next?`, context: { app, loop } } }))}>
					<MessagesSquare className="w-3.5 h-3.5" /> Ask about it
				</Button>
			</div>
		</div>
	);
}

// Phones: the same facts as a list.
function ResearchList({ app, exps, onPick }: { app: string; exps: MeExperiment[]; onPick: (id: string) => void }) {
	return (
		<ul className="space-y-1.5">
			{exps.map((e) => {
				const st = experimentStatus(e);
				return (
					<li key={e.id}>
						<button type="button" onClick={() => onPick(`exp:${e.id}`)} className="w-full text-left rounded-xl border border-ink-200 bg-card px-3 py-2 lumen-lift">
							<div className="text-meta font-semibold text-ink-900">{humanId(e.id)}</div>
							<div className={cn("flex items-center gap-1.5 text-micro font-medium", TONE_TEXT[st.tone])}><span className={dot(st.tone)} />{st.text}</div>
							<div className="text-micro text-ink-600">{versionsOf(e).length} versions · {appTitle(app)}</div>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

export default function ResearchMap({ app }: { app: string }) {
	const { data } = useResearchData(app);
	const wide = useWide();
	const grow = useOncePerSession(`research-map:${app}`);
	const [selected, setSelected] = useState<string | null>(null);
	const [notNow, setNotNow] = useState<string[]>(() => readNotNow(app));
	const [pIndex, setPIndex] = useState(0);
	useEffect(() => { setSelected(null); setNotNow(readNotNow(app)); setPIndex(0); }, [app]);
	// `?suggestion=<id>` (the Inbox's "See it on the map"): open on that
	// suggestion — highlighted on the map, its approval card showing.
	const [params] = useSearchParams();
	const wanted = params.get("suggestion");
	useEffect(() => {
		if (!wanted || !data) return;
		if (data.proposals.some((p) => p.id === wanted)) setSelected(`sug:${wanted}`);
	}, [wanted, data]);

	if (!data) return null;
	const { exps, proposals } = data;
	const pending = proposals.filter((p) => !exps.some((e) => e.id === p.id) && !notNow.includes(p.id));
	if (exps.length === 0 && pending.length === 0) return null;

	const selKind = selected?.split(":")[0];
	const selExp = selKind === "exp" ? exps.find((e) => `exp:${e.id}` === selected)
		: selKind === "ver" ? exps.find((e) => e.id === selected!.split(":")[1]) : undefined;
	// Paging the approval card re-targets the highlight on the map.
	const showProposal = (i: number) => { setPIndex(i); const p = pending[i]; if (p) setSelected(`sug:${p.id}`); };
	const dismiss = (id: string) => {
		const next = [...notNow, id];
		setNotNow(next);
		writeNotNow(app, next);
		setPIndex((i) => Math.max(0, Math.min(i, pending.length - 2)));
		setSelected(null);
	};
	const selProposalIdx = selKind === "sug" ? pending.findIndex((p) => `sug:${p.id}` === selected) : -1;
	const updated = new Date(data.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

	return (
		<section aria-label="Research" className={cn("space-y-2", grow && "lumen-hero-in")}>
			<h2 className="eyebrow flex items-center gap-2">Research <span className="normal-case tracking-normal text-ink-600 font-normal">what this app is exploring, and what to try next</span></h2>
			{wide ? (
				<ReactFlowProvider>
					<MapCanvas app={app} exps={exps} proposals={pending} selected={selected} onSelect={setSelected} grow={grow} />
				</ReactFlowProvider>
			) : (
				<ResearchList app={app} exps={exps} onPick={setSelected} />
			)}
			{selExp && <ExperimentDetail app={app} e={selExp} />}
			{pending.length > 0 && (
				<ApprovalCard app={app} list={pending} index={selProposalIdx >= 0 ? selProposalIdx : Math.min(pIndex, pending.length - 1)}
					onIndex={showProposal} onDone={dismiss} />
			)}
			<div className="text-nano font-mono text-ink-600">{mapSummary(exps, pending)} · updated {updated}{wide ? " · click a card to follow its path" : ""}</div>
		</section>
	);
}

// ResearchMap — the app home's answer to "what is this app exploring, what
// came from what, and what should it try next?"
//
// A 3D space (Space3D, geometry in lib/space3d.ts): the app at the centre,
// experiments on the first shell, their versions around them, suggestions as
// dashed cards beside the experiment they extend. It turns slowly when idle;
// drag to turn; clicking a card flies to its path, dims the rest and opens its
// story below. Under it, "For your approval": Try · Cost · Done when.
//
// Novix's look and motion (their exploration space, rebuilt — not copied),
// Lumid's clarity: readable cards with a status in words, no modes, no
// counters. Wording lives in lib/research-map.ts. Phones get a list.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, FlaskConical, MessagesSquare, Sparkles, X } from "lucide-react";
import apiClient from "@/api/client";
import { me, type MeExperiment, type MeExperimentDetail } from "@/api/me";
import EvolutionChart, { type EvoSeries } from "@/components/research/EvolutionChart";
import BestScoreChart from "@/components/research/BestScoreChart";
import VersionChain from "@/components/research/VersionChain";
import { buildEvolution } from "@/lib/evolution";
import ApprovalCard, { readNotNow, writeNotNow } from "@/components/research/ApprovalCard";
import { useWorkflowColors, type WfSwatch } from "@/hooks/useWorkflowColors";
import Space3D from "@/components/research/Space3D";
import RunVersions from "@/components/research/RunVersions";
import YourCall from "@/components/research/YourCall";
import WorkflowPanel, { NodePanel, CompareView, wfLabel, type CompareSide, type PanelView } from "@/components/research/WorkflowPanel";
import TrySetups from "@/components/research/TrySetups";
import { useAppGraph } from "@/hooks/useAppGraph";
import type { SpecNode, SpecWorkflow } from "@/lib/app-spec";
import type { MeWorkflowRow } from "@/api/me";
import { fmtAgo } from "@/lib/activity";
import {
	buildResearchTree, comparabilityNote, criteriaInWords, experimentStatus, humanId, mapSummary, pathTo, versionsOf, OTHER_NODE,
	type MapEdge, type MapNode, type Proposal, type Tone, type VersionInfo,
	shortStatus,
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
import { sharedLine } from "@/lib/measure";

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

function useMedia(q: string): boolean {
	const [on, setOn] = useState(() => typeof window === "undefined" || window.matchMedia(q).matches);
	useEffect(() => {
		const m = window.matchMedia(q);
		const h = () => setOn(m.matches);
		h();
		m.addEventListener("change", h);
		return () => m.removeEventListener("change", h);
	}, [q]);
	return on;
}
const useWide = () => useMedia("(min-width: 640px)");

// ── nodes ─────────────────────────────────────────────────────────────────

// ── cards in the 3D space ─────────────────────────────────────────────────
// Compact on purpose: in 3D the cards overlap as the space turns, so each says
// only its name and its status in words; the full story opens below the map.

const TAG_CLS: Record<string, string> = {
	winning: "bg-gold-700 text-white border-gold-700",
	leading: "border-gold-300 text-gold-800 bg-gold-50",
	current: "border-ink-200 text-ink-700 bg-ink-50",
	"not run yet": "border-dashed border-ink-300 text-ink-600",
	trying: "border-lagoon-200 text-lagoon-700 bg-lagoon-50",
	"can't tell apart": "border-ember-200 text-ember-700 bg-ember-50",
};

const cardBase = (selected: boolean) => cn(
	"relative rounded-xl border bg-card px-2.5 py-1.5 shadow-e1 transition-shadow",
	selected && "ring-2 ring-plum-400 shadow-e3",
);

function AppCard3D({ app, running, count, selected }: { app: string; running: boolean; count: number; selected: boolean }) {
	// `count` is the app's workflows: the graph's first layer (2026-11-25).
	return (
		<div className={cn(cardBase(selected), "border-ink-300 px-3 py-2")} style={{ width: 210 }}>
			{/* Glow rings while any of the app's workflows is running. */}
			{running && <span aria-hidden className="absolute -inset-1.5 rounded-2xl ring-2 ring-lagoon-300 animate-lumen-breathe pointer-events-none" />}
			<div className="flex items-center gap-2">
				<StrandAvatar slug={app} size={28} />
				<div className="min-w-0">
					<div className="text-meta font-semibold text-ink-900 truncate">{appTitle(app)}</div>
					<div className={cn("text-micro", running ? "text-lagoon-700" : "text-ink-600")}>{running ? "Running now" : `${count} workflow${count === 1 ? "" : "s"}`}</div>
				</div>
			</div>
		</div>
	);
}

function ExperimentCard3D({ e, selected }: { e: MeExperiment; selected: boolean }) {
	const st = experimentStatus(e);
	return (
		<div className={cn(cardBase(selected), "border-ink-200")} style={{ width: 230 }}>
			<div className="flex items-center gap-1.5">
				<FlaskConical className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" aria-hidden />
				<div className="text-caption font-semibold text-ink-900 truncate">{humanId(e.id)}</div>
			</div>
			<div className={cn("flex items-start gap-1.5 text-micro font-medium leading-snug mt-0.5", TONE_TEXT[st.tone])}>
				<span className={cn(dot(st.tone), "mt-1")} /> <span className="line-clamp-2">{st.text}</span>
			</div>
		</div>
	);
}

function VersionCard3D({ v, selected }: { v: VersionInfo; selected: boolean }) {
	return (
		<div className={cn(cardBase(selected), v.tag === "winning" ? "border-gold-300" : "border-ink-200", v.tag === "not run yet" && "border-dashed")} style={{ width: 178 }}>
			<div className="flex items-center gap-1.5 min-w-0">
				<span className="text-caption font-medium text-ink-900 truncate">{v.label}</span>
				<span className={cn("ml-auto flex-shrink-0 px-1.5 rounded-full border text-nano font-medium", TAG_CLS[v.tag])}>{v.tag}</span>
			</div>
			{v.tag !== "not run yet" && <div className="text-micro text-ink-600 tabular-nums truncate">{v.line}</div>}
		</div>
	);
}

function SuggestedCard3D({ p, selected }: { p: Proposal; selected: boolean }) {
	return (
		<div className={cn(cardBase(selected), "border-dashed border-gold-300 bg-gold-50 shadow-none")} style={{ width: 190 }}>
			<div className="flex items-center gap-1 text-nano font-semibold uppercase tracking-wide text-gold-700">
				<Sparkles className="w-3 h-3" aria-hidden /> Suggested
			</div>
			<div className="text-caption font-medium text-ink-900 truncate">{humanId(p.id)}</div>
		</div>
	);
}

// ── dots: the space at rest ───────────────────────────────────────────────
// Novix draws its exploration space as glowing dots with their names; only
// the picked path becomes cards. Lumid keeps a status in the dot's colour and
// the words one hover/click away (the card). The dot sits ON the node's point
// so edges meet it; the name hangs to its right, outside the box.

// The same states as VERSION_DOT, for SVG particles.
// One hue for the space (plum = knowledge), stepped by how sure we are —
// Novix's single-accent look; the state is also said in words beside it.
const VERSION_FILL: Record<string, string> = {
	winning: "fill-plum-700", leading: "fill-plum-600", current: "fill-plum-400", trying: "fill-plum-400", "can't tell apart": "fill-plum-300",
};
// A version's certainty as a shade of its branch's colour.
const VERSION_SHADE: Record<string, string> = {
	winning: "", leading: "opacity-90", current: "opacity-60", trying: "opacity-60", "can't tell apart": "opacity-45",
};
const VERSION_DOT: Record<string, string> = {
	winning: "bg-plum-700", leading: "bg-plum-600", current: "bg-plum-400",
	trying: "bg-plum-400", "can't tell apart": "bg-plum-300", "not run yet": "bg-card border border-dashed border-plum-400",
};

function Dot({ size, className, label, labelClass, sub, subClass, rings, orb = true, panel, ringClass, panelClass, mark }: { size: number; className: string; label: string; labelClass: string; sub?: string; subClass?: string; rings?: boolean | "live";
	/** A/B, when this node is a side of the panel's comparison. */
	mark?: "A" | "B";
	/** Shade it as a small lit sphere (off for hollow dots). */
	orb?: boolean;
	/** A small overview panel in place of the bare label (first-level nodes). */
	panel?: React.ReactNode;
	/** Ring colour (the workflow behind an experiment); default plum. */
	ringClass?: string; panelClass?: string }) {
	return (
		<span className="relative flex items-center justify-center" style={{ width: Math.max(18, size + 8), height: Math.max(18, size + 8) }}>
			{rings && (
				<>
					{/* Novix's root: still rings, and while it works, rings radiating out. */}
					<span aria-hidden className="absolute rounded-full bg-plum-100/70" style={{ width: size + 22, height: size + 22 }} />
					<span aria-hidden className="absolute rounded-full border border-plum-300/70" style={{ width: size + 12, height: size + 12 }} />
					<span aria-hidden className="absolute rounded-full border border-plum-200" style={{ width: size + 38, height: size + 38 }} />
					{rings === "live" && <>
						<span aria-hidden className="absolute rounded-full border border-plum-400 space3d-ping" style={{ width: size + 12, height: size + 12 }} />
						<span aria-hidden className="absolute rounded-full border border-plum-300 space3d-ping [animation-delay:1.1s]" style={{ width: size + 12, height: size + 12 }} />
					</>}
				</>
			)}
			<span className={cn("rounded-full ring-[3px] ring-plum-200/60", ringClass, orb && "space3d-orb", className)} style={{ width: size, height: size }} />
			{mark && <span aria-label={`Compared as ${mark}`} className={cn("absolute -left-2 -top-2 z-10 rounded px-1 text-nano font-semibold leading-tight text-white", mark === "A" ? "bg-ink-800" : "bg-plum-700")}>{mark}</span>}
			{panel ? (
				<span className={cn("absolute left-full ml-1.5 flex flex-col leading-tight space3d-label space3d-panel", panelClass)}>{panel}</span>
			) : (
				<span className="absolute left-full ml-1 flex flex-col leading-tight space3d-label">
					<span className={cn("whitespace-nowrap max-w-[13rem] truncate", labelClass)}>{label}</span>
					{sub && <span className={cn("whitespace-nowrap max-w-[13rem] truncate text-nano", subClass ?? "text-ink-600")}>{sub}</span>}
				</span>
			)}
		</span>
	);
}

// ── the map ───────────────────────────────────────────────────────────────

/** The stage's height: from where it starts down to the bottom of the window
 *  ("the research graph should align with the screen height", 2026-11-27).
 *  Measured from the stage's own top, with the scroll offset added back, so
 *  scrolling never resizes it — only the window (or the header above it) does.
 *  Was clamp(vh − 300, 520, 680), which left a tall screen half empty. */
const STAGE_BOTTOM_GAP = 16;
const STAGE_MIN = 420;
function useStageHeight(anchor: React.RefObject<HTMLElement | null>): number {
	const [h, setH] = useState(() => (typeof window === "undefined" ? 600 : Math.max(STAGE_MIN, window.innerHeight - 300)));
	useEffect(() => {
		const measure = () => {
			const el = anchor.current;
			if (!el) return;
			let scroll = 0;
			for (let p = el.parentElement; p; p = p.parentElement) {
				if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { scroll = p.scrollTop; break; }
			}
			const top = el.getBoundingClientRect().top + scroll + (scroll ? 0 : window.scrollY);
			const next = Math.round(Math.max(STAGE_MIN, window.innerHeight - top - STAGE_BOTTOM_GAP));
			setH((cur) => (Math.abs(cur - next) > 2 ? next : cur));
		};
		const raf = requestAnimationFrame(measure);
		window.addEventListener("resize", measure);
		return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
	}, [anchor]);
	return h;
}

/** A workflow's state in words, from its row (no extra request per dot). */
function rowStatus(row?: MeWorkflowRow): { text: string; tone: "ok" | "failing" | "running" | "idle" } {
	if (!row) return { text: "Hasn't run yet", tone: "idle" };
	if (row.running) return { text: "Running now", tone: "running" };
	if (!row.last_run_ts) return { text: "Hasn't run yet", tone: "idle" };
	const ago = fmtAgo(row.last_run_ts);
	return row.last_run_ok === false ? { text: `Last run failed ${ago}`, tone: "failing" } : { text: `Last run succeeded ${ago}`, tone: "ok" };
}

function MapCanvas({ app, exps, proposals, workflows, groups, rows, marks, selected, onSelect, grow, insetBottom = 0, insetRight = 0, ready = true }: {
	app: string; exps: MeExperiment[]; proposals: Proposal[];
	/** The app's workflows (from its spec) and the child nodes a user made. */
	workflows: SpecWorkflow[]; groups: SpecNode[];
	rows: Map<string, MeWorkflowRow>;
	/** Graph ids marked A / B (the panel's comparison). */
	marks: Map<string, "A" | "B">;
	selected: string | null; onSelect: (id: string | null) => void; grow: boolean;
	/** Pixels the docked approval card covers at the foot of the space. */
	insetBottom?: number;
	/** Pixels the panel covers at the right. */
	insetRight?: number;
	/** False until the spec AND the experiments have answered: the space is
	 *  laid out once, not as a skeleton that rebuilds itself seconds later. */
	ready?: boolean;
}) {
	const running = useShellActivity()?.runningApps.includes(app) ?? false;
	// The graph (2026-11-25): app → workflows → experiments (setups) /
	// variants / child nodes. Helpers fold into the workflow they serve.
	const tree = useMemo(() => buildResearchTree(app, exps, proposals, workflows, groups), [app, exps, proposals, workflows, groups]);
	const lit = useMemo(() => (selected ? pathTo(tree.nodes, selected) : null), [tree, selected]);
	const expById = useMemo(() => new Map(exps.map((e) => [e.id, e])), [exps]);
	const propById = useMemo(() => new Map(proposals.map((p) => [p.id, p])), [proposals]);
	const wfById = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows]);
	const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
	const mainCount = workflows.filter((w) => !w.helper).length;
	const versionOf = useCallback((id: string) => {
		const [, a, b] = id.split(":");
		const e = expById.get(a);
		return e ? versionsOf(e).find((v) => v.id === b) : undefined;
	}, [expById]);
	// Growth order: the app, then workflows, each followed by what's under it.
	const order = useMemo(() => {
		const o = new Map<string, number>();
		tree.nodes.forEach((n, i) => o.set(n.id, n.depth === 0 ? 0 : i));
		return o;
	}, [tree]);
	const childCount = useCallback((id: string) => tree.nodes.filter((n) => n.parent === id).length, [tree]);
	const nodeTitle = (ref: string) => (ref === OTHER_NODE ? "Other workflows" : groupById.get(ref)?.title ?? humanId(ref));
	// Evidence around each version: one particle per result (log-scaled in Space3D).
	const evidence = useCallback((n: MapNode) => {
		if (n.kind !== "version") return null;
		const v = versionOf(n.id);
		if (!v || !v.n) return null;
		return { count: v.n, className: VERSION_FILL[v.tag] ?? "fill-ink-500" };
	}, [versionOf]);
	const describe = useCallback((n: MapNode): string => {
		if (n.kind === "app") return `${appTitle(app)}: ${mainCount} workflow${mainCount === 1 ? "" : "s"}${running ? ", running now" : ""}`;
		if (n.kind === "workflow") { const w = wfById.get(n.ref); return `${w ? wfLabel(w) : n.ref}${w?.parent ? " (variant)" : ""}: ${rowStatus(rows.get(n.ref)).text}`; }
		if (n.kind === "node") return `${nodeTitle(n.ref)}: holds ${childCount(n.id)}`;
		if (n.kind === "experiment") { const e = expById.get(n.ref); return e ? `${humanId(e.id)}: ${experimentStatus(e).text}` : n.ref; }
		if (n.kind === "version") { const v = versionOf(n.id); return v ? `${v.label}: ${v.tag}${v.tag !== "not run yet" ? `, ${v.line}` : ""}` : n.ref; }
		return `Suggested: ${humanId(n.ref)}`;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app, mainCount, running, expById, versionOf, wfById, rows, childCount, groupById]);
	const renderCard = useCallback((n: MapNode, st: { selected: boolean }) => {
		if (n.kind === "app") return <AppCard3D app={app} running={running} count={mainCount} selected={st.selected} />;
		if (n.kind === "experiment") { const e = expById.get(n.ref); return e ? <ExperimentCard3D e={e} selected={st.selected} /> : null; }
		if (n.kind === "version") { const v = versionOf(n.id); return v ? <VersionCard3D v={v} selected={st.selected} /> : null; }
		if (n.kind === "workflow" || n.kind === "node") {
			const w = wfById.get(n.ref);
			return (
				<div className={cn("min-w-[9rem] rounded-lg border bg-card px-2.5 py-1.5 shadow-e1", st.selected ? "border-plum-400" : "border-ink-200")}>
					<div className="text-caption font-medium text-ink-900">{n.kind === "node" ? nodeTitle(n.ref) : w ? wfLabel(w) : n.ref}</div>
					<div className="text-micro text-ink-600">{n.kind === "node" ? `holds ${childCount(n.id)}` : rowStatus(rows.get(n.ref)).text}</div>
				</div>
			);
		}
		const p = propById.get(n.ref);
		return p ? <SuggestedCard3D p={p} selected={st.selected} /> : null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app, running, mainCount, expById, propById, versionOf, wfById, rows, childCount, groupById]);
	// Each workflow's colour (sidebar bar = map branch = running box).
	const colorOf = useWorkflowColors();
	// ONE colour per branch (2026-11-27: "the balls and lines are inconsistent in
	// colour within the same branch"): every node and edge takes the colour of
	// its top-most workflow — the first-ring workflow it hangs from — so a
	// variant, its experiments and their versions all wear their branch's hue.
	// Edges used to take each workflow's own colour while dots stayed plum.
	const branchOf = useMemo(() => {
		const byId = new Map(tree.nodes.map((n) => [n.id, n]));
		const out = new Map<string, WfSwatch | null>();
		for (const n of tree.nodes) {
			let top: string | null = null;
			for (let cur: MapNode | undefined = n; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) {
				if (cur.kind === "workflow") top = cur.ref;
			}
			out.set(n.id, top ? colorOf(app, top) : null);
		}
		return out;
	}, [tree, app, colorOf]);
	const edgeClass = useCallback((e: MapEdge) => branchOf.get(e.target)?.stroke, [branchOf]);
	const renderDot = useCallback((n: MapNode) => {
		const mark = marks.get(n.id);
		if (n.kind === "app") return <Dot size={14} rings={running ? "live" : true} className="bg-plum-600" label={appTitle(app)} labelClass="text-meta font-semibold text-ink-900"
			sub={`${mainCount} workflow${mainCount === 1 ? "" : "s"}${running ? " · running now" : ""}`} mark={mark} />;
		if (n.kind === "workflow") {
			const w = wfById.get(n.ref);
			const st = rowStatus(rows.get(n.ref));
			const under = tree.nodes.filter((x) => x.parent === n.id);
			const ne = under.filter((x) => x.kind === "experiment").length;
			const nv = under.filter((x) => x.kind === "workflow" || x.kind === "node").length;
			const fb = w?.feedback.map((f) => humanId(f.step)).join(" → ");
			// Every workflow carries a small overview panel: name, how it's doing,
			// how it is measured, and what's under it — the graph reads as an
			// overview without a click.
			const panel = (
				<>
					<span className="max-w-[12rem] truncate whitespace-nowrap text-caption font-medium text-ink-900">{w ? wfLabel(w) : n.ref}</span>
					<span className={cn("max-w-[12rem] truncate whitespace-nowrap text-nano", st.tone === "running" ? "text-lagoon-700" : st.tone === "failing" ? "text-brick-700" : st.tone === "ok" ? "text-gold-700" : "text-ink-600")}>{st.text}</span>
					{(fb || ne || nv) ? (
						<span className="mt-0.5 max-w-[12rem] truncate whitespace-nowrap font-mono text-nano text-ink-600">
							{[fb, ne ? `${ne} experiment${ne === 1 ? "" : "s"}` : "", nv ? `${nv} variant${nv === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
						</span>
					) : null}
				</>
			);
			const sw = branchOf.get(n.id);
			// The branch's hue always; status is a brick ring (failing) or a breath
			// (running) on top of it, and said in words in the panel.
			return <Dot size={w?.parent ? 10 : 12} className={cn(sw?.bar ?? "bg-plum-500", st.tone === "failing" && "!ring-brick-500", st.tone === "running" && "animate-lumen-breathe")} label={w ? wfLabel(w) : n.ref} labelClass="text-caption font-medium text-ink-900" panel={panel}
				ringClass={sw?.ring} panelClass={sw ? cn("border-l-[3px]", sw.border) : undefined} mark={mark} />;
		}
		if (n.kind === "node") {
			const k = childCount(n.id);
			return <Dot size={10} orb={false} className="border-2 border-dashed border-plum-500 bg-card" label={nodeTitle(n.ref)} labelClass="text-caption font-medium text-plum-800"
				sub={n.ref === OTHER_NODE ? "housekeeping" : `node · holds ${k}`} subClass="text-plum-700" mark={mark} />;
		}
		if (n.kind === "experiment") {
			const e = expById.get(n.ref);
			const st = e ? shortStatus(e) : null;
			const vs = e ? versionsOf(e) : [];
			const sw = branchOf.get(n.id);
			return <Dot size={8} className={cn(sw?.bar ?? "bg-plum-400", st?.tone === "failing" && "!ring-brick-500")} ringClass={sw?.ring} label={e ? humanId(e.id) : n.ref} labelClass="text-micro font-medium text-ink-800"
				sub={st ? `${st.text} · ${vs.length} setup${vs.length === 1 ? "" : "s"}` : undefined} mark={mark} />;
		}
		if (n.kind === "version") {
			const v = versionOf(n.id);
			// The version's state in a word when it has one worth saying.
			const tag = v && (v.tag === "winning" || v.tag === "leading" || v.tag === "can't tell apart") ? v.tag : undefined;
			const sw = branchOf.get(n.id);
			const vtag = v?.tag ?? "current";
			// Certainty as a shade of the branch's hue (was plum steps).
			const cls = !sw ? (VERSION_DOT[vtag] ?? "bg-ink-500")
				: vtag === "not run yet" ? cn("bg-card border border-dashed", sw.dash)
					: cn(sw.bar, VERSION_SHADE[vtag] ?? "opacity-60");
			return <Dot size={6} className={cls} ringClass={sw?.ring} orb={vtag !== "not run yet"} label={v?.label ?? n.ref} labelClass="text-micro text-ink-700" sub={tag} mark={mark} />;
		}
		return <Dot size={8} orb={false} className="bg-card border border-dashed border-gold-500" label={`Suggested: ${humanId(n.ref)}`} labelClass="text-micro text-gold-700" mark={mark} />;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app, running, mainCount, expById, versionOf, wfById, rows, tree, branchOf, childCount, marks, groupById]);
	// One stage size for every app, set by the screen alone (window height less
	// where the stage starts) — never by what's in it, whether suggestions wait, or a panel is open (two apps side by
	// side read as two sizes otherwise; user 2026-11-25). The approval card
	// docks over its foot, so it doesn't need room taken off.
	const anchor = useRef<HTMLDivElement>(null);
	const height = useStageHeight(anchor);
	// Draw once. The spec answers first (a handful of workflow nodes) and the
	// experiments seconds later (tens of setups); drawing the first and then
	// the second re-divided the whole circle mid-turn, so everything on screen
	// jumped (2026-11-26, "rotate a while and then change a lot").
	if (!ready) {
		return <div ref={anchor} style={{ height }} className="lumen-skeleton rounded-xl" role="status" aria-label="Reading the map…" />;
	}
	return (
		<div ref={anchor}>
			<Space3D nodes={tree.nodes} edges={tree.edges} renderCard={renderCard} renderDot={renderDot} describe={describe} edgeClass={edgeClass}
				// Workflows carry an overview panel: hovering lights it up, no card swap.
				hoverCard={(n) => n.kind !== "workflow"}
				selected={selected} lit={lit} grow={grow} order={order} height={height} evidence={evidence} insetBottom={insetBottom} insetRight={insetRight}
				onSelect={onSelect} />
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

/** In the map panel, what the experiment tests folds away under one line. */
function Wrap({ panel, children }: { panel: boolean; children: React.ReactNode }) {
	if (!panel) return <>{children}</>;
	return (
		<details className="group rounded-lg bg-muted/40 px-2.5 py-1.5">
			<summary className="cursor-pointer list-none text-micro font-medium text-ink-700 hover:text-ink-900">
				<span className="inline-block transition-transform group-open:rotate-90">›</span> What it tests, and when it&apos;s done
			</summary>
			<div className="pt-1.5">{children}</div>
		</details>
	);
}

function ExperimentDetail({ app, e, panel = false, onClose, style, onCompare }: {
	app: string; e: MeExperiment;
	/** Set when a setup (version) is selected: pick another to compare it with. */
	onCompare?: () => void;
	/** Shown over the map (a panel at its right edge) rather than under it. */
	panel?: boolean; onClose?: () => void; style?: React.CSSProperties;
}) {
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
	// Only this experiment's own declared versions: the server's series read
	// has filled in runs of OTHER experiments on the same workflow (MLSys
	// "SLA concurrency" drew sla_model_size's llm_1_7b as its best so far
	// while saying none of its versions had run, 2026-11-25).
	const declared = new Set(versions.map((v) => v.id));
	const own = (x: { variant_id: string }) => declared.size === 0 || declared.has(x.variant_id);
	const evo: EvoSeries[] = (series || []).filter((x) => !isInferred(x as { arm_inferred?: boolean }) && own(x))
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
	// Esc closes the panel wherever focus is (the map keeps focus after a click).
	useEffect(() => {
		if (!panel) return;
		const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose?.(); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [panel, onClose]);
	const loop = e.dispatch?.loop || e.loops?.[0];
	const done = criteriaInWords(e.success_criteria);
	// What the research is aiming for, when the experiment declares it.
	const rawTarget = (e.metric as { target?: unknown } | undefined)?.target;
	const target = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : null;
	const q = (e as { description?: string }).description;
	const spark = !(evolution && metric && e.comparable !== false) && evo.some((x) => x.points.length > 1) && !!metric;
	const tagOf = (id: string) => { const v = versions.find((x) => x.id === id); return v ? { text: v.tag, className: TAG_CLS[v.tag] ?? TAG_CLS.current } : null; };
	const note = comparabilityNote(e);

	const head = (
		<>
			{panel && (
				<div className="flex items-center gap-2">
					<span className="eyebrow text-plum-700">Experiment</span>
					<button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
						className="ml-auto -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900">
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}
			<div>
				<div className={cn("font-semibold text-ink-900", panel ? "text-title leading-snug" : "text-body")}>{humanId(e.id)}</div>
				{q && <div title={q} className={cn("text-ink-700", panel ? "mt-0.5 line-clamp-2 text-caption" : "text-meta")}>{q}</div>}
			</div>
			<div className={cn("flex items-start gap-1.5 font-medium leading-snug", panel ? "text-caption" : "text-meta", TONE_TEXT[st.tone])}>
				<span className={cn(dot(st.tone), "mt-[0.4em] flex-shrink-0")} />{st.text}
			</div>
			{sharedLine(e) && <p className={cn("text-plum-700", panel ? "text-caption" : "text-micro")}>{sharedLine(e)}</p>}
		</>
	);
	const chart = series === null ? (
		<div className="h-24 lumen-skeleton rounded-lg" role="status" aria-label="Loading how it evolved" />
	) : evolution && metric && e.comparable !== false ? (
		// Comparable versions: Novix's best-so-far story on one axis.
		<BestScoreChart evo={evolution} labelOf={labelOf} colorOf={colorOf} metricKey={metric} unit={m?.unit ?? ""}
			higherIsBetter={hib} minSamples={Math.max(1, e.min_samples || 1)} target={target} />
	) : spark ? (
		// Measured differently: one small chart per version, never ranked. Each
		// row names its version and state, so no separate version list follows.
		<EvolutionChart series={evo} metricKey={metric!} unit={m?.unit ?? ""} higherIsBetter={hib} tagOf={tagOf}
			comparable={false} unlabelledRuns={unlabelledRuns} alreadyMeans={!!seriesData?.runningMean} />
	) : null;
	// The versions in the order they were tried, each with its state — unless
	// the spark rows above already name each one.
	const chain = spark ? null : evolution ? (
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
	);
	const about = (
		<Wrap panel={panel}>
			<dl className="grid gap-1 text-caption">
				{e.hypothesis && e.hypothesis !== q && <div><dt className="inline text-ink-600">Expecting: </dt><dd className="inline text-ink-800">{e.hypothesis}</dd></div>}
				{m && <div><dt className="inline text-ink-600">Measures: </dt><dd className="inline text-ink-800">{m.label}{m.unit ? ` (${m.unit})` : ""} — {hib ? "higher" : "lower"} is better</dd></div>}
				{target != null && <div><dt className="inline text-ink-600">Aiming for: </dt><dd className="inline text-ink-800">{fmtMetricValue(target, m?.unit ?? "", metric || "")}{m ? ` ${m.label.toLowerCase()}` : ""}</dd></div>}
				{done && <div><dt className="inline text-ink-600">Done when: </dt><dd className="inline text-ink-800">{done}</dd></div>}
			</dl>
		</Wrap>
	);
	const links = (
		<>
			{onCompare && (
				<Button size="sm" variant="ghost" onClick={onCompare}>Compare with…</Button>
			)}
			{loop && !onCompare && (
				<Button asChild size="sm" variant={panel ? "ghost" : "secondary"}>
					<Link to={workflowPath(app, loop, { tab: "experiments" })}>Open {loopLabel("", loop)} <ArrowRight className="w-3.5 h-3.5" /></Link>
				</Button>
			)}
			<Button size="sm" variant="ghost"
				onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: `Where does the ${humanId(e.id)} experiment stand, and what should I do next?`, context: { app, loop } } }))}>
				<MessagesSquare className="w-3.5 h-3.5" /> Ask about it
			</Button>
		</>
	);

	if (panel) {
		// A side sheet: who/what/status pinned on top, the evidence scrolls, the
		// next step pinned at the foot — it never scrolls out of reach.
		return (
			<div role="dialog" aria-label={`Experiment: ${humanId(e.id)}`} style={style}
				className="absolute right-3 top-12 z-[6100] flex w-[22rem] max-w-[48%] flex-col overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e3 map-panel-in 2xl:w-[26rem]">
				<div className="space-y-1.5 border-b border-ink-100 px-3.5 pb-2.5 pt-3">{head}</div>
				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3">
					{note && <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-micro leading-relaxed text-ink-700">{note}</p>}
					{chart}
					{chain}
					<YourCall app={app} e={e} compact />
					{about}
				</div>
				<div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 bg-muted/30 px-3 py-2">
					<RunVersions app={app} e={e} />
					<div className="ml-auto flex items-center gap-0.5">{links}</div>
				</div>
			</div>
		);
	}
	return (
		<div className="rounded-xl border border-ink-200 bg-card p-3 space-y-2.5 animate-lumen-rise">
			{head}
			{note && <div className="text-caption text-ink-700">{note}</div>}
			{about}
			{chart}
			{chain}
			<YourCall app={app} e={e} />
			<RunVersions app={app} e={e} />
			<div className="flex items-center gap-2 flex-wrap pt-0.5">{links}</div>
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

// How far the approval card reaches up over the map (matches `!-mt-14`).
const DOCK_PX = 56;
// The experiment panel over the map: w-[22rem], 2xl:w-[26rem].
const PANEL_PX = 352, PANEL_PX_2XL = 416;

export default function ResearchMap({ app }: { app: string }) {
	const { data } = useResearchData(app);
	const { graph, save } = useAppGraph(app);
	// The space waits for both the spec and the experiments — or 8 s, so a slow
	// experiments read never leaves the map blank.
	const [waited, setWaited] = useState(false);
	useEffect(() => {
		setWaited(false);
		const t = window.setTimeout(() => setWaited(true), 8000);
		return () => window.clearTimeout(t);
	}, [app]);
	const mapReady = !!graph && (!!data || waited);
	const wide = useWide();
	const panelPx = useMedia("(min-width: 1536px)") ? PANEL_PX_2XL : PANEL_PX;
	const live = useShellActivity()?.runningApps.includes(app) ?? false;
	const grow = useOncePerSession(`research-map:${app}`);
	const [selected, setSelected] = useState<string | null>(null);
	const [view, setView] = useState<PanelView>("overview");
	// A/B: A is what the panel shows; B is picked on the graph (⇧-click, or
	// "Compare with…" then a click).
	const [compareB, setCompareB] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const shift = useRef(false);
	const [variantFor, setVariantFor] = useState<SpecWorkflow | "new" | null>(null);
	const [setupsFor, setSetupsFor] = useState<SpecWorkflow | null>(null);
	const [notNow, setNotNow] = useState<string[]>(() => readNotNow(app));
	const [pIndex, setPIndex] = useState(0);
	useEffect(() => { setSelected(null); setCompareB(null); setPicking(false); setNotNow(readNotNow(app)); setPIndex(0); }, [app]);
	useEffect(() => {
		const down = (e: KeyboardEvent) => { if (e.key === "Shift") shift.current = true; };
		const up = (e: KeyboardEvent) => { if (e.key === "Shift") shift.current = false; };
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
	}, []);
	// `?suggestion=<id>` (the Inbox's "See it on the map"): open on that
	// suggestion — highlighted on the map, its approval card showing.
	const [params] = useSearchParams();
	const wanted = params.get("suggestion");
	useEffect(() => {
		if (!wanted || !data) return;
		if (data.proposals.some((p) => p.id === wanted)) setSelected(`sug:${wanted}`);
	}, [wanted, data]);

	const workflows = graph?.spec.workflows ?? [];
	const groups = graph?.spec.nodes ?? [];
	const rows = graph?.rows ?? EMPTY_ROWS;
	const exps = data?.exps ?? [];
	const proposals = data?.proposals ?? [];
	const pending = proposals.filter((p) => !exps.some((e) => e.id === p.id) && !notNow.includes(p.id));

	const sideOf = useCallback((id: string | null): CompareSide | null => {
		if (!id) return null;
		const [kind, a, b] = id.split(":");
		if (kind === "wf") { const w = workflows.find((x) => x.id === a); return w ? { kind: "workflow", id: a, label: wfLabel(w) } : null; }
		if (kind === "ver") { const e = exps.find((x) => x.id === a); const v = e ? versionsOf(e).find((x) => x.id === b) : undefined; return e && v ? { kind: "version", id: b, label: `${v.label} (${humanId(e.id)})`, exp: e } : null; }
		return null;
	}, [workflows, exps]);

	const onSelect = useCallback((id: string | null, shiftClick?: boolean) => {
		// Picking B: the click names the other side instead of moving the panel.
		if (id && selected && id !== selected && (picking || shiftClick || shift.current) && sideOf(id) && sideOf(selected)) {
			setCompareB(id);
			setPicking(false);
			setView("compare");
			return;
		}
		setPicking(false);
		if (id !== selected) { setCompareB(null); setView("overview"); }
		setSelected(id);
	}, [selected, picking, sideOf]);

	if (!data && !graph) return null;
	if (workflows.length === 0 && exps.length === 0 && pending.length === 0) return null;

	const selKind = selected?.split(":")[0];
	const selWf = selKind === "wf" ? workflows.find((w) => `wf:${w.id}` === selected) : undefined;
	const selNode = selKind === "node" ? (selected === `node:${OTHER_NODE}` ? { id: OTHER_NODE as "__other", title: "Other workflows", parent: "" } : groups.find((g) => `node:${g.id}` === selected)) : undefined;
	const selExp = selKind === "exp" ? exps.find((e) => `exp:${e.id}` === selected)
		: selKind === "ver" ? exps.find((e) => e.id === selected!.split(":")[1]) : undefined;
	const selVersionSide = selKind === "ver" ? sideOf(selected) : null;
	const marks = new Map<string, "A" | "B">();
	if (compareB && selected) { marks.set(selected, "A"); marks.set(compareB, "B"); }
	// Paging the approval card re-targets the highlight on the map.
	const showProposal = (i: number) => { setPIndex(i); const p = pending[i]; if (p) setSelected(`sug:${p.id}`); };
	const dismiss = (id: string) => {
		const next = [...notNow, id];
		setNotNow(next);
		writeNotNow(app, next);
		setPIndex((i) => Math.max(0, Math.min(i, pending.length - 2)));
		setSelected(null);
	};
	const close = () => { setSelected(null); setCompareB(null); setPicking(false); };
	const editable = !!graph?.editable;
	// Clicking a workflow, node, experiment or version opens its panel OVER the
	// map, at the right edge; the camera frames the path in the space left.
	const panelOpen = wide && !!(selWf || selNode || selExp);
	const panelStyle = { bottom: 12 };
	const panel = !wide ? null : selWf && graph ? (
		<WorkflowPanel key={selWf.id} app={app} wf={selWf} spec={graph.spec} row={rows.get(selWf.id)} exps={exps}
			view={view} onView={setView} compareWith={sideOf(compareB)} onPickCompare={() => setPicking(true)}
			onMakeVariant={() => setVariantFor(selWf)} onTrySetups={() => setSetupsFor(selWf)} onSelect={(id) => onSelect(id)}
			save={save} editable={editable} onClose={close} style={panelStyle} />
	) : selNode && graph ? (
		<NodePanel key={selNode.id} app={app} node={selNode} spec={graph.spec} save={save} editable={editable} onSelect={(id) => onSelect(id)} onClose={close} style={panelStyle} />
	) : selExp && compareB && selVersionSide ? (
		// A version compared with another: the same Compare view, in the experiment's place.
		<div role="dialog" aria-label="Compare" style={panelStyle}
			className="absolute right-3 top-12 z-[6100] flex w-[22rem] max-w-[48%] flex-col overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e3 map-panel-in 2xl:w-[26rem]">
			<div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2.5">
				<span className="eyebrow text-plum-700">Compare</span>
				<button type="button" onClick={close} aria-label="Close" className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100"><X className="h-3.5 w-3.5" /></button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
				<CompareView app={app} a={selVersionSide} b={sideOf(compareB)} spec={graph?.spec} onPick={() => setPicking(true)} />
			</div>
		</div>
	) : selExp ? (
		<ExperimentDetail key={selExp.id} app={app} e={selExp} panel onClose={close} style={panelStyle}
			onCompare={selVersionSide ? () => setPicking(true) : undefined} />
	) : null;
	const mapWithPanel = (
		<div className="relative min-w-0">
			<MapCanvas app={app} exps={exps} proposals={pending} workflows={workflows} groups={groups} rows={rows} marks={marks}
				selected={selected} onSelect={onSelect} grow={grow} ready={mapReady}
				insetBottom={pending.length ? DOCK_PX : 0} insetRight={panelOpen ? panelPx + 12 : 0} />
			{picking && (
				<div role="status" className="absolute left-1/2 top-3 z-[6200] -translate-x-1/2 rounded-full border border-plum-200 bg-card px-3 py-1 text-caption text-plum-800 shadow-e2">
					Click what to compare with — a workflow, a variant or a setup ·{" "}
					<button type="button" className="underline" onClick={() => setPicking(false)}>cancel</button>
				</div>
			)}
			{panel}
		</div>
	);
	const selProposalIdx = selKind === "sug" ? pending.findIndex((p) => `sug:${p.id}` === selected) : -1;
	const updated = new Date(data?.asOf ?? Date.now()).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

	return (
		<section aria-label="Research" className={cn("space-y-2", grow && "lumen-hero-in")}>
			{/* Novix's space header: a name, Live while it works, the counts in words. */}
			<div className="flex items-center gap-2 px-0.5">
				<Sparkles className="h-3.5 w-3.5 text-plum-500" aria-hidden />
				<h2 className="whitespace-nowrap text-meta font-medium text-ink-800">Research space</h2>
				{live && <span className="inline-flex items-center gap-1 rounded-md bg-plum-50 px-1.5 py-px text-nano font-medium text-plum-700"><span className="h-1.5 w-1.5 rounded-full bg-plum-500 animate-lumen-breathe" aria-hidden />Live</span>}
				<button type="button" onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: `What should I run next in ${appTitle(app)}? Look at each workflow's recent runs, their feedback metrics and the experiments first; cite run ids. Propose the next runs (setups or variants) for my approval — start nothing.`, context: { app } } }))}
					className="hidden items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-ink-700 hover:bg-ink-100 hover:text-ink-900 lg:inline-flex">
					<MessagesSquare className="h-3 w-3" />What should I run next?
				</button>
				<span className="ml-auto min-w-0 truncate whitespace-nowrap font-mono text-nano uppercase tracking-wider text-ink-600">{mapSummary(exps, pending, workflows)}</span>
				<span className="hidden whitespace-nowrap font-mono text-nano text-ink-600 md:inline" title="When this was read">· {updated}</span>
			</div>
			{wide ? mapWithPanel : (
				<ResearchList app={app} exps={exps} onPick={setSelected} />
			)}
			{pending.length > 0 && (
				// Docked over the foot of the space, the way Novix's approval card sits.
				<div className={cn("relative z-10", wide && "!-mt-14 mx-5")} style={panelOpen ? { marginRight: panelPx + 24 } : undefined}>
					<ApprovalCard app={app} list={pending} index={selProposalIdx >= 0 ? selProposalIdx : Math.min(pIndex, pending.length - 1)}
						onIndex={showProposal} onDone={dismiss}
						// An open panel has the reader's attention: the card folds to its title.
						folded={panelOpen} onUnfold={() => setSelected(null)} />
				</div>
			)}
			{selExp && !wide && <ExperimentDetail app={app} e={selExp} />}
			{setupsFor && graph && (
				<TrySetups app={app} wf={setupsFor} spec={graph.spec} onClose={() => setSetupsFor(null)}
					onCreated={(id) => { setSetupsFor(null); setSelected(`exp:${id}`); }} />
			)}
			{variantFor && graph && <VariantSlot app={app} parent={variantFor === "new" ? undefined : variantFor} spec={graph.spec} save={save}
				onClose={() => setVariantFor(null)} onCreated={(ids) => { setVariantFor(null); if (ids[0]) setSelected(`wf:${ids[0]}`); }} />}
		</section>
	);
}

const EMPTY_ROWS = new Map<string, MeWorkflowRow>();

// The Make a variant sheet loads with its editors only when opened.
const VariantSheet = lazy(() => import("@/components/research/VariantSheet"));
function VariantSlot(props: { app: string; parent?: SpecWorkflow; spec: import("@/lib/app-spec").AppSpec; save: ReturnType<typeof useAppGraph>["save"]; onClose: () => void; onCreated: (ids: string[]) => void }) {
	return <Suspense fallback={null}><VariantSheet {...props} /></Suspense>;
}

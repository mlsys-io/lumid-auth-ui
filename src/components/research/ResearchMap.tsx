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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, FlaskConical, MessagesSquare, Sparkles, Workflow, X } from "lucide-react";
import apiClient from "@/api/client";
import { me, type MeExperiment, type MeExperimentDetail } from "@/api/me";
import EvolutionChart, { type EvoSeries } from "@/components/research/EvolutionChart";
import BestScoreChart from "@/components/research/BestScoreChart";
import VersionChain from "@/components/research/VersionChain";
import { buildEvolution } from "@/lib/evolution";
import ApprovalCard, { readNotNow, writeNotNow } from "@/components/research/ApprovalCard";
import Space3D from "@/components/research/Space3D";
import RunVersions from "@/components/research/RunVersions";
import YourCall from "@/components/research/YourCall";
import {
	buildResearchTree, comparabilityNote, criteriaInWords, experimentStatus, humanId, mapSummary, pathTo, versionsOf,
	type MapNode, type Proposal, type Tone, type VersionInfo,
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
	return (
		<div className={cn(cardBase(selected), "border-ink-300 px-3 py-2")} style={{ width: 210 }}>
			{/* Glow rings while any of the app's workflows is running. */}
			{running && <span aria-hidden className="absolute -inset-1.5 rounded-2xl ring-2 ring-lagoon-300 animate-lumen-breathe pointer-events-none" />}
			<div className="flex items-center gap-2">
				<StrandAvatar slug={app} size={28} />
				<div className="min-w-0">
					<div className="text-meta font-semibold text-ink-900 truncate">{appTitle(app)}</div>
					<div className={cn("text-micro", running ? "text-lagoon-700" : "text-ink-600")}>{running ? "Running now" : `${count} experiment${count === 1 ? "" : "s"}`}</div>
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
const VERSION_DOT: Record<string, string> = {
	winning: "bg-plum-700", leading: "bg-plum-600", current: "bg-plum-400",
	trying: "bg-plum-400", "can't tell apart": "bg-plum-300", "not run yet": "bg-card border border-dashed border-plum-400",
};

function Dot({ size, className, label, labelClass, sub, subClass, rings }: { size: number; className: string; label: string; labelClass: string; sub?: string; subClass?: string; rings?: boolean | "live" }) {
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
			<span className={cn("rounded-full ring-[3px] ring-plum-200/60", className)} style={{ width: size, height: size }} />
			<span className="absolute left-full ml-1 flex flex-col leading-tight space3d-label">
				<span className={cn("whitespace-nowrap max-w-[13rem] truncate", labelClass)}>{label}</span>
				{sub && <span className={cn("whitespace-nowrap max-w-[13rem] truncate text-nano", subClass ?? "text-ink-600")}>{sub}</span>}
			</span>
		</span>
	);
}

// ── the map ───────────────────────────────────────────────────────────────

function useViewportHeight(): number {
	const [h, setH] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
	useEffect(() => {
		const on = () => setH(window.innerHeight);
		window.addEventListener("resize", on);
		return () => window.removeEventListener("resize", on);
	}, []);
	return h;
}

function MapCanvas({ app, exps, proposals, selected, onSelect, grow, insetBottom = 0, insetRight = 0, tall = false }: {
	app: string; exps: MeExperiment[]; proposals: Proposal[];
	selected: string | null; onSelect: (id: string | null) => void; grow: boolean;
	/** Pixels the docked approval card covers at the foot of the space. */
	insetBottom?: number;
	/** Pixels the experiment panel covers at the right. */
	insetRight?: number;
	/** Room for the experiment panel: at least 560px tall. */
	tall?: boolean;
}) {
	const running = useShellActivity()?.runningApps.includes(app) ?? false;
	const tree = useMemo(() => buildResearchTree(app, exps, proposals, { workflows: true }), [app, exps, proposals]);
	const navigate = useNavigate();
	const lit = useMemo(() => (selected ? pathTo(tree.nodes, selected) : null), [tree, selected]);
	const expById = useMemo(() => new Map(exps.map((e) => [e.id, e])), [exps]);
	const propById = useMemo(() => new Map(proposals.map((p) => [p.id, p])), [proposals]);
	const versionOf = useCallback((id: string) => {
		const [, a, b] = id.split(":");
		const e = expById.get(a);
		return e ? versionsOf(e).find((v) => v.id === b) : undefined;
	}, [expById]);
	// Growth order: the app, then experiments in the order they arrived, each
	// followed by its versions — the space fills the way the research did.
	const order = useMemo(() => {
		const o = new Map<string, number>();
		tree.nodes.forEach((n, i) => o.set(n.id, n.depth === 0 ? 0 : i));
		return o;
	}, [tree]);
	const feedsOf = useCallback((loop: string) => tree.edges.filter((e) => e.source === `wf:${loop}`).length, [tree]);
	// Evidence around each version: one particle per result (log-scaled in Space3D).
	const evidence = useCallback((n: MapNode) => {
		if (n.kind !== "version") return null;
		const v = versionOf(n.id);
		if (!v || !v.n) return null;
		return { count: v.n, className: VERSION_FILL[v.tag] ?? "fill-ink-500" };
	}, [versionOf]);
	const describe = useCallback((n: MapNode): string => {
		if (n.kind === "app") return `${appTitle(app)}: ${exps.length} experiments${running ? ", running now" : ""}`;
		if (n.kind === "experiment") { const e = expById.get(n.ref); return e ? `${humanId(e.id)}: ${experimentStatus(e).text}` : n.ref; }
		if (n.kind === "version") { const v = versionOf(n.id); return v ? `${v.label}: ${v.tag}${v.tag !== "not run yet" ? `, ${v.line}` : ""}` : n.ref; }
		if (n.kind === "workflow") { const k = feedsOf(n.ref); return `Workflow ${loopLabel("", n.ref)}: feeds ${k} experiment${k === 1 ? "" : "s"} — open it`; }
		return `Suggested: ${humanId(n.ref)}`;
	}, [app, exps.length, running, expById, versionOf, feedsOf]);
	const renderCard = useCallback((n: MapNode, st: { selected: boolean }) => {
		if (n.kind === "app") return <AppCard3D app={app} running={running} count={exps.length} selected={st.selected} />;
		if (n.kind === "experiment") { const e = expById.get(n.ref); return e ? <ExperimentCard3D e={e} selected={st.selected} /> : null; }
		if (n.kind === "version") { const v = versionOf(n.id); return v ? <VersionCard3D v={v} selected={st.selected} /> : null; }
		if (n.kind === "workflow") {
			const k = feedsOf(n.ref);
			return (
				<div className={cn("rounded-lg border bg-card px-2.5 py-1.5 shadow-e1 min-w-[9rem]", st.selected ? "border-lagoon-400" : "border-ink-200")}>
					<div className="flex items-center gap-1.5 text-caption font-medium text-ink-900"><Workflow className="w-3.5 h-3.5 text-lagoon-600" aria-hidden />{loopLabel("", n.ref)}</div>
					<div className="text-micro text-ink-600">feeds {k} experiment{k === 1 ? "" : "s"} · open it</div>
				</div>
			);
		}
		const p = propById.get(n.ref);
		return p ? <SuggestedCard3D p={p} selected={st.selected} /> : null;
	}, [app, running, exps.length, expById, propById, versionOf, feedsOf]);
	const renderDot = useCallback((n: MapNode) => {
		if (n.kind === "app") return <Dot size={12} rings={running ? "live" : true} className="bg-plum-600" label={appTitle(app)} labelClass="text-meta font-semibold text-ink-900"
			sub={`${exps.length} experiment${exps.length === 1 ? "" : "s"}${running ? " · running now" : ""}`} />;
		if (n.kind === "experiment") {
			const e = expById.get(n.ref);
			const st = e ? shortStatus(e) : null;
			return <Dot size={9} className={st?.tone === "failing" ? "bg-brick-500" : "bg-plum-500"} label={e ? humanId(e.id) : n.ref} labelClass="text-caption font-medium text-ink-900"
				sub={st?.text} subClass={st?.tone === "ok" ? "text-gold-700" : st?.tone === "failing" ? "text-brick-700" : "text-ink-600"} />;
		}
		if (n.kind === "version") {
			const v = versionOf(n.id);
			// The version's state in a word when it has one worth saying.
			const tag = v && (v.tag === "winning" || v.tag === "leading" || v.tag === "can't tell apart") ? v.tag : undefined;
			return <Dot size={6} className={VERSION_DOT[v?.tag ?? "current"] ?? "bg-ink-500"} label={v?.label ?? n.ref} labelClass="text-micro text-ink-700" sub={tag} />;
		}
		if (n.kind === "workflow") {
			const k = feedsOf(n.ref);
			return <Dot size={7} className="bg-lagoon-500 !rounded-[2px] !ring-lagoon-100" label={loopLabel("", n.ref)} labelClass="text-micro font-medium text-ink-800"
				sub="workflow" subClass="text-lagoon-700" />;
		}
		return <Dot size={8} className="bg-card border border-dashed border-gold-500" label={`Suggested: ${humanId(n.ref)}`} labelClass="text-micro text-gold-700" />;
	}, [app, running, expById, versionOf, exps.length, feedsOf]);
	// The space fits the screen: what's above it (header, the app's pages,
	// compute) and the approval card under it stay on the first screen.
	const vh = useViewportHeight();
	// …and to what's in it: a two-experiment space doesn't need a tall stage.
	const fit = Math.round(Math.max(320, Math.min(600, vh - (proposals.length ? 470 : 400), 240 + tree.nodes.length * 16)));
	const height = tall ? Math.max(fit, 560) : fit;
	return (
		<Space3D nodes={tree.nodes} edges={tree.edges} renderCard={renderCard} renderDot={renderDot} describe={describe}
			selected={selected} lit={lit} grow={grow} order={order} height={height} evidence={evidence} insetBottom={insetBottom} insetRight={insetRight}
			// A workflow node opens that workflow; everything else selects in place.
			onSelect={(id) => (id?.startsWith("wf:") ? navigate(workflowPath(app, id.slice(3))) : onSelect(id))} />
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

function ExperimentDetail({ app, e, panel = false, onClose, style }: {
	app: string; e: MeExperiment;
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
	return (
		<div
			role={panel ? "dialog" : undefined} aria-label={panel ? `Experiment: ${humanId(e.id)}` : undefined}
			style={style}
			className={panel
				? "absolute right-3 top-12 z-[6100] w-[22rem] max-w-[48%] overflow-y-auto overscroll-contain rounded-xl border border-ink-200 bg-card/95 p-3.5 space-y-3 shadow-e3 backdrop-blur-sm map-panel-in"
				: "rounded-xl border border-ink-200 bg-card p-3 space-y-2.5 animate-lumen-rise"}>
			<div>
				{panel && (
					<div className="mb-1 flex items-center gap-2">
						<span className="eyebrow text-plum-700">Experiment</span>
						<button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
							className="ml-auto -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900">
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				)}
				<div className={cn("font-semibold text-ink-900", panel ? "text-title leading-snug" : "text-body")}>{humanId(e.id)}</div>
				{q && <div className={cn("text-ink-700", panel ? "text-caption mt-0.5" : "text-meta")}>{q}</div>}
			</div>
			<div className={cn("flex items-center gap-1.5 text-meta font-medium", TONE_TEXT[st.tone])}><span className={dot(st.tone)} />{st.text}</div>
			{comparabilityNote(e) && <div className="text-caption text-ink-700">{comparabilityNote(e)}</div>}
			<Wrap panel={panel}>
			<dl className="grid gap-1 text-caption">
				{e.hypothesis && e.hypothesis !== q && <div><dt className="inline text-ink-600">Expecting: </dt><dd className="inline text-ink-800">{e.hypothesis}</dd></div>}
				{m && <div><dt className="inline text-ink-600">Measures: </dt><dd className="inline text-ink-800">{m.label}{m.unit ? ` (${m.unit})` : ""} — {e.higher_is_better === false || e.metric?.higher_is_better === false ? "lower" : "higher"} is better</dd></div>}
				{target != null && <div><dt className="inline text-ink-600">Aiming for: </dt><dd className="inline text-ink-800">{fmtMetricValue(target, m?.unit ?? "", metric || "")}{m ? ` ${m.label.toLowerCase()}` : ""}</dd></div>}
				{done && <div><dt className="inline text-ink-600">Done when: </dt><dd className="inline text-ink-800">{done}</dd></div>}
			</dl>
			</Wrap>
			{series === null ? (
				<div className="h-24 lumen-skeleton rounded-lg" role="status" aria-label="Loading how it evolved" />
			) : evolution && metric && e.comparable !== false ? (
				// Comparable versions: Novix's best-so-far story on one axis.
				<BestScoreChart evo={evolution} labelOf={labelOf} colorOf={colorOf} metricKey={metric} unit={m?.unit ?? ""}
					higherIsBetter={hib} minSamples={Math.max(1, e.min_samples || 1)} target={target} />
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
			<YourCall app={app} e={e} />
			<RunVersions app={app} e={e} />
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

// How far the approval card reaches up over the map (matches `!-mt-14`).
const DOCK_PX = 56;
// The experiment panel over the map (w-[22rem]).
const PANEL_PX = 352;

export default function ResearchMap({ app, aside }: { app: string; aside?: React.ReactNode }) {
	const { data } = useResearchData(app);
	const wide = useWide();
	const live = useShellActivity()?.runningApps.includes(app) ?? false;
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

	if (!data) return aside ? <>{aside}</> : null;
	const { exps, proposals } = data;
	const pending = proposals.filter((p) => !exps.some((e) => e.id === p.id) && !notNow.includes(p.id));
	// Nothing to explore: the aside (Compute) still has something to say.
	if (exps.length === 0 && pending.length === 0) return aside ? <>{aside}</> : null;

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
	// Clicking an experiment (or one of its versions) opens its detail OVER the
	// map, at the right edge; the camera frames the path in the space left.
	const panelOpen = wide && !!selExp;
	const mapWithPanel = (
		<div className="relative min-w-0">
			<MapCanvas app={app} exps={exps} proposals={pending} selected={selected} onSelect={setSelected} grow={grow}
				insetBottom={pending.length ? DOCK_PX : 0} insetRight={panelOpen ? PANEL_PX + 12 : 0} tall={panelOpen} />
			{panelOpen && (
				<ExperimentDetail key={selExp!.id} app={app} e={selExp!} panel onClose={() => setSelected(null)}
					style={{ bottom: pending.length ? DOCK_PX + 12 : 12 }} />
			)}
		</div>
	);
	const selProposalIdx = selKind === "sug" ? pending.findIndex((p) => `sug:${p.id}` === selected) : -1;
	const updated = new Date(data.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

	return (
		<section aria-label="Research" className={cn("space-y-2", grow && "lumen-hero-in")}>
			{/* Novix's space header: a name, Live while it works, the counts in words. */}
			<div className="flex items-center gap-2 px-0.5">
				<Sparkles className="h-3.5 w-3.5 text-plum-500" aria-hidden />
				<h2 className="whitespace-nowrap text-meta font-medium text-ink-800">Research space</h2>
				{live && <span className="inline-flex items-center gap-1 rounded-md bg-plum-50 px-1.5 py-px text-nano font-medium text-plum-700"><span className="h-1.5 w-1.5 rounded-full bg-plum-500 animate-lumen-breathe" aria-hidden />Live</span>}
				<span className="hidden min-w-0 truncate text-micro text-ink-600 xl:inline">what it is exploring, and what to try next</span>
				<span className="ml-auto min-w-0 truncate whitespace-nowrap font-mono text-nano uppercase tracking-wider text-ink-600">{mapSummary(exps, pending)}</span>
				<span className="hidden whitespace-nowrap font-mono text-nano text-ink-600 md:inline" title="When this was read">· {updated}</span>
			</div>
			{wide ? (
				aside ? (
					// The map and Compute share one row: same top, same height.
					<div className="grid grid-cols-[minmax(0,1fr)_19rem] gap-4 items-stretch">
						{mapWithPanel}
						<div className="min-h-0 relative"><div className="absolute inset-0">{aside}</div></div>
					</div>
				) : mapWithPanel
			) : (
				<ResearchList app={app} exps={exps} onPick={setSelected} />
			)}
			{pending.length > 0 && (
				// Docked over the foot of the space, the way Novix's approval card sits.
				<div className={cn("relative z-10", wide && "!-mt-14 mx-5")}>
					<ApprovalCard app={app} list={pending} index={selProposalIdx >= 0 ? selProposalIdx : Math.min(pIndex, pending.length - 1)}
						onIndex={showProposal} onDone={dismiss}
						// An open experiment panel has the reader's attention: the card folds to its title.
						folded={panelOpen} onUnfold={() => setSelected(null)} />
				</div>
			)}
			{selExp && !wide && <ExperimentDetail app={app} e={selExp} />}
		</section>
	);
}

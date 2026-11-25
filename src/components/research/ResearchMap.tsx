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
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, FlaskConical, MessagesSquare, Sparkles } from "lucide-react";
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
	selected && "ring-2 ring-gold-400 shadow-e2",
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

const VERSION_DOT: Record<string, string> = {
	winning: "bg-gold-600", leading: "bg-gold-400", current: "bg-ink-500",
	trying: "bg-lagoon-500", "can't tell apart": "bg-ember-500", "not run yet": "bg-card border border-dashed border-ink-400",
};

function Dot({ size, className, label, labelClass, rings }: { size: number; className: string; label: string; labelClass: string; rings?: boolean }) {
	return (
		<span className="relative flex items-center justify-center" style={{ width: Math.max(18, size + 8), height: Math.max(18, size + 8) }}>
			{rings && (
				<>
					<span aria-hidden className="absolute rounded-full border border-gold-300 animate-lumen-breathe" style={{ width: size + 18, height: size + 18 }} />
					<span aria-hidden className="absolute rounded-full border border-gold-200" style={{ width: size + 34, height: size + 34 }} />
				</>
			)}
			<span className={cn("rounded-full shadow-e1", className)} style={{ width: size, height: size }} />
			<span className={cn("absolute left-full ml-1 whitespace-nowrap space3d-label", labelClass)}>{label}</span>
		</span>
	);
}

// ── the map ───────────────────────────────────────────────────────────────

function MapCanvas({ app, exps, proposals, selected, onSelect, grow }: {
	app: string; exps: MeExperiment[]; proposals: Proposal[];
	selected: string | null; onSelect: (id: string | null) => void; grow: boolean;
}) {
	const running = useShellActivity()?.runningApps.includes(app) ?? false;
	const tree = useMemo(() => buildResearchTree(app, exps, proposals), [app, exps, proposals]);
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
	const describe = useCallback((n: MapNode): string => {
		if (n.kind === "app") return `${appTitle(app)}: ${exps.length} experiments${running ? ", running now" : ""}`;
		if (n.kind === "experiment") { const e = expById.get(n.ref); return e ? `${humanId(e.id)}: ${experimentStatus(e).text}` : n.ref; }
		if (n.kind === "version") { const v = versionOf(n.id); return v ? `${v.label}: ${v.tag}${v.tag !== "not run yet" ? `, ${v.line}` : ""}` : n.ref; }
		return `Suggested: ${humanId(n.ref)}`;
	}, [app, exps.length, running, expById, versionOf]);
	const renderCard = useCallback((n: MapNode, st: { selected: boolean }) => {
		if (n.kind === "app") return <AppCard3D app={app} running={running} count={exps.length} selected={st.selected} />;
		if (n.kind === "experiment") { const e = expById.get(n.ref); return e ? <ExperimentCard3D e={e} selected={st.selected} /> : null; }
		if (n.kind === "version") { const v = versionOf(n.id); return v ? <VersionCard3D v={v} selected={st.selected} /> : null; }
		const p = propById.get(n.ref);
		return p ? <SuggestedCard3D p={p} selected={st.selected} /> : null;
	}, [app, running, exps.length, expById, propById, versionOf]);
	const renderDot = useCallback((n: MapNode) => {
		if (n.kind === "app") return <Dot size={14} rings className={running ? "bg-lagoon-500" : "bg-gold-600"} label={appTitle(app)} labelClass="text-meta font-semibold text-ink-900" />;
		if (n.kind === "experiment") {
			const e = expById.get(n.ref);
			const tone = e ? experimentStatus(e).tone : "idle";
			return <Dot size={10} className={TONES[tone].dot} label={e ? humanId(e.id) : n.ref} labelClass="text-caption font-medium text-ink-800" />;
		}
		if (n.kind === "version") {
			const v = versionOf(n.id);
			return <Dot size={7} className={VERSION_DOT[v?.tag ?? "current"] ?? "bg-ink-500"} label={v?.label ?? n.ref} labelClass="text-micro text-ink-700" />;
		}
		return <Dot size={8} className="bg-card border border-dashed border-gold-500" label={`Suggested: ${humanId(n.ref)}`} labelClass="text-micro text-gold-700" />;
	}, [app, running, expById, versionOf]);
	const height = Math.max(420, Math.min(620, 300 + tree.nodes.length * 9));
	return (
		<Space3D nodes={tree.nodes} edges={tree.edges} renderCard={renderCard} renderDot={renderDot} describe={describe}
			selected={selected} onSelect={onSelect} lit={lit} grow={grow} order={order} height={height} />
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
	// What the research is aiming for, when the experiment declares it.
	const rawTarget = (e.metric as { target?: unknown } | undefined)?.target;
	const target = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : null;
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
				{target != null && <div><dt className="inline text-ink-600">Aiming for: </dt><dd className="inline text-ink-800">{fmtMetricValue(target, m?.unit ?? "", metric || "")}{m ? ` ${m.label.toLowerCase()}` : ""}</dd></div>}
				{done && <div><dt className="inline text-ink-600">Done when: </dt><dd className="inline text-ink-800">{done}</dd></div>}
			</dl>
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

export default function ResearchMap({ app, aside }: { app: string; aside?: React.ReactNode }) {
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
	const selProposalIdx = selKind === "sug" ? pending.findIndex((p) => `sug:${p.id}` === selected) : -1;
	const updated = new Date(data.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

	return (
		<section aria-label="Research" className={cn("space-y-2", grow && "lumen-hero-in")}>
			<h2 className="eyebrow flex items-center gap-2">Research <span className="normal-case tracking-normal text-ink-600 font-normal">what this app is exploring, and what to try next</span></h2>
			{wide ? (
				aside ? (
					// The map and Compute share one row: same top, same height.
					<div className="grid grid-cols-[minmax(0,1fr)_19rem] gap-4 items-stretch">
						<MapCanvas app={app} exps={exps} proposals={pending} selected={selected} onSelect={setSelected} grow={grow} />
						<div className="min-h-0 relative"><div className="absolute inset-0">{aside}</div></div>
					</div>
				) : (
					<MapCanvas app={app} exps={exps} proposals={pending} selected={selected} onSelect={setSelected} grow={grow} />
				)
			) : (
				<ResearchList app={app} exps={exps} onPick={setSelected} />
			)}
			{selExp && <ExperimentDetail app={app} e={selExp} />}
			{pending.length > 0 && (
				<ApprovalCard app={app} list={pending} index={selProposalIdx >= 0 ? selProposalIdx : Math.min(pIndex, pending.length - 1)}
					onIndex={showProposal} onDone={dismiss} />
			)}
			<div className="text-nano font-mono text-ink-600">{mapSummary(exps, pending)} · updated {updated}</div>
		</section>
	);
}

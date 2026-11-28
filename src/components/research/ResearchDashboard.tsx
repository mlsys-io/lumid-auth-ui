// ResearchDashboard — the top of the Research tab (round 9, 2026-11-27):
//
//   New best on KOL alpha: Musk lean wins with Sharpe 1.42 · 2 ideas to try
//   ┌ Best results ────────┐┌ Needs you ──────────┐┌ This week ───────────┐
//   │ KOL alpha  Musk lean ││ 2 ideas to try    › ││ 23 runs ●●●●○●●  2 failed│
//   │ Sharpe 1.42 ▁▂▃▅▇    ││ Backtest failing  › ││ $4.10 spent this month │
//   └──────────────────────┘└─────────────────────┘└────────────────────────┘
//
// One sentence on what changed, then three tiles. Each tile answers one
// question in words and opens the thing it names; any tile can be hidden from
// its own ⋯ (remembered per app in this browser). Below 640 px only the
// sentence shows — the work below needs the room.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDot, Lightbulb, Sparkles } from "lucide-react";
import { me, type MeExperiment, type MeWorkflowRow } from "@/api/me";
import type { Proposal } from "@/lib/research-map";
import { humanId } from "@/lib/research-map";
import { bestResults, bestSoFar, dollars, failingWorkflows, researchHeadline, weekSummary, type BestResult } from "@/lib/research-dashboard";
import { useRunsFeed } from "@/components/activity/hooks";
import { groupActivity } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { useAppUsage } from "@/components/research/SpendLine";
import { instrumentName } from "@/lib/measure";
import { usageLine } from "@/lib/spend";

type TileId = "best" | "needs" | "week";
const TILE_TITLE: Record<TileId, string> = { best: "Best results", needs: "Needs you", week: "This week" };

const hiddenKey = (app: string) => `research-tiles-hidden:${app}`;
function readHidden(app: string): TileId[] {
	try { const v = JSON.parse(localStorage.getItem(hiddenKey(app)) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeHidden(app: string, v: TileId[]) { try { localStorage.setItem(hiddenKey(app), JSON.stringify(v)); } catch { /* private mode */ } }

const seenKey = (app: string) => `research-leaders-seen:${app}`;
function readSeen(app: string): Record<string, string> | undefined {
	try { const v = localStorage.getItem(seenKey(app)); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}

export default function ResearchDashboard({ app, exps, pending, rows, label, onSelect }: {
	app: string;
	exps: MeExperiment[];
	pending: Proposal[];
	rows: Map<string, MeWorkflowRow>;
	/** A workflow id in words. */
	label: (id: string) => string;
	/** Select a graph id ("exp:…", "wf:…", "sug:…") — opens it in the side panel. */
	onSelect: (id: string) => void;
}) {
	const [hidden, setHidden] = useState<TileId[]>(() => readHidden(app));
	useEffect(() => setHidden(readHidden(app)), [app]);
	const hide = (t: TileId) => { const next = [...new Set([...hidden, t])]; setHidden(next); writeHidden(app, next); };
	const showAll = () => { setHidden([]); writeHidden(app, []); };

	const best = useMemo(() => bestResults(exps), [exps]);
	// Why each failing workflow failed — the run feed's latest reason, with the
	// step for a chain (one shared, cached feed; WeekTile reads the same).
	const { runs } = useRunsFeed(7);
	const causes = useMemo(() => {
		const m = new Map<string, string>();
		if (runs) for (const w of groupActivity(runs, { app }).failing) if (w.failing) m.set(w.loop, w.failing.cause);
		return m;
	}, [runs, app]);
	const failing = useMemo(() => failingWorkflows(rows, label, causes), [rows, label, causes]);
	// "New" means new since this browser last looked: read the leaders seen at
	// the previous visit, then remember today's.
	const [seen] = useState(() => readSeen(app));
	useEffect(() => {
		if (!exps.length) return;
		const now: Record<string, string> = {};
		for (const b of best) now[b.select.slice(4)] = b.leader;
		try { localStorage.setItem(seenKey(app), JSON.stringify(now)); } catch { /* private mode */ }
	}, [app, best, exps.length]);
	const headline = researchHeadline({ exps, failing, ideas: pending.length, firstIdea: pending[0] ? `sug:${pending[0].id}` : undefined, seen });

	const tiles = (["best", "needs", "week"] as TileId[]).filter((t) => !hidden.includes(t));
	return (
		<div className="space-y-2">
			{(headline || hidden.length > 0) && (
				<div className="flex items-baseline gap-2 px-0.5">
					{headline && (
						<button type="button" onClick={() => headline.select && onSelect(headline.select)} disabled={!headline.select} title={headline.text}
							className={cn("min-w-0 truncate text-left text-body font-medium",
								headline.tone === "ok" ? "text-gold-800" : headline.tone === "failing" ? "text-brick-700" : "text-ink-900",
								headline.select && "hover:underline")}>
							{headline.tone === "ok" && <Sparkles className="mr-1.5 inline h-4 w-4 -translate-y-px text-gold-600" aria-hidden />}
							{headline.text}
						</button>
					)}
					{hidden.length > 0 && (
						<button type="button" onClick={showAll} className="ml-auto flex-shrink-0 whitespace-nowrap text-micro text-ink-600 hover:text-ink-900 hover:underline">
							Show {hidden.length === 3 ? "the tiles" : hidden.map((h) => TILE_TITLE[h].toLowerCase()).join(", ")}
						</button>
					)}
				</div>
			)}
			{tiles.length > 0 && (
				<div className={cn("hidden gap-2 sm:grid", tiles.length === 3 ? "sm:grid-cols-3" : tiles.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
					{tiles.includes("best") && <BestTile app={app} best={best} onSelect={onSelect} onHide={() => hide("best")} />}
					{tiles.includes("needs") && <NeedsTile pending={pending} failing={failing} onSelect={onSelect} onHide={() => hide("needs")} />}
					{tiles.includes("week") && <WeekTile app={app} rows={rows} onHide={() => hide("week")} />}
				</div>
			)}
		</div>
	);
}

function Tile({ id, onHide, children }: { id: TileId; onHide: () => void; children: React.ReactNode }) {
	const [menu, setMenu] = useState(false);
	return (
		<section aria-label={TILE_TITLE[id]} className="group relative min-w-0 rounded-xl border border-ink-200 bg-card px-3 pb-2.5 pt-2 shadow-e1">
			<div className="flex items-center">
				<h3 className="eyebrow">{TILE_TITLE[id]}</h3>
				<button type="button" aria-label={`${TILE_TITLE[id]}: more`} onClick={() => setMenu((v) => !v)}
					className="ml-auto -mr-1 inline-flex h-5 w-6 items-center justify-center rounded text-ink-600 opacity-0 hover:bg-ink-100 hover:text-ink-900 focus-visible:opacity-100 group-hover:opacity-100">⋯</button>
				{menu && (
					<div role="menu" className="absolute right-2 top-7 z-20 rounded-lg border border-ink-200 bg-popover p-1 shadow-e2" onMouseLeave={() => setMenu(false)}>
						<button type="button" role="menuitem" onClick={() => { setMenu(false); onHide(); }} className="block w-full whitespace-nowrap rounded-md px-2 py-1 text-left text-caption text-ink-800 hover:bg-ink-100">Hide this</button>
					</div>
				)}
			</div>
			<div className="mt-1">{children}</div>
		</section>
	);
}

/** The best value so far, run by run, from zero (honest axis). */
function BestLine({ values, higherIsBetter }: { values: number[]; higherIsBetter: boolean }) {
	const pts = bestSoFar(values, higherIsBetter);
	if (pts.length < 2) return null;
	const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts);
	const span = hi - lo || 1;
	const W = 96, H = 22;
	const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / span) * H).toFixed(1)}`).join(" ");
	return (
		<svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="flex-shrink-0 overflow-visible" role="img" aria-label={`Best so far over ${pts.length} results, from ${lo === 0 ? "zero" : lo}`}>
			<line x1={0} x2={W} y1={H - ((0 - lo) / span) * H} y2={H - ((0 - lo) / span) * H} className="stroke-ink-200" strokeWidth={1} />
			<path d={d} fill="none" className="stroke-gold-600" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
		</svg>
	);
}

function BestTile({ app, best, onSelect, onHide }: { app: string; best: BestResult[]; onSelect: (id: string) => void; onHide: () => void }) {
	const top = best[0];
	const [series, setSeries] = useState<number[] | null>(null);
	useEffect(() => {
		setSeries(null);
		if (!top) return;
		let live = true;
		const id = top.select.slice(4);
		me.experiment(app, id).then((d) => {
			const vid = d.best_variant;
			const s = d.series?.find((x) => x.variant_id === vid) ?? d.series?.[0];
			if (live && s) setSeries(s.points.map((p) => p.v));
		}).catch(() => {});
		return () => { live = false; };
	}, [app, top?.select, top]);
	return (
		<Tile id="best" onHide={onHide}>
			{!top ? (
				<p className="text-caption text-ink-600">No leader yet — an experiment needs results from at least two versions.</p>
			) : (
				<button type="button" onClick={() => onSelect(top.select)} className="block w-full text-left">
					<div className="truncate text-caption text-ink-700">{top.experiment}</div>
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline gap-1.5">
								<span className="truncate text-meta font-semibold text-ink-900">{top.leader}</span>
								<span className={cn("flex-shrink-0 text-micro", top.standing === "winning" ? "text-gold-700" : "text-ink-600")}>
									{top.standing === "winning" ? <><CheckCircle2 className="mr-0.5 inline h-3 w-3 -translate-y-px" aria-hidden />wins</> : top.standing === "didn't pass a step" ? `didn't pass ${top.stoppedAt ?? "a step"}` : top.standing}
								</span>
							</div>
							<div className="truncate font-mono text-caption tabular-nums text-ink-800">{top.metric} {top.valueText} <span className="font-sans text-micro text-ink-600">· {top.n} results</span></div>
						</div>
						{series && <BestLine values={series} higherIsBetter={top.higherIsBetter} />}
					</div>
					{best.length > 1 && <div className="mt-0.5 truncate text-micro text-ink-600">+{best.length - 1} more: {best.slice(1, 3).map((b) => `${b.experiment} (${b.leader})`).join(", ")}</div>}
				</button>
			)}
		</Tile>
	);
}

function NeedsTile({ pending, failing, onSelect, onHide }: { pending: Proposal[]; failing: Array<{ label: string; select: string; cause?: string }>; onSelect: (id: string) => void; onHide: () => void }) {
	const row = "flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-caption hover:bg-ink-50";
	return (
		<Tile id="needs" onHide={onHide}>
			{!pending.length && !failing.length ? (
				<p className="flex items-center gap-1.5 text-caption text-ink-700"><CheckCircle2 className="h-3.5 w-3.5 text-gold-600" aria-hidden />Nothing needs you right now.</p>
			) : (
				<div className="-mx-1 space-y-0.5">
					{pending.length > 0 && (
						<button type="button" onClick={() => onSelect(`sug:${pending[0].id}`)} className={row}>
							<Lightbulb className="h-3.5 w-3.5 flex-shrink-0 text-ember-600" aria-hidden />
							<span className="font-medium text-ink-900">{pending.length} idea{pending.length === 1 ? "" : "s"} to try</span>
							<span className="min-w-0 truncate text-ink-600">— {humanId(pending[0].id)}</span>
							<span className="ml-auto text-ink-600">›</span>
						</button>
					)}
					{failing.slice(0, pending.length ? 1 : 2).map((f) => (
						<button key={f.select} type="button" onClick={() => onSelect(f.select)} className={cn(row, f.cause && "items-start")} title={f.cause}>
							<AlertTriangle className={cn("h-3.5 w-3.5 flex-shrink-0 text-brick-600", f.cause && "mt-0.5")} aria-hidden />
							<span className="min-w-0">
								<span className="block truncate text-ink-900">{f.label} <span className="text-brick-700">is failing</span></span>
								{f.cause && <span className="block truncate text-micro text-brick-700">{f.cause}</span>}
							</span>
							<span className="ml-auto text-ink-600">›</span>
						</button>
					))}
					{failing.length > (pending.length ? 1 : 2) && <div className="px-1 text-micro text-ink-600">+{failing.length - (pending.length ? 1 : 2)} more failing</div>}
				</div>
			)}
		</Tile>
	);
}

function WeekTile({ app, rows, onHide }: { app: string; rows: Map<string, MeWorkflowRow>; onHide: () => void }) {
	// Metered compute (device-minutes first), from /me/usage; the old cents
	// field only knew LLM spend and said "No spend" over real GPU minutes.
	const spend = usageLine(useAppUsage(app), (n) => instrumentName(n).replace(/^the /, ""));
	const { runs } = useRunsFeed(7);
	const navigate = useNavigate();
	const w = weekSummary(app, runs, rows);
	return (
		<Tile id="week" onHide={onHide}>
			<button type="button" onClick={() => navigate(`/studio/runs?app=${encodeURIComponent(app)}&view=list`)} className="block w-full space-y-1 text-left" title="Open this app's runs">
				<div className="flex items-baseline gap-1.5 text-caption">
					<span className="font-semibold text-ink-900">{runs === null ? "…" : `${w.runs} run${w.runs === 1 ? "" : "s"}`}</span>
					{w.running > 0 && <span className="text-lagoon-700"><CircleDot className="mr-0.5 inline h-3 w-3 -translate-y-px" aria-hidden />{w.running} running</span>}
					{w.failed > 0 && <span className="text-brick-700">{w.failed} failed</span>}
					<span className="ml-auto text-micro text-ink-600">›</span>
				</div>
				{w.dots.length > 0 && (
					<div className="flex items-center gap-[3px]" aria-label={`The last ${w.dots.length} runs`}>
						{w.dots.map((d) => (
							<span key={d.id} title={d.state} className={cn("h-2 w-2 flex-shrink-0 rounded-sm",
								d.state === "done" ? "bg-gold-500" : d.state === "failed" ? "bg-brick-500" : d.state === "running" ? "bg-lagoon-500 animate-lumen-breathe" : "border border-ink-300")} />
						))}
					</div>
				)}
				<div className="text-micro text-ink-700">{spend ?? (w.spendCents ? `${dollars(w.spendCents)} spent this month` : "No spend recorded this month")}</div>
			</button>
		</Tile>
	);
}

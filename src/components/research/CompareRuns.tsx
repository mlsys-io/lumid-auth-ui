// CompareRuns — one place to compare 2–5 runs or versions of an app, the
// differences first (round 9). Top to bottom:
//
//   the verdict, in one sentence           "B is ahead of A on Goodput by 1.2 tok/s (8 runs each)"
//   measured differently? said here        before any number
//   the numbers                            rows = metrics, columns = sides; column 1 the baseline
//                                          (any side can be pinned), mean ± SD, change, best
//   Differences                            only the settings that differ; the rest folded
//   one small chart per metric             dots per run + a mean bar, chart-1… in order
//
// Address: /studio/apps/:app/compare?runs=<loop>:<ts>,… | ?versions=<expId>:<versionId>,…
// (&base=<i> pins the baseline). Runs read me.cycleDetail; versions read
// me.experiment(app, id).results[] — one call per experiment. Words come from
// lib/compare.ts and lib/compare-sides.ts.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Pin, Star } from "lucide-react";
import { me, type MeCycleDetail, type MeExperimentDetail } from "@/api/me";
import { compareSides, rowIsSame, type MetricRow } from "@/lib/compare";
import {
	parseCompareQuery, runSide, versionSide, metricsToCompare, settingDiffs, sameSettingsWords, sameMetricsWords, measuredDifferently,
	deltaWords, deltaIsBetter, meanWords, chartScale, mVal, distinctNames, type CompareSide, type SideRef,
} from "@/lib/compare-sides";
import { runPath } from "@/lib/run-routes";
import { humanId } from "@/lib/research-map";
import { TONES } from "@/lib/tones";
import { appTitle } from "@/components/workflow/AppCard";
import { useAppGraph } from "@/hooks/useAppGraph";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// Chart series, in the validated order (one per side; at most five sides).
const SWATCH = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;
const FILL = ["fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5"] as const;

type Loaded = { kind: "run"; ref: Extract<SideRef, { kind: "run" }>; detail: MeCycleDetail | null }
	| { kind: "version"; ref: Extract<SideRef, { kind: "version" }>; exp: MeExperimentDetail | null };

export default function CompareRuns({ app }: { app: string }) {
	const [params, setParams] = useSearchParams();
	const { refs, note } = useMemo(() => parseCompareQuery(params.toString()), [params]);
	const refsKey = refs.map((r) => (r.kind === "run" ? `r:${r.loop}:${r.ts}` : `v:${r.exp}:${r.version}`)).join(",");
	const { graph } = useAppGraph(app);
	const [loaded, setLoaded] = useState<Loaded[] | null>(null);

	useEffect(() => {
		let live = true;
		setLoaded(null);
		const exps = [...new Set(refs.filter((r) => r.kind === "version").map((r) => (r as { exp: string }).exp))];
		const expP = new Map(exps.map((id) => [id, me.experiment(app, id).catch(() => null)]));
		Promise.all(refs.map(async (r): Promise<Loaded> => r.kind === "run"
			? { kind: "run", ref: r, detail: await me.cycleDetail(app, r.loop, r.ts).catch(() => null) }
			: { kind: "version", ref: r, exp: await expP.get(r.exp)! }))
			.then((l) => { if (live) setLoaded(l); });
		return () => { live = false; };
		// refsKey stands for refs (a new array each render).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app, refsKey]);

	const wfTitle = (loop: string): string => {
		const w = graph?.spec.workflows.find((x) => x.id === loop);
		return w?.title || graph?.rows.get(loop)?.title || humanId(loop);
	};
	const sides: CompareSide[] = useMemo(() => {
		if (!loaded) return [];
		const manyExps = new Set(loaded.filter((l) => l.kind === "version").map((l) => (l as { ref: { exp: string } }).ref.exp)).size > 1;
		return distinctNames(loaded.map((l, i) => l.kind === "run"
			? runSide(l.ref, l.detail, i, wfTitle(l.ref.loop))
			: l.exp
				? versionSide(l.exp, l.ref.version, i, { workflowTitle: wfTitle, showExperiment: manyExps })
				: { key: `v:${l.ref.exp}:${l.ref.version}`, letter: "ABCDE"[i], name: humanId(l.ref.version), label: `${"ABCDE"[i]} (${humanId(l.ref.version)})`, sub: "couldn't read this experiment", values: {}, settings: [["Experiment", humanId(l.ref.exp)]] }));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loaded, graph]);

	const baseParam = Number(params.get("base") || 0);
	const base = Number.isInteger(baseParam) && baseParam >= 0 && baseParam < sides.length ? baseParam : 0;
	const pin = (i: number) => {
		const sp = new URLSearchParams(params);
		if (i === 0) sp.delete("base"); else sp.set("base", String(i));
		setParams(sp, { replace: true });
	};
	const metrics = useMemo(() => metricsToCompare(sides), [sides]);
	const cmp = useMemo(() => compareSides(sides, metrics, base, { fmt: mVal }), [sides, metrics, base]);
	const differently = useMemo(() => measuredDifferently(sides), [sides]);
	const diffs = useMemo(() => settingDiffs(sides), [sides]);
	const kind = refs.every((r) => r.kind === "run") ? "runs" : refs.every((r) => r.kind === "version") ? "versions" : "runs and versions";
	const appHref = `/studio/apps/${encodeURIComponent(app)}`;

	return (
		<div className="flex-1 min-h-0 overflow-y-auto">
			<div className="max-w-[1100px] mx-auto w-full px-4 sm:px-6 py-5 space-y-6">
				<header className="space-y-1">
					<Link to={appHref} className="inline-flex items-center gap-1 text-caption text-ink-600 hover:text-ink-900">
						<ArrowLeft className="w-3.5 h-3.5" /> {appTitle(app)}
					</Link>
					<h1 className="font-display text-h2 text-ink-900">Compare {refs.length > 1 ? `${refs.length} ` : ""}{kind}</h1>
					{note && <p role="status" className="text-meta text-ink-600">{note}</p>}
				</header>

				{refs.length < 2 ? (
					<EmptyState title="Nothing to compare yet" body="Tick two to five runs or versions, then press Compare." actionLabel={`Back to ${appTitle(app)}`} to={appHref} />
				) : !loaded ? (
					<div className="space-y-3" role="status" aria-label="Loading the comparison">
						<Skeleton className="h-7 w-2/3 rounded-lg" />
						<Skeleton className="h-40 rounded-xl" />
						<Skeleton className="h-24 rounded-xl" />
					</div>
				) : (
					<>
						<Verdict text={cmp.headline.text} tone={cmp.headline.tone} />
						{differently && (
							<p role="note" className={cn("rounded-lg border px-3 py-2 text-meta", TONES.attention.bg, TONES.attention.border, TONES.attention.text)}>
								{differently}
							</p>
						)}
						<MetricsTable sides={sides} rows={cmp.rows} base={base} onPin={pin} app={app} />
						<Differences sides={sides} diffs={diffs} base={base} />
						{cmp.rows.some((r, i) => i === 0 || !rowIsSame(r)) && <Charts sides={sides} rows={cmp.rows.filter((r, i) => i === 0 || !rowIsSame(r))} />}
					</>
				)}
			</div>
		</div>
	);
}

function Verdict({ text, tone }: { text: string; tone: "ok" | "attention" | "idle" }) {
	const t = TONES[tone];
	return (
		<p className="flex items-start gap-2 text-read sm:text-title text-ink-900 leading-snug" aria-live="polite">
			<t.Icon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", t.icon)} aria-hidden />
			<span>{text}</span>
		</p>
	);
}

function SideHead({ s, i, isBase, onPin, app }: { s: CompareSide; i: number; isBase: boolean; onPin: () => void; app: string }) {
	const run = s.key.startsWith("r:") ? s.key.slice(2) : null;
	const cut = run ? run.lastIndexOf(":") : -1;
	const href = run ? runPath(app, run.slice(0, cut), run.slice(cut + 1)) : null;
	return (
		<div className="space-y-1 min-w-[9rem]">
			<div className="flex items-center gap-1.5">
				<span aria-hidden className={cn("w-2.5 h-2.5 rounded-sm flex-shrink-0", SWATCH[i % SWATCH.length])} />
				<span className="text-caption font-semibold text-ink-900">{s.letter}</span>
				{isBase && <span className="text-nano uppercase tracking-wide text-ink-600">baseline</span>}
			</div>
			{href ? (
				<Link to={href} className="block text-caption font-medium text-ink-900 hover:underline leading-snug">{s.name}</Link>
			) : (
				<span className="block text-caption font-medium text-ink-900 leading-snug">{s.name}</span>
			)}
			<span className="block text-micro font-normal text-ink-600">{s.sub}</span>
			{!isBase && (
				<button type="button" onClick={onPin} className="inline-flex items-center gap-1 text-micro font-normal text-ink-600 hover:text-ink-900">
					<Pin className="w-3 h-3" aria-hidden /> Pin as baseline
				</button>
			)}
		</div>
	);
}

/** The baseline first, then the others in their own order. */
const columnOrder = (n: number, base: number) => [base, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== base)];

function MetricsTable({ sides, rows: allRows, base, onPin, app }: { sides: CompareSide[]; rows: MetricRow[]; base: number; onPin: (i: number) => void; app: string }) {
	const order = columnOrder(sides.length, base);
	// Differences first: rows that read the same on every side fold away
	// (the first, judged-on metric always shows).
	const [showSame, setShowSame] = useState(false);
	const same = allRows.filter((r, i) => i > 0 && rowIsSame(r));
	const rows = showSame ? allRows : allRows.filter((r, i) => i === 0 || !rowIsSame(r));
	return (
		<section aria-label="The numbers" className="space-y-2">
			<h2 className="text-meta font-semibold text-ink-800">The numbers</h2>
			<div className="rounded-xl border border-ink-200 bg-card overflow-x-auto">
				<table className="w-full text-caption">
					<thead className="bg-ink-50/60 border-b border-ink-200">
						<tr>
							<th scope="col" className="text-left align-bottom px-3 py-2.5 font-medium text-ink-700 min-w-[8rem]">Metric</th>
							{order.map((i) => (
								<th key={sides[i].key} scope="col" className="text-left align-top px-3 py-2.5">
									<SideHead s={sides[i]} i={i} isBase={i === base} onPin={() => onPin(i)} app={app} />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 && (
							<tr><td colSpan={order.length + 1} className="px-3 py-4 text-ink-600">None of these reported a number the others did, so there is nothing to put side by side.</td></tr>
						)}
						{rows.map((r) => (
							<tr key={r.metric} className="border-b border-ink-100 last:border-b-0">
								<th scope="row" className="text-left align-top px-3 py-2 font-medium text-ink-800">
									{r.label}
									<span className="block text-nano font-normal text-ink-600">{r.better === "higher" ? "higher is better" : "lower is better"}</span>
								</th>
								{order.map((i) => {
									const c = r.cells[i];
									const better = deltaIsBetter(c, r.better);
									return (
										<td key={sides[i].key} title={c.verdict?.text} className={cn("align-top px-3 py-2 tabular-nums", c.best && "bg-gold-50")}>
											{c.stats ? (
												<>
													<span className={cn("text-ink-900", c.best && "font-semibold")}>{meanWords(r.metric, c.stats)}</span>
													{c.best && <span className="ml-1 inline-flex items-center gap-0.5 text-nano text-gold-700"><Star className="w-2.5 h-2.5" aria-hidden />best</span>}
													{c.delta != null && (
														<span className={cn("block text-micro", better === true ? "text-gold-700" : better === false ? "text-brick-700" : "text-ink-600")}>
															{deltaWords(r.metric, c)}{better === true ? " better" : better === false ? " worse" : ""}
														</span>
													)}
													{c.stats.n > 1 && <span className="block text-nano text-ink-600">{c.stats.n} runs</span>}
												</>
											) : (
												<span className="text-micro text-ink-600">not reported</span>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{same.length > 0 && (
				<button type="button" onClick={() => setShowSame((v) => !v)} aria-expanded={showSame}
					className="inline-flex items-center gap-1 text-caption text-ink-600 hover:text-ink-900">
					{showSame ? "Hide the metrics that read the same" : sameMetricsWords(same.length)}
					<ChevronRight className={cn("w-3 h-3 transition-transform", showSame && "rotate-90")} aria-hidden />
				</button>
			)}
		</section>
	);
}

function Differences({ sides, diffs, base }: { sides: CompareSide[]; diffs: ReturnType<typeof settingDiffs>; base: number }) {
	const order = columnOrder(sides.length, base);
	return (
		<section aria-label="Differences" className="space-y-2">
			<h2 className="text-meta font-semibold text-ink-800">Differences</h2>
			{diffs.differ.length === 0 ? (
				<p className="text-meta text-ink-600">Every setting these report is the same.</p>
			) : (
				<div className="rounded-xl border border-ink-200 bg-card overflow-x-auto">
					<table className="w-full text-caption">
						<thead className="border-b border-ink-200">
							<tr>
								<th scope="col" className="text-left px-3 py-2 font-medium text-ink-700 min-w-[8rem]">Setting</th>
								{order.map((i) => (
									<th key={sides[i].key} scope="col" className="text-left px-3 py-2 font-medium text-ink-700">
										<span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("w-2 h-2 rounded-sm", SWATCH[i % SWATCH.length])} />{sides[i].letter}</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{diffs.differ.map((d) => (
								<tr key={d.key} className="border-b border-ink-100 last:border-b-0 align-top">
									<th scope="row" className="text-left px-3 py-2 font-medium text-ink-800">{d.key}</th>
									{order.map((i) => d.values[i]).map((v, i) => (
										<td key={i} className={cn("px-3 py-2 break-words max-w-[16rem]", v === "not reported" ? "text-ink-600" : "text-ink-900")}>{v}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{diffs.same.length > 0 && (
				<details className="group">
					<summary className="inline-flex items-center gap-1 cursor-pointer list-none text-caption text-ink-600 hover:text-ink-900">
						{sameSettingsWords(diffs.same.length)} <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" aria-hidden />
					</summary>
					<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
						{diffs.same.map((s) => (
							<div key={s.key} className="contents">
								<dt className="text-ink-600">{s.key}</dt>
								<dd className="text-ink-900 break-words min-w-0">{s.value}</dd>
							</div>
						))}
					</dl>
				</details>
			)}
		</section>
	);
}

const CHART_W = 240, CHART_H = 112, PAD_T = 8, PAD_B = 18;

function MetricChart({ sides, row }: { sides: CompareSide[]; row: MetricRow }) {
	const all: number[] = [];
	sides.forEach((s, i) => {
		const c = row.cells[i];
		all.push(...(s.values[row.metric] ?? []));
		if (c.stats) all.push(c.stats.mean);
	});
	const sc = chartScale(all);
	const y = (v: number) => PAD_T + (1 - (v - sc.lo) / (sc.hi - sc.lo || 1)) * (CHART_H - PAD_T - PAD_B);
	const colW = CHART_W / sides.length;
	const zeroY = y(Math.max(sc.lo, Math.min(sc.hi, 0)));
	const words = sides.map((s, i) => (row.cells[i].stats ? `${s.letter}: ${meanWords(row.metric, row.cells[i].stats)}` : `${s.letter}: not reported`)).join("; ");
	return (
		<figure className="rounded-xl border border-ink-200 bg-card p-3 space-y-1 min-w-0">
			<figcaption className="flex items-baseline gap-2">
				<span className="text-caption font-medium text-ink-900">{row.label}</span>
				<span className="text-nano text-ink-600">{row.better === "higher" ? "higher is better" : "lower is better"}</span>
			</figcaption>
			<svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" role="img" aria-label={`${row.label} — ${words}`}>
				<line x1={0} x2={CHART_W} y1={zeroY} y2={zeroY} className="stroke-ink-200" strokeWidth={1} />
				{sides.map((s, i) => {
					const c = row.cells[i];
					const cx = colW * i + colW / 2;
					const vals = s.values[row.metric] ?? [];
					return (
						<g key={s.key}>
							{c.stats && <rect x={cx - colW * 0.3} width={colW * 0.6} y={y(c.stats.mean) - 1.5} height={3} rx={1.5} className={FILL[i % FILL.length]} />}
							{vals.map((v, k) => {
								const jitter = vals.length > 1 ? ((k / (vals.length - 1)) - 0.5) * colW * 0.4 : 0;
								return <circle key={k} cx={cx + jitter} cy={y(v)} r={2.6} className={cn(FILL[i % FILL.length])} fillOpacity={0.55} />;
							})}
							<text x={cx} y={CHART_H - 4} textAnchor="middle" className="fill-ink-600 text-nano">{s.letter}</text>
						</g>
					);
				})}
			</svg>
			<p className="text-nano text-ink-600">
				{sc.fromZero ? "Bars are each side's average; dots are its runs." : "Bars are each side's average; dots are its runs. The scale does not start at zero (values cross it)."}
				{` ${mVal(row.metric, sc.lo)} to ${mVal(row.metric, sc.hi)}.`}
			</p>
		</figure>
	);
}

function Charts({ sides, rows }: { sides: CompareSide[]; rows: MetricRow[] }) {
	const [all, setAll] = useState(false);
	const MAX = 6;
	const shown = all ? rows : rows.slice(0, MAX);
	return (
		<section aria-label="Each metric, run by run" className="space-y-2">
			<h2 className="text-meta font-semibold text-ink-800">Each metric, run by run</h2>
			<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
				{shown.map((r) => <MetricChart key={r.metric} sides={sides} row={r} />)}
			</div>
			{rows.length > MAX && (
				<button type="button" onClick={() => setAll((v) => !v)} className="text-caption text-ink-600 hover:text-ink-900 underline-offset-2 hover:underline">
					{all ? "Show fewer charts" : `Show all ${rows.length} charts`}
				</button>
			)}
		</section>
	);
}

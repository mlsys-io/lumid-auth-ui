// CaseContentViewer — the right-canvas detail for a clicked data case, stacking
// THREE generic, data-driven sections (no app-specific knowledge):
//
//   1. SCORE TRAJECTORY — the case's score history sparkline + points (the same
//      curve the CasebookPanel row shows), so the aggregate is grounded in a
//      trend, not a single number.
//   2. SCORE PROVENANCE — the per-question breakdown behind the aggregate
//      (from me.experimentCase's `latest_by_question`, falling back to the
//      case-log records). Shows each sub-question's metric and how they average
//      to the headline %. Generic over whatever metric/questions the agent uses.
//   3. RAW CASE JSON — the seed file content (me.appDatasetFile), pretty-printed
//      and collapsible. The case→file path is resolved GENERICALLY by matching
//      the case id against the app's dataset listing (no hardcoded paths).
//
// Shown when a case row's "view data" affordance is clicked; Back returns to the
// trajectory. Distinct from CaseMapping (the per-run mapping LOG) — this is the
// case's CONTENT + provenance of its aggregate.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, FileJson, TrendingUp, ListChecks, ChevronRight } from "lucide-react";
import { me } from "@/api/me";
import { fetchCasebook, fetchCaseLog, type CasebookCase, type CaseLogRecord } from "@/api/casebook";
import { cn } from "@/lib/utils";

const tsDigits = (s?: string) => (s || "").replace(/\D/g, "");
function fmtScore(v: number): string {
	if (v >= -1 && v <= 1) return `${Math.round(v * 100)}%`;
	if (Number.isInteger(v)) return String(v);
	return String(+v.toFixed(3));
}
function num(v: unknown): string {
	if (typeof v !== "number") return String(v);
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}

// Tiny inline sparkline (mirrors CasebookPanel.Sparkline).
function Sparkline({ values, w = 120, h = 28 }: { values: number[]; w?: number; h?: number }) {
	if (values.length < 2) return null;
	const min = Math.min(...values), max = Math.max(...values), rng = max - min || 1;
	const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / rng) * (h - 4)}`);
	const last = pts[pts.length - 1].split(",");
	return (
		<svg width={w} height={h} className="overflow-visible flex-shrink-0" aria-hidden>
			<polyline points={pts.join(" ")} fill="none" stroke="rgb(176 143 69)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
			<circle cx={last[0]} cy={last[1]} r="2" fill="rgb(150 119 58)" />
		</svg>
	);
}

// Resolve the case's seed-file path GENERICALLY: scan the app's dataset listing
// for a file whose name (or stem) contains the case id / label. Returns the
// best match's path, or null when no static seed file exists (live-data apps).
async function resolveCasePath(app: string, caseId: string, label: string): Promise<string | null> {
	try {
		const { datasets } = await me.appDatasets(app);
		const needles = [caseId, label].map((s) => (s || "").toLowerCase()).filter(Boolean);
		let best: { path: string; score: number } | null = null;
		for (const g of datasets || []) {
			for (const f of g.files || []) {
				const hay = (f.path + " " + f.name).toLowerCase();
				const stem = f.name.replace(/\.[^.]+$/, "").toLowerCase();
				let s = 0;
				for (const n of needles) {
					if (stem === n) s = Math.max(s, 3);          // exact filename stem
					else if (hay.includes(n)) s = Math.max(s, 1); // substring
				}
				if (s > 0 && (!best || s > best.score)) best = { path: f.path, score: s };
			}
		}
		return best?.path ?? null;
	} catch {
		return null;
	}
}

// Pull a per-question breakdown from the experimentCase latest_by_question; fall
// back to the case-log records if no experiment rows. Returns rows of
// { question, score, metricLabel } plus the averaged aggregate.
type QRow = { question: string; score: number; metricLabel: string };
function breakdownFromQuestions(byQ: Record<string, { ts: string; metrics: Record<string, number> }>): { rows: QRow[]; avg: number | null; metricLabel: string } {
	const rows: QRow[] = [];
	// Discover the dominant numeric metric key across questions (no hardcoding).
	const counts = new Map<string, number>();
	for (const d of Object.values(byQ)) {
		for (const [k, v] of Object.entries(d.metrics || {})) {
			if (typeof v === "number") counts.set(k, (counts.get(k) || 0) + 1);
		}
	}
	let metricKey = "";
	let top = 0;
	for (const [k, c] of counts) { if (c > top) { top = c; metricKey = k; } }
	for (const [q, d] of Object.entries(byQ)) {
		const m = d.metrics || {};
		const v = typeof m[metricKey] === "number" ? m[metricKey] : Object.values(m).find((x) => typeof x === "number");
		if (typeof v === "number") rows.push({ question: q, score: v, metricLabel: metricKey || "score" });
	}
	rows.sort((a, b) => a.question.localeCompare(b.question));
	const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null;
	return { rows, avg, metricLabel: metricKey || "score" };
}

export default function CaseContentViewer({ app, loop, expId, caseId, caseLabel, atTs, onBack }: {
	app: string; loop: string; expId?: string; caseId: string; caseLabel: string; atTs?: string; onBack: () => void;
}) {
	const [book, setBook] = useState<CasebookCase | null | undefined>(undefined); // undefined=loading, null=not found
	const [byQ, setByQ] = useState<Record<string, { ts: string; metrics: Record<string, number> }> | null>(null);
	const [logRows, setLogRows] = useState<CaseLogRecord[] | null>(null);
	const [path, setPath] = useState<string | null | undefined>(undefined);
	const [fileText, setFileText] = useState<string | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	const [rawOpen, setRawOpen] = useState(false);

	// The case's score history (for the trajectory section).
	useEffect(() => {
		let live = true;
		setBook(undefined);
		fetchCasebook(app, loop)
			.then((b) => { if (live) setBook((b.cases ?? []).find((c) => c.id === caseId) ?? null); })
			.catch(() => { if (live) setBook(null); });
		return () => { live = false; };
	}, [app, loop, caseId]);

	// Provenance: per-question scores. Prefer experiment rows (richest); always
	// also pull the case-log as a fallback so a non-experiment app still gets a
	// breakdown.
	useEffect(() => {
		let live = true;
		setByQ(null); setLogRows(null);
		if (expId) {
			me.experimentCase(app, expId, caseId)
				.then((r) => { if (live) setByQ(r.latest_by_question || {}); })
				.catch(() => { if (live) setByQ({}); });
		} else {
			setByQ({});
		}
		fetchCaseLog(app, loop, caseId).then((r) => { if (live) setLogRows(r); }).catch(() => { if (live) setLogRows([]); });
		return () => { live = false; };
	}, [app, loop, expId, caseId]);

	// Resolve + (lazily) load the raw seed file.
	useEffect(() => {
		let live = true;
		setPath(undefined); setFileText(null); setRawOpen(false);
		resolveCasePath(app, caseId, caseLabel).then((p) => { if (live) setPath(p); });
		return () => { live = false; };
	}, [app, caseId, caseLabel]);

	const loadFile = () => {
		setRawOpen((o) => !o);
		if (fileText != null || !path) return;
		setFileLoading(true);
		me.appDatasetFile(app, path)
			.then((f) => setFileText(f.content || ""))
			.catch(() => setFileText(null))
			.finally(() => setFileLoading(false));
	};

	// Score trajectory values (version-aware cut, like CaseRow).
	const cut = atTs ? tsDigits(atTs) : "";
	const hist = (book?.score_history ?? []).filter((p) => !cut || tsDigits(p.ts) <= cut);
	const values = hist.map((p) => p.score);

	// Provenance breakdown — experiment questions first, else derive from the
	// case-log records' metrics (one row per record).
	const provenance = useMemo(() => {
		if (byQ && Object.keys(byQ).length > 0) return breakdownFromQuestions(byQ);
		// Fallback: build pseudo-questions from the log records (newest first).
		const rows: QRow[] = [];
		for (const r of (logRows ?? [])) {
			const m = r.metrics || {};
			const ent = Object.entries(m).find(([, v]) => typeof v === "number");
			if (ent) rows.push({ question: r.cycle_ts || r.ts || `run ${rows.length + 1}`, score: ent[1] as number, metricLabel: ent[0] });
		}
		const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null;
		return { rows: rows.slice(0, 24), avg, metricLabel: rows[0]?.metricLabel || "score" };
	}, [byQ, logRows]);

	const headline = book?.latest_score;
	const prettyRaw = useMemo(() => {
		if (fileText == null) return null;
		try { return JSON.stringify(JSON.parse(fileText), null, 2); } catch { return fileText; }
	}, [fileText]);

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<FileJson className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
						<span className="text-sm font-medium text-slate-900 truncate" title={caseId}>{caseLabel}</span>
						{typeof headline === "number" && (
							<span className="ml-auto text-[13px] font-semibold tabular-nums text-gold-700">{fmtScore(headline)}</span>
						)}
					</div>
					<div className="text-[11px] text-slate-400 mt-0.5">the case data + how its aggregate score is computed</div>
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
				{/* 1 · SCORE TRAJECTORY */}
				<section>
					<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-gold-500" /> Score trajectory</div>
					{values.length >= 2 ? (
						<div className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white px-3 py-2">
							<Sparkline values={values} />
							<div className="text-[11px] text-slate-500">
								<span className="tabular-nums text-slate-700 font-medium">{fmtScore(values[0])}</span> → <span className="tabular-nums text-slate-700 font-medium">{fmtScore(values[values.length - 1])}</span>
								<span className="text-slate-400"> · {values.length} runs</span>
							</div>
						</div>
					) : (
						<div className="text-[11px] text-slate-400 italic">{book === undefined ? "loading…" : "Only one run so far — no trend yet."}</div>
					)}
				</section>

				{/* 2 · SCORE PROVENANCE — per-question breakdown that averages to the headline */}
				<section>
					<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 flex items-center gap-1.5"><ListChecks className="w-3 h-3 text-violet-500" /> Score provenance</div>
					{byQ === null && logRows === null ? (
						<div className="text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> reading per-question scores…</div>
					) : provenance.rows.length === 0 ? (
						<div className="text-[11px] text-slate-400 italic">No per-question breakdown recorded — this case's score isn't a multi-part aggregate yet.</div>
					) : (
						<div className="rounded-lg border border-slate-200/70 bg-white overflow-hidden">
							{provenance.avg != null && (
								<div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50/50 border-b border-slate-100 text-[11px]">
									<span className="text-slate-500">avg of {provenance.rows.length} {provenance.metricLabel.replace(/_/g, " ")}</span>
									<span className="ml-auto tabular-nums font-semibold text-slate-800">= {fmtScore(provenance.avg)}</span>
									{typeof headline === "number" && Math.abs(headline - provenance.avg) > 0.01 && (
										<span className="text-[10px] text-slate-400" title="headline differs — weighted or computed on a different run">(headline {fmtScore(headline)})</span>
									)}
								</div>
							)}
							<table className="w-full text-[11px]">
								<tbody>
									{provenance.rows.map((r) => (
										<tr key={r.question} className="border-t border-slate-50 first:border-0">
											<td className="px-3 py-1.5 text-slate-500 font-mono truncate max-w-[200px]" title={r.question}>{r.question}</td>
											<td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{fmtScore(r.score)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				{/* 3 · RAW CASE JSON — collapsible */}
				<section>
					<button
						onClick={loadFile}
						disabled={path === null}
						className={cn(
							"w-full flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold mb-1",
							path === null ? "text-slate-300 cursor-default" : "text-slate-400 hover:text-slate-600",
						)}
					>
						<ChevronRight className={cn("w-3 h-3 transition-transform", rawOpen && "rotate-90")} />
						<FileJson className="w-3 h-3" /> Raw case data
						{path === null && <span className="ml-1 normal-case tracking-normal text-slate-300">(no seed file — live-data case)</span>}
						{path === undefined && <Loader2 className="ml-1 w-3 h-3 animate-spin" />}
					</button>
					{rawOpen && path && (
						<div className="rounded-lg border border-slate-200/70 bg-slate-50/50 px-2.5 py-2">
							{fileLoading && prettyRaw == null ? (
								<div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> reading {path}…</div>
							) : prettyRaw != null ? (
								<>
									<div className="text-[10px] text-slate-400 font-mono truncate mb-1" title={path}>{path}</div>
									<pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap max-h-80 overflow-auto">{prettyRaw.slice(0, 12000)}</pre>
								</>
							) : (
								<div className="text-[11px] text-slate-400 italic">Couldn't read this file.</div>
							)}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

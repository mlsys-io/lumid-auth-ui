// TrajectoryLogView — the WITHIN-RUN transcript of a single run, as a readable
// log. Distinct from TrajectoryGraph (the cross-run variant tree): this surfaces
// one run's step-by-step turns — analyst↔judge LLM exchanges and per-step / stage
// events — in chronological order, so the operator can read what actually happened
// inside the run. Backed by the existing cycle-log endpoint
// (GET /me/apps/:app/cycle-log via fetchCycleConversation).
//
// Generic: it renders whatever rows the run logged (event = llm | stage | tool |
// branch | …) with no per-app assumptions. Graceful empty state when a run has no
// log (older runs, or apps that don't stream their conversation).

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, ChevronLeft, ChevronRight, Cpu, Layers, Bot } from "lucide-react";
import { fetchCycleConversation, type CycleLogRow } from "@/api/trajectory";
import apiClient from "@/api/client";
import { cn } from "@/lib/utils";

function fmtWhen(ts?: string): string {
	if (!ts) return "";
	let m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function cycleDate(ts?: string): string {
	if (!ts) return "";
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return ts;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// One log row → a readable block. LLM turns show prompt + response (+ thinking);
// stage/tool/other events show a compact one-liner.
function LogRow({ r }: { r: CycleLogRow }) {
	const ev = (r.event || "").toLowerCase();
	if (ev === "llm") {
		return (
			<li className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 space-y-1.5">
				<div className="flex items-center gap-1.5 text-[10px] text-slate-400">
					<Cpu className="w-3 h-3 text-violet-500" />
					<span className="uppercase tracking-wide font-semibold">{r.model || "llm"}</span>
					{r.variant_id && <span className="font-mono">· {r.variant_id}</span>}
					{r.stage && <span>· {r.stage}</span>}
					{r.partial && <span className="text-amber-500">· streaming…</span>}
					<span className="ml-auto tabular-nums">{fmtWhen(r.ts)}</span>
				</div>
				{r.prompt && (
					<div>
						<div className="text-[9px] uppercase tracking-wide text-slate-400 mb-0.5">prompt</div>
						<div className="text-[11px] text-slate-600 leading-snug whitespace-pre-wrap max-h-32 overflow-y-auto">{String(r.prompt).slice(0, 2000)}</div>
					</div>
				)}
				{r.thinking && (
					<div>
						<div className="text-[9px] uppercase tracking-wide text-slate-400 mb-0.5">thinking</div>
						<div className="text-[11px] text-slate-400 italic leading-snug whitespace-pre-wrap max-h-24 overflow-y-auto">{String(r.thinking).slice(0, 1200)}</div>
					</div>
				)}
				{r.response && (
					<div>
						<div className="text-[9px] uppercase tracking-wide text-gold-600 mb-0.5">response</div>
						<div className="text-[11px] text-slate-700 leading-snug whitespace-pre-wrap max-h-40 overflow-y-auto">{String(r.response).slice(0, 3000)}</div>
					</div>
				)}
			</li>
		);
	}
	// Non-LLM event — compact one-liner.
	const Icon = ev === "stage" ? Layers : ev === "branch" ? Bot : MessageSquare;
	const text = r.note || r.status || r.stage || r.event || "event";
	return (
		<li className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500">
			<Icon className="w-3 h-3 text-slate-400 flex-shrink-0" />
			<span className="uppercase tracking-wide text-[9px] text-slate-400 font-semibold">{r.event || "event"}</span>
			<span className="truncate" title={text}>{text}</span>
			{r.stage && r.event !== "stage" && <span className="text-slate-300">· {r.stage}</span>}
			<span className="ml-auto tabular-nums text-slate-300">{fmtWhen(r.ts)}</span>
		</li>
	);
}

export default function TrajectoryLogView({ app, loop, ts, onBack }: {
	app: string; loop: string; ts?: string; onBack: () => void;
}) {
	// The run to show. When no ts is pinned, default to the newest cycle.
	const [cycles, setCycles] = useState<Array<{ ts: string }> | null>(null);
	const [idx, setIdx] = useState(0);
	const [rows, setRows] = useState<CycleLogRow[] | null>(null);
	const [running, setRunning] = useState(false);

	useEffect(() => {
		let live = true;
		apiClient.get(`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=20`)
			.then((r) => {
				const cs = ((r.data?.data?.cycles ?? []) as Array<{ ts: string }>)
					.filter((c) => c.ts).sort((a, b) => b.ts.localeCompare(a.ts));
				if (!live) return;
				setCycles(cs);
				const at = ts ? cs.findIndex((c) => c.ts === ts) : -1;
				setIdx(at >= 0 ? at : 0);
			})
			.catch(() => { if (live) setCycles([]); });
		return () => { live = false; };
	}, [app, loop, ts]);

	const curTs = cycles?.[idx]?.ts;
	useEffect(() => {
		if (!curTs) { setRows(curTs === undefined ? null : []); return; }
		let live = true;
		setRows(null);
		fetchCycleConversation(app, loop, curTs)
			.then((r) => { if (live) { setRows(r.rows); setRunning(r.running); } })
			.catch(() => { if (live) setRows([]); });
		return () => { live = false; };
	}, [app, loop, curTs]);

	const total = cycles?.length ?? 0;

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<MessageSquare className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
					<span className="text-sm font-medium text-slate-900">Trajectory log</span>
					{running && <span className="inline-flex items-center gap-1 text-[10px] text-sky-600"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" /> live</span>}
				</div>
				{total > 0 && (
					<div className="ml-auto flex items-center gap-1 flex-shrink-0">
						<button type="button" disabled={idx >= total - 1} onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
							className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-slate-100 text-slate-500" title="older run"><ChevronLeft className="w-3.5 h-3.5" /></button>
						<span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap" title={curTs}>{cycleDate(curTs)} · {idx + 1}/{total}</span>
						<button type="button" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
							className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-slate-100 text-slate-500" title="newer run"><ChevronRight className="w-3.5 h-3.5" /></button>
					</div>
				)}
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{rows === null ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading run transcript…</div>
				) : rows.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400">
						<MessageSquare className="w-6 h-6 text-slate-300" />
						<div className="text-sm text-slate-500">No transcript for this run.</div>
						<div className="text-xs max-w-xs">This run didn't stream a conversation log — its step outputs are in the run's pipeline (open a node's "details").</div>
					</div>
				) : (
					<ul className={cn("space-y-1.5")}>
						{rows.map((r, i) => <LogRow key={`${r.ts}-${i}`} r={r} />)}
					</ul>
				)}
			</div>
		</div>
	);
}

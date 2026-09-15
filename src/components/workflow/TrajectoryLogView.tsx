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

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, ChevronLeft, ChevronRight, Cpu, Layers, Bot } from "lucide-react";
import { fetchCycleConversation, type CycleLogRow } from "@/api/trajectory";
import apiClient from "@/api/client";
import { cn } from "@/lib/utils";
import RunLogSearch from "@/components/workflow/RunLogSearch";
import { L } from "@/components/workflow/labels";

// A deep link can carry either form of run id: the cycle-dir id every log/detail
// surface parses ("20260906T105726Z"), or the run store's UNIX SECONDS, which is
// what me://app-data?tool=runs reports as `run_ts` and what an app surface's
// row_href therefore interpolates (`?cycle=1788663446`). Those never compared
// equal, so opening a specific run from a table silently fell back to the NEWEST
// run — which is how a submit and its poll became indistinguishable. Mirrors
// runTsToCycleID in lumid_identity/internal/handler/me_cycle_db_fallback.go:
// below ~1971 is not a unix second, so it is left alone rather than rendered
// as a 1970 date.
export function toCycleId(ts?: string): string {
	if (!ts) return "";
	if (/^[0-9]{8}T[0-9]{6}Z/.test(ts)) return ts;
	if (/^[0-9]+(\.[0-9]+)?$/.test(ts)) {
		const n = Math.floor(Number(ts));
		if (n >= 31_536_000) return new Date(n * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
	}
	return ts;
}

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
function LogRow({ r, highlighted, rowRef }: { r: CycleLogRow; highlighted?: boolean; rowRef?: (el: HTMLLIElement | null) => void }) {
	const ev = (r.event || "").toLowerCase();
	const hl = highlighted ? "ring-2 ring-gold-400/70" : "";
	if (ev === "llm") {
		return (
			<li ref={rowRef} className={cn("rounded-lg border border-slate-200/70 bg-white px-3 py-2 space-y-1.5", hl)}>
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
						<div className="text-[11px] text-slate-600 leading-snug whitespace-pre-wrap break-words">{String(r.prompt).slice(0, 2000)}</div>
					</div>
				)}
				{r.thinking && (
					<div>
						<div className="text-[9px] uppercase tracking-wide text-slate-400 mb-0.5">thinking</div>
						<div className="text-[11px] text-slate-400 italic leading-snug whitespace-pre-wrap break-words">{String(r.thinking).slice(0, 1200)}</div>
					</div>
				)}
				{r.response && (
					<div>
						<div className="text-[9px] uppercase tracking-wide text-gold-600 mb-0.5">response</div>
						<div className="text-[11px] text-slate-700 leading-snug whitespace-pre-wrap break-words">{String(r.response).slice(0, 3000)}</div>
					</div>
				)}
			</li>
		);
	}
	// Non-LLM event — compact one-liner.
	const Icon = ev === "stage" ? Layers : ev === "branch" ? Bot : MessageSquare;
	const text = r.note || r.status || r.stage || r.event || "event";
	return (
		<li ref={rowRef} className={cn("flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 rounded-lg", hl)}>
			<Icon className="w-3 h-3 text-slate-400 flex-shrink-0" />
			<span className="uppercase tracking-wide text-[9px] text-slate-400 font-semibold">{r.event || "event"}</span>
			<span className="truncate" title={text}>{text}</span>
			{r.stage && r.event !== "stage" && <span className="text-slate-300">· {r.stage}</span>}
			<span className="ml-auto tabular-nums text-slate-300">{fmtWhen(r.ts)}</span>
		</li>
	);
}

export default function TrajectoryLogView({ app, loop, ts, onBack, backLabel }: {
	app: string; loop: string; ts?: string; onBack: () => void; backLabel?: string;
}) {
	// The run to show. When no ts is pinned, default to the newest cycle.
	const [cycles, setCycles] = useState<Array<{ ts: string }> | null>(null);
	const [idx, setIdx] = useState(0);
	const [rows, setRows] = useState<CycleLogRow[] | null>(null);
	const [running, setRunning] = useState(false);
	// Why the transcript is empty, when the server knows. Identity already
	// distinguishes "nothing was said" from "the cycle volume is unreachable"
	// (unavailableReason on the cycle-log handler); this surface used to drop
	// that field and render both as "No transcript for this run."
	const [why, setWhy] = useState<string>("");
	const [listFailed, setListFailed] = useState(false);
	// WS-6 — a matched search row to scroll to + briefly highlight.
	const [hlIndex, setHlIndex] = useState<number | null>(null);
	const rowEls = useRef<Map<number, HTMLLIElement>>(new Map());
	const jumpTo = (index: number) => {
		setHlIndex(index);
		rowEls.current.get(index)?.scrollIntoView({ behavior: "smooth", block: "center" });
		window.setTimeout(() => setHlIndex((cur) => (cur === index ? null : cur)), 2400);
	};

	useEffect(() => {
		let live = true;
		// A BOUNDED wait. `rows === null` is the spinner, and a request that never
		// settles (proxy hold, token refresh stall) leaves it there with nothing
		// on screen to act on. After this, the view states what happened and
		// names the run instead of spinning indefinitely.
		let settled = false;
		const timer = window.setTimeout(() => {
			if (!live || settled) return;
			setListFailed(true);
			setCycles([]);
		}, 15_000);
		apiClient.get(`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=20`)
			.then((r) => {
				const cs = ((r.data?.data?.cycles ?? []) as Array<{ ts: string }>)
					.filter((c) => c.ts).sort((a, b) => b.ts.localeCompare(a.ts));
				settled = true;
				if (!live) return;
				window.clearTimeout(timer);
				setListFailed(false);
				setCycles(cs);
				const want = toCycleId(ts);
				const at = want ? cs.findIndex((c) => c.ts === want) : -1;
				setIdx(at >= 0 ? at : 0);
			})
			.catch(() => {
				settled = true;
				if (!live) return;
				window.clearTimeout(timer);
				setListFailed(true);
				setCycles([]);
			});
		return () => { live = false; window.clearTimeout(timer); };
	}, [app, loop, ts]);

	const curTs = cycles?.[idx]?.ts;
	useEffect(() => {
		// `rows === null` means LOADING, and it is the only thing that renders the
		// spinner — so it must be reachable only while something is actually in
		// flight. The old guard mapped the no-cycle case (curTs === undefined) to
		// null and the impossible empty-string case to [], which is backwards: an
		// app whose /me/cycles came back empty — every app on a cloud pod before
		// the run-store fallback landed, and any app still missing from it — sat
		// on "Loading run transcript…" forever, with no timeout and no error.
		if (cycles === null) { setRows(null); return; }   // list still loading
		if (!curTs) {
			setRows([]);
			setWhy(listFailed
				? "Couldn't load this loop's run list. The run may still exist — reopen the run tree and try again."
				: "This loop has no recorded runs to read a transcript from.");
			return;
		}
		let live = true;
		setRows(null);
		setWhy("");
		fetchCycleConversation(app, loop, curTs)
			.then((r) => { if (live) { setRows(r.rows); setRunning(r.running); setWhy(r.unavailable || ""); } })
			.catch(() => {
				if (!live) return;
				setRows([]);
				setWhy("Couldn't load this run's transcript.");
			});
		return () => { live = false; };
	}, [app, loop, curTs, cycles, listFailed]);

	const total = cycles?.length ?? 0;

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> {backLabel || L.runTree.text}</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<MessageSquare className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
					<span className="text-sm font-medium text-slate-900" title={L.runLog.tip}>{L.runLog.text}</span>
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

			{/* WS-6 — grep this run's transcript + errors. */}
			{curTs && (
				<div className="px-3 py-2 border-b border-slate-100 flex-shrink-0">
					<RunLogSearch app={app} loop={loop} ts={curTs} onJump={(i) => jumpTo(i)} compact />
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{rows === null ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading run transcript…</div>
				) : rows.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400">
						<MessageSquare className="w-6 h-6 text-slate-300" />
						<div className="text-sm text-slate-500">No transcript for this run.</div>
						{/* The server's own reason when it has one — "nothing was said" and
						    "the cycle volume is not mounted on this pod" are opposite facts
						    that used to render as the same sentence. */}
						<div className="text-xs max-w-xs">{why || "This run didn't stream a conversation log — its step outputs are in the run's pipeline (open a node's \"details\")."}</div>
						{/* An identifier to quote in a bug report. Without it the empty
						    state names nothing the reader can search for. */}
						{curTs && <div className="text-[10px] font-mono text-slate-300 mt-1">{app} · {loop} · {curTs}</div>}
					</div>
				) : (
					<ul className={cn("space-y-1.5")}>
						{rows.map((r, i) => (
							<LogRow key={`${r.ts}-${i}`} r={r} highlighted={hlIndex === i}
								rowRef={(el) => { if (el) rowEls.current.set(i, el); else rowEls.current.delete(i); }} />
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

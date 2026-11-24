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

// A deep link can carry either form of run id (cycle-dir id or unix seconds);
// toCycleId normalises both. It lives in @/lib/cycle-id so me.cycleDetail can
// use it; re-exported here for existing importers.
export { toCycleId } from "@/lib/cycle-id";
import { toCycleId } from "@/lib/cycle-id";

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
			<li ref={rowRef} className={cn("rounded-lg border border-ink-200/70 bg-card px-3 py-2 space-y-1.5", hl)}>
				<div className="flex items-center gap-1.5 text-nano text-ink-600">
					<Cpu className="w-3 h-3 text-plum-600" />
					<span className="uppercase tracking-wide font-semibold">{r.model || "llm"}</span>
					{r.variant_id && <span className="font-mono">· {r.variant_id}</span>}
					{r.stage && <span>· {r.stage}</span>}
					{r.partial && <span className="text-ember-600">· streaming…</span>}
					<span className="ml-auto tabular-nums">{fmtWhen(r.ts)}</span>
				</div>
				{r.prompt && (
					<div>
						<div className="text-nano uppercase tracking-wide text-ink-600 mb-0.5">prompt</div>
						<div className="text-micro text-ink-600 leading-snug whitespace-pre-wrap break-words">{String(r.prompt).slice(0, 2000)}</div>
					</div>
				)}
				{r.thinking && (
					<div>
						<div className="text-nano uppercase tracking-wide text-ink-600 mb-0.5">thinking</div>
						<div className="text-micro text-ink-600 italic leading-snug whitespace-pre-wrap break-words">{String(r.thinking).slice(0, 1200)}</div>
					</div>
				)}
				{r.response && (
					<div>
						<div className="text-nano uppercase tracking-wide text-gold-700 mb-0.5">response</div>
						<div className="text-micro text-ink-700 leading-snug whitespace-pre-wrap break-words">{String(r.response).slice(0, 3000)}</div>
					</div>
				)}
			</li>
		);
	}
	// Non-LLM event — compact one-liner.
	const Icon = ev === "stage" ? Layers : ev === "branch" ? Bot : MessageSquare;
	const text = r.note || r.status || r.stage || r.event || "event";
	return (
		<li ref={rowRef} className={cn("flex items-center gap-2 px-3 py-1.5 text-micro text-ink-600 rounded-lg", hl)}>
			<Icon className="w-3 h-3 text-ink-600 flex-shrink-0" />
			<span className="uppercase tracking-wide text-nano text-ink-600 font-semibold">{r.event || "event"}</span>
			<span className="truncate" title={text}>{text}</span>
			{r.stage && r.event !== "stage" && <span className="text-ink-600">· {r.stage}</span>}
			<span className="ml-auto tabular-nums text-ink-600">{fmtWhen(r.ts)}</span>
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
		<div className="h-full flex flex-col rounded-xl border border-ink-200 bg-card overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-ink-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-caption text-ink-600 hover:text-ink-900 px-2 py-1 -ml-1 rounded-lg hover:bg-ink-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> {backLabel || L.runTree.text}</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<MessageSquare className="w-3.5 h-3.5 text-plum-600 flex-shrink-0" />
					<span className="text-sm font-medium text-ink-900" title={L.runLog.tip}>{L.runLog.text}</span>
					{running && <span className="inline-flex items-center gap-1 text-nano text-lagoon-600"><span className="w-1.5 h-1.5 rounded-full bg-lagoon-500 animate-pulse" /> live</span>}
				</div>
				{total > 0 && (
					<div className="ml-auto flex items-center gap-1 flex-shrink-0">
						<button type="button" disabled={idx >= total - 1} onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
							className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-ink-100 text-ink-600" title="older run"><ChevronLeft className="w-3.5 h-3.5" /></button>
						<span className="text-nano text-ink-600 tabular-nums whitespace-nowrap" title={curTs}>{cycleDate(curTs)} · {idx + 1}/{total}</span>
						<button type="button" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
							className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-ink-100 text-ink-600" title="newer run"><ChevronRight className="w-3.5 h-3.5" /></button>
					</div>
				)}
			</div>

			{/* WS-6 — grep this run's transcript + errors. */}
			{curTs && (
				<div className="px-3 py-2 border-b border-ink-100 flex-shrink-0">
					<RunLogSearch app={app} loop={loop} ts={curTs} onJump={(i) => jumpTo(i)} compact />
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{rows === null ? (
					<div className="h-full flex items-center justify-center text-xs text-ink-600"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading run transcript…</div>
				) : rows.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-ink-600">
						<MessageSquare className="w-6 h-6 text-ink-600" />
						<div className="text-sm text-ink-600">No transcript for this run.</div>
						{/* The server's own reason when it has one — "nothing was said" and
						    "the cycle volume is not mounted on this pod" are opposite facts
						    that used to render as the same sentence. */}
						<div className="text-xs max-w-xs">{why || "This run didn't stream a conversation log — its step outputs are in the run's pipeline (open a node's \"details\")."}</div>
						{/* An identifier to quote in a bug report. Without it the empty
						    state names nothing the reader can search for. */}
						{curTs && <div className="text-nano font-mono text-ink-600 mt-1">{app} · {loop} · {curTs}</div>}
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

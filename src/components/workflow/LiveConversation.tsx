// LiveConversation — connect to a (running) cycle's session and show its
// conversation, subagent/tool-style: the AI generation (LLM prompt→response
// turns) interleaved with the stage/tool events, polled live while the run is
// in flight. This is "open the running session" — the cycle is an autonomous
// agent session, rendered like the chat's own tool/subagent thread.

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Bot, Wrench, ChevronRight, AlertCircle } from "lucide-react";
import { fetchCycleConversation, type CycleLogRow } from "@/api/trajectory";
import { cn } from "@/lib/utils";

function whenShort(ts?: string): string {
	if (!ts) return "";
	const m = ts.match(/(\d{2}):(\d{2}):(\d{2})/);
	return m ? `${m[1]}:${m[2]}:${m[3]}` : "";
}

function LlmTurn({ r }: { r: CycleLogRow }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2">
			<button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-1.5 text-left">
				<Bot className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
				<span className="text-[11px] font-medium text-violet-700">AI · {r.model || "llm"}</span>
				<span className="text-[10px] text-slate-400 ml-auto tabular-nums">{whenShort(r.ts)}</span>
				<ChevronRight className={cn("w-3 h-3 text-slate-400 transition-transform", open && "rotate-90")} />
			</button>
			{/* The response is the AI generation — shown by default, clamped; expand for the prompt too. */}
			<div className={cn("mt-1 text-[11.5px] text-slate-700 whitespace-pre-wrap break-words font-mono leading-snug", !open && "line-clamp-4")}>
				{r.response || <span className="italic text-slate-400">…generating…</span>}
			</div>
			{open && r.prompt && (
				<div className="mt-2 pt-2 border-t border-violet-100">
					<div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">prompt</div>
					<div className="text-[11px] text-slate-500 whitespace-pre-wrap break-words font-mono leading-snug max-h-40 overflow-y-auto">{r.prompt}</div>
				</div>
			)}
		</div>
	);
}

function StageRow({ r }: { r: CycleLogRow }) {
	const failed = r.status === "fail" || r.status === "failed";
	const detail = r.variant_id || r.note || "";
	return (
		<div className="flex items-center gap-1.5 px-2 py-1 text-[11px]">
			{failed ? <AlertCircle className="w-3 h-3 text-rose-500 flex-shrink-0" /> : <Wrench className="w-3 h-3 text-slate-400 flex-shrink-0" />}
			<span className="text-slate-600">{r.stage || r.event}</span>
			{r.status && <span className={cn("text-[10px]", failed ? "text-rose-500" : "text-slate-400")}>{r.status}</span>}
			{detail && <span className="text-slate-400 truncate">· {String(detail).slice(0, 40)}</span>}
			<span className="text-[10px] text-slate-300 ml-auto tabular-nums">{whenShort(r.ts)}</span>
		</div>
	);
}

export default function LiveConversation({ app, loop, ts, initialRunning, onClose }: {
	app: string; loop: string; ts: string; initialRunning?: boolean; onClose: () => void;
}) {
	const [rows, setRows] = useState<CycleLogRow[] | null>(null);
	const [running, setRunning] = useState(!!initialRunning);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let live = true;
		let timer: number | undefined;
		const tick = async () => {
			const { rows: r, running: run } = await fetchCycleConversation(app, loop, ts);
			if (!live) return;
			setRows(r);
			setRunning(run);
			// Keep polling only while in flight; one final fetch after it stops.
			if (run) timer = window.setTimeout(tick, 1500);
		};
		tick();
		return () => { live = false; if (timer) window.clearTimeout(timer); };
	}, [app, loop, ts]);

	// Autoscroll to the newest turn while streaming.
	useEffect(() => { if (running) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [rows, running]);

	return (
		<div className="absolute inset-0 z-30 flex animate-in fade-in duration-150">
			<button onClick={onClose} className="absolute inset-0 bg-white/50 backdrop-blur-[2px] cursor-zoom-out" aria-label="Close" />
			<div className="relative ml-auto h-full w-full sm:w-[68%] max-w-2xl bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-in slide-in-from-right-4 duration-300">
				<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
					<Bot className="w-4 h-4 text-violet-500" />
					<span className="text-sm font-medium text-slate-900">Session conversation</span>
					{running ? (
						<span className="inline-flex items-center gap-1 text-[11px] text-sky-600"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 running-glow" /> live</span>
					) : (
						<span className="text-[11px] text-slate-400">finished</span>
					)}
					<button onClick={onClose} className="ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="w-4 h-4" /></button>
				</div>
				<div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
					{rows === null ? (
						<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting to the session…</div>
					) : rows.length === 0 ? (
						<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400">
							<Bot className="w-6 h-6 text-slate-300" />
							<div className="text-sm text-slate-500">{running ? "Session starting…" : "No conversation captured for this run."}</div>
							{running && <div className="text-xs max-w-xs">AI turns + steps will stream in as the run executes.</div>}
						</div>
					) : (
						rows.map((r, i) => r.event === "llm" ? <LlmTurn key={i} r={r} /> : <StageRow key={i} r={r} />)
					)}
					{running && rows && rows.length > 0 && (
						<div className="flex items-center gap-2 px-2 py-1 text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> working…</div>
					)}
				</div>
			</div>
		</div>
	);
}

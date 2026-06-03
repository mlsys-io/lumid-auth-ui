// CycleCard — the per-dot drill-in. Given one cycle (app/loop/ts + its
// sparkline state char), it fetches the cycle detail and tells the story
// in three beats the demo cares about:
//   • What happened  — outcome + a one-line summary of the run
//   • What it learned — the compound offers (new knowledge) this cycle produced
//   • What it fixed   — for amber (recovered) / red (failed) runs, the self-heal
//                       or the unresolved error
// Plus two actions: "Ask my AI about this run" (hands the cycle to the chat
// composer) and "Open full cycle" (the deep inspector).
//
// Used inside RunSparkline's hover/pin popover, so it's compact (w-72) and
// caches nothing itself — the parent caches by ts to keep re-hovers instant.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	CheckCircle2, MinusCircle, Clock, AlertCircle, Sparkles,
	Wrench, MessageCircleQuestion, ArrowRight, Loader2,
} from "lucide-react";
import { me, type MeCycleDetail } from "@/api/me";
import { loopLabel } from "@/pages/app-revamp/loops";

const OUTCOME: Record<string, { label: string; icon: typeof CheckCircle2; cls: string }> = {
	ran:             { label: "Ran",             icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
	no_change:       { label: "No change",       icon: MinusCircle,  cls: "border-slate-200 bg-slate-50 text-slate-600" },
	awaiting_review: { label: "Awaiting review", icon: Clock,        cls: "border-amber-200 bg-amber-50 text-amber-700" },
	no_setup:        { label: "Not set up",      icon: AlertCircle,  cls: "border-rose-200 bg-rose-50 text-rose-700" },
};

function tsToDate(ts: string): string {
	// dir-id "20260603T044249Z" → readable local time
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return ts;
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
	return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function firstError(d: MeCycleDetail): string | undefined {
	const bad = d.steps?.find((s) => !s.ok && s.error);
	return bad?.error?.split("\n")[0]?.slice(0, 160);
}

function whatHappened(d: MeCycleDetail): string {
	const err = firstError(d);
	if (err) {
		const at = d.steps?.find((s) => !s.ok && s.error)?.skill;
		return `Failed${at ? ` at ${at}` : ""}: ${err}`;
	}
	const n = d.steps?.length || 0;
	const rq = d.summary?.review_queue?.length || 0;
	switch (d.summary?.outcome) {
		case "no_change":       return "Observed the world — nothing needed doing this cycle.";
		case "awaiting_review": return `Drafted ${rq} item${rq === 1 ? "" : "s"} and held ${rq === 1 ? "it" : "them"} for your review.`;
		case "no_setup":        return "Loop isn't fully set up yet — connect its inputs to start.";
		default:                return `Completed ${n} step${n === 1 ? "" : "s"} end-to-end.`;
	}
}

export default function CycleCard({
	app, loop, ts, st, onOpenFull,
}: {
	app: string;
	loop: string;
	ts: string;
	st: string;
	onOpenFull?: () => void;
}) {
	const navigate = useNavigate();
	const [d, setD] = useState<MeCycleDetail | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		setD(null); setErr(null);
		if (!ts) { setErr("No cycle record for this run."); return; }
		me.cycleDetail(app, loop, ts)
			.then((r) => { if (live) setD(r); })
			.catch((e) => { if (live) setErr(e?.message || "Couldn't load this cycle."); });
		return () => { live = false; };
	}, [app, loop, ts]);

	const oc = (d?.summary?.outcome && OUTCOME[d.summary.outcome]) || OUTCOME.ran;
	const OcIcon = oc.icon;
	const offers = d?.summary?.offers || [];
	const fixed = st === "r";   // self-healed
	const broke = st === "x";   // unresolved failure

	const askAI = () => {
		const when = tsToDate(ts);
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: {
				prompt: `Walk me through the ${loopLabel(loop, `${app}:${loop}`)} run on ${when} — what it did, what it learned, and anything that went wrong.`,
				autosend: true,
			},
		}));
	};
	const openFull = () => {
		onOpenFull?.();
		navigate(`/studio/intents/cycle/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`);
	};

	return (
		<div className="w-72 rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-300/40 overflow-hidden text-left animate-in fade-in zoom-in-95 duration-150">
			{/* header */}
			<div className="px-3 pt-2.5 pb-2 border-b border-slate-100">
				<div className="flex items-center gap-2">
					<span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${oc.cls}`}>
						<OcIcon className="w-3 h-3" />{oc.label}
					</span>
					{fixed && (
						<span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
							<Wrench className="w-3 h-3" />self-healed
						</span>
					)}
					<span className="ml-auto text-[10px] text-slate-400">{tsToDate(ts)}</span>
				</div>
				<div className="mt-1 text-[11px] font-medium text-slate-700 truncate">{loopLabel(loop, `${app}:${loop}`)}</div>
			</div>

			{/* body */}
			<div className="px-3 py-2 space-y-2.5">
				{err ? (
					<div className="text-[11px] text-slate-500 italic py-1">{err}</div>
				) : !d ? (
					<div className="flex items-center gap-2 text-[11px] text-slate-400 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />reading the cycle…</div>
				) : (
					<>
						{/* what happened */}
						<div>
							<div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">What happened</div>
							<div className={`text-[11px] leading-snug ${broke ? "text-rose-700" : "text-slate-600"}`}>{whatHappened(d)}</div>
						</div>

						{/* what it learned */}
						<div>
							<div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
								<Sparkles className="w-3 h-3 text-indigo-400" />What it learned
							</div>
							{offers.length > 0 ? (
								<ul className="space-y-0.5">
									{offers.slice(0, 3).map((o, i) => (
										<li key={o.id || i} className="text-[11px] text-slate-700 leading-snug flex gap-1">
											<span className="text-indigo-400">•</span>
											<span className="truncate" title={o.detail || o.title}>{o.title}</span>
										</li>
									))}
								</ul>
							) : (
								<div className="text-[11px] text-slate-400 italic">No new knowledge this cycle.</div>
							)}
						</div>

						{/* what it fixed — only when amber/red */}
						{(fixed || broke) && (
							<div>
								<div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
									<Wrench className="w-3 h-3 text-amber-500" />What it fixed
								</div>
								<div className={`text-[11px] leading-snug ${broke ? "text-rose-700" : "text-amber-700"}`}>
									{fixed
										? "A transient error (timeout / malformed reply) was caught and retried — the run completed on its own."
										: firstError(d) || "Run failed and hasn't recovered yet — open the full cycle to dig in."}
								</div>
							</div>
						)}
					</>
				)}
			</div>

			{/* actions */}
			<div className="px-2 py-1.5 border-t border-slate-100 flex items-center gap-1">
				<button type="button" onClick={askAI}
					className="flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 transition-colors">
					<MessageCircleQuestion className="w-3.5 h-3.5" />Ask my AI
				</button>
				{ts && (
					<button type="button" onClick={openFull}
						className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors">
						Full cycle<ArrowRight className="w-3 h-3" />
					</button>
				)}
			</div>
		</div>
	);
}

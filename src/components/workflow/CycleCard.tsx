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

// Process-wide cache of fetched cycle details, keyed by app:loop:ts. A cycle
// is immutable once written, so this never goes stale — re-hovering or
// re-pinning a dot is instant and fires no request.
const CYCLE_CACHE = new Map<string, MeCycleDetail>();
// In-flight de-dupe so two cards racing the same ts share one request.
const CYCLE_INFLIGHT = new Map<string, Promise<MeCycleDetail>>();

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

/* eslint-disable @typescript-eslint/no-explicit-any */
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pct = (n: number) => `${+(n * 100).toFixed(n * 100 % 1 ? 1 : 0)}%`;

function firstError(d: MeCycleDetail): string | undefined {
	const bad = d.steps?.find((s) => !s.ok && s.error);
	if (bad?.error) return bad.error.split("\n")[0].slice(0, 160);
	const se = (d.summary?.step_errors || []) as any[];
	const e0 = se[0];
	if (typeof e0 === "string") return e0.split("\n")[0].slice(0, 160);
	if (e0 && typeof e0 === "object") return String(e0.error || e0.message || JSON.stringify(e0)).slice(0, 160);
	return undefined;
}

// A trade proposal → a crisp one-liner: "long AMZN · 4% NAV · +3% / -2% · 10d (continuation)"
function proposalLine(p: any): string {
	const head = [p.verdict && p.verdict !== "propose" ? p.verdict : null, p.side, p.symbol].filter(Boolean).join(" ");
	const bits = [head];
	if (typeof p.size_pct_nav === "number") bits.push(`${pct(p.size_pct_nav)} NAV`);
	if (typeof p.target_pct === "number" && typeof p.stop_pct === "number") bits.push(`+${Math.round(p.target_pct * 100)}% / ${Math.round(p.stop_pct * 100)}%`);
	if (p.horizon_days) bits.push(`${p.horizon_days}d`);
	let s = bits.filter(Boolean).join(" · ");
	if (p.setup) s += ` (${p.setup})`;
	return s;
}

// What actually happened — mine the richest signal the cycle carries.
function whatHappened(d: MeCycleDetail): string {
	const s: any = d.summary || {};
	const err = firstError(d);
	if (err && (d.steps?.some((x) => !x.ok) || (s.step_errors || []).length)) {
		const at = d.steps?.find((x) => !x.ok && x.error)?.skill;
		return `Failed${at ? ` at ${at}` : ""}: ${err}`;
	}
	// Trade proposal / decision (auto-quant)
	const decs: any[] = Array.isArray(s.decisions) ? s.decisions : [];
	const prop = decs.map((x) => x?.proposal).find((p) => p?.symbol);
	if (prop) return cap(proposalLine(prop));
	const verdicts = decs.map((x) => x?.verdict || x?.proposal?.verdict).filter(Boolean);
	if (verdicts.length) return `Decided: ${verdicts.join(", ")}`;
	// Run KPIs (mbb-ai consulting cases)
	const m: any = s.metrics;
	if (m && typeof m === "object") {
		const bits: string[] = [];
		if (m.case_id) bits.push(`Case ${m.case_id}`);
		if (m.questions_answered) bits.push(`${m.questions_answered} questions answered`);
		if (typeof m.avg_question_score === "number" && m.avg_question_score > 0) bits.push(`avg score ${m.avg_question_score.toFixed(2)}`);
		if (typeof m.alignment_score === "number" && m.alignment_score > 0) bits.push(`alignment ${m.alignment_score.toFixed(2)}`);
		if (bits.length) return bits.join(" · ");
	}
	if (s.command_engine?.case_file) {
		const cf = String(s.command_engine.case_file).replace(/\.json$/, "").replace(/_/g, " ");
		return `Worked ${cf}`;
	}
	// Generic, but at least specific about volume + outcome
	const rq = d.summary?.review_queue?.length || 0;
	const n = s.steps_run || d.steps?.length || 0;
	switch (s.outcome) {
		case "no_change":       return "Observed its inputs — nothing actionable, so it stood pat.";
		case "awaiting_review": return `Drafted ${rq} item${rq === 1 ? "" : "s"} and held ${rq === 1 ? "it" : "them"} for your review.`;
		case "no_setup":        return "This workflow isn't fully set up yet — connect its inputs to start.";
		default:                return n ? `Ran ${n} step${n === 1 ? "" : "s"} end-to-end.` : "Completed a run.";
	}
}

// What it learned / improved — offers, self-mutation, or compounded memories.
function whatLearned(d: MeCycleDetail): { headline: string; muted?: boolean; items?: string[] } {
	const s: any = d.summary || {};
	const offers = d.summary?.offers || [];
	if (offers.length) return { headline: "", items: offers.slice(0, 3).map((o) => o.title) };
	if (s.improvement?.mutations_proposed) {
		const mut = (s.improvement.mutates || []).join(", ");
		return { headline: `Proposed a self-improvement${mut ? ` to its ${mut} logic` : ""} — queued as a PR for review.` };
	}
	const pushed = s.auto_publish?.memories
		? Object.values(s.auto_publish.memories as Record<string, { pushed?: number }>).reduce((n, v) => n + (v?.pushed || 0), 0)
		: 0;
	if (pushed > 0) return { headline: `Compounded ${pushed} new memor${pushed === 1 ? "y" : "ies"} into the knowledge graph.` };
	const ing = Number(s.metrics?.xpio_ingested || 0);
	if (ing > 0) return { headline: `Ingested ${ing} new memor${ing === 1 ? "y" : "ies"}.` };
	if (s.metrics?.auto_reflect_fired) return { headline: "Reflected on recent runs and sharpened its judgement." };
	return { headline: "Nothing new to bank — a routine run.", muted: true };
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
	const key = `${app}:${loop}:${ts}`;
	// Seed synchronously from cache so a re-visited dot renders instantly.
	const [d, setD] = useState<MeCycleDetail | null>(() => CYCLE_CACHE.get(key) || null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		const cached = CYCLE_CACHE.get(key);
		if (cached) { setD(cached); setErr(null); return; }
		setD(null); setErr(null);
		if (!ts) { setErr("No record for this run."); return; }
		// Debounce: only fetch if the dot stays active ~250ms. Scrubbing
		// across dots mounts/unmounts each card faster than that, so the
		// timer is cleared on unmount and no request goes out — only a
		// lingered-on dot actually fetches. Re-uses any in-flight request.
		const timer = window.setTimeout(() => {
			let p = CYCLE_INFLIGHT.get(key);
			if (!p) {
				p = me.cycleDetail(app, loop, ts).then((r) => { CYCLE_CACHE.set(key, r); return r; });
				CYCLE_INFLIGHT.set(key, p);
				p.finally(() => CYCLE_INFLIGHT.delete(key));
			}
			p.then((r) => { if (live) setD(r); })
			 .catch((e) => { if (live) setErr(e?.message || "Couldn't load this run."); });
		}, 250);
		return () => { live = false; window.clearTimeout(timer); };
	}, [app, loop, ts, key]);

	const oc = (d?.summary?.outcome && OUTCOME[d.summary.outcome]) || OUTCOME.ran;
	const OcIcon = oc.icon;
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
		// The inspector is merged into the app panel; deep-link straight to the
		// loop with this cycle anchored (the panel opens a stage on that run).
		navigate(`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(loop)}&cycle=${encodeURIComponent(ts)}`);
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
					<div className="flex items-center gap-2 text-[11px] text-slate-400 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />reading the run…</div>
				) : (
					<>
						{/* what happened */}
						<div>
							<div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">What happened</div>
							<div className={`text-[11px] leading-snug ${broke ? "text-rose-700" : "text-slate-600"}`}>{whatHappened(d)}</div>
						</div>

						{/* what it learned */}
						{(() => {
							const l = whatLearned(d);
							return (
								<div>
									<div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
										<Sparkles className="w-3 h-3 text-indigo-400" />What it learned
									</div>
									{l.items ? (
										<ul className="space-y-0.5">
											{l.items.map((t, i) => (
												<li key={i} className="text-[11px] text-slate-700 leading-snug flex gap-1">
													<span className="text-indigo-400">•</span>
													<span className="truncate" title={t}>{t}</span>
												</li>
											))}
										</ul>
									) : (
										<div className={`text-[11px] leading-snug ${l.muted ? "text-slate-400 italic" : "text-slate-700"}`}>{l.headline}</div>
									)}
								</div>
							);
						})()}

						{/* what it fixed — only when amber/red */}
						{(fixed || broke) && (
							<div>
								<div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
									<Wrench className="w-3 h-3 text-amber-500" />What it fixed
								</div>
								<div className={`text-[11px] leading-snug ${broke ? "text-rose-700" : "text-amber-700"}`}>
									{broke
										? (firstError(d) || "Run failed and hasn't recovered yet — open the full run to dig in.")
										: `A transient error${firstError(d) ? ` (${firstError(d)})` : " (timeout / malformed reply)"} was caught and retried — the run completed on its own.`}
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
						Full run<ArrowRight className="w-3 h-3" />
					</button>
				)}
			</div>
		</div>
	);
}

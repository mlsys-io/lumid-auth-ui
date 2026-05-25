// /studio/mind — the Improve surface (W4).
//
// Subtle by design (the directive: don't advertise compounding). Lists
// the user's installed workflows with mini report cards in plain English.
// Per-card "Why?" toggle reveals the underlying stats. No score badges,
// no leaderboards.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { me, MeApiError, type MeWorkflowRow, type MeMindStats } from "@/api/me";
import PageHints from "@/components/PageHints";
import ParallelCoordsPlot from "@/components/ParallelCoordsPlot";

interface ReportCard {
	slug: string;
	app: string;
	loop: string;
	this_month: MeMindStats;
	prev_month: MeMindStats;
	deltas: Array<{ headline: string; detail?: string; trend: "up" | "down" | "flat" }>;
}

export default function StudioMind() {
	const [workflows, setWorkflows] = useState<MeWorkflowRow[] | null>(null);
	const [cards, setCards] = useState<Record<string, ReportCard | "loading" | "error">>({});
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		(async () => {
			try {
				const r = await me.listWorkflows("scheduled");
				setWorkflows(r.workflows);
			} catch (e) {
				setErr(e instanceof MeApiError ? e.message : String(e));
			}
		})();
	}, []);

	useEffect(() => {
		if (!workflows) return;
		// Fetch report cards lazily as a small pool — many workflows
		// would saturate the server otherwise. v1 just sequential.
		(async () => {
			for (const w of workflows.slice(0, 12)) {
				setCards((prev) => ({ ...prev, [w.slug]: "loading" }));
				try {
					const r = await me.mindWorkflow(w.slug);
					setCards((prev) => ({ ...prev, [w.slug]: r as unknown as ReportCard }));
				} catch {
					setCards((prev) => ({ ...prev, [w.slug]: "error" }));
				}
			}
		})();
	}, [workflows]);

	if (err) return <div className="text-rose-700 text-sm">{err}</div>;

	return (
		<div className="space-y-4">
			<header className="space-y-1">
				<h1 className="text-lg font-semibold flex items-center gap-2">
					<Brain className="w-5 h-5 text-emerald-600" />
					Mind
				</h1>
				<p className="text-sm text-slate-500">
					How your AI is changing over time. Read at your own pace; we&apos;ll never push it.
				</p>
			</header>

			<PageHints prompts={[
				"how is my morning brief getting better?",
				"which workflow improved most this month?",
				"run an evaluation on tavily-search",
			]} />

			{workflows === null ? (
				<div className="text-sm text-slate-500 italic py-4">Loading…</div>
			) : workflows.length === 0 ? (
				<EmptyState />
			) : (
				<div className="grid gap-3 sm:grid-cols-2">
					{workflows.map((w) => (
						<ReportCardView key={w.slug} workflow={w} state={cards[w.slug]} />
					))}
				</div>
			)}

			<SkillComparison />

			<div className="pt-6 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
				<p>
					Reports above are computed from your own run history + draft accept-rate (tenant-isolated).
					Skill-level comparisons below read globally-shared attestations — reproducible across tenants because nothing personal feeds them.
				</p>
			</div>
		</div>
	);
}

function ReportCardView({
	workflow,
	state,
}: {
	workflow: MeWorkflowRow;
	state: ReportCard | "loading" | "error" | undefined;
}) {
	const [open, setOpen] = useState(false);

	if (!state || state === "loading") {
		return (
			<div className="rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
				<div className="h-3 w-32 bg-slate-200 rounded mb-2" />
				<div className="h-2 w-48 bg-slate-100 rounded" />
			</div>
		);
	}
	if (state === "error") {
		return (
			<div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 text-sm text-rose-800">
				<div className="font-medium">{workflow.name}</div>
				<div className="text-xs text-rose-600">Couldn&apos;t load the report card.</div>
			</div>
		);
	}

	// Pick the dominant trend for the card's accent color.
	const dominantTrend = state.deltas[0]?.trend || "flat";
	const accentClass =
		dominantTrend === "up" ? "from-emerald-50 to-white border-emerald-200/60" :
		dominantTrend === "down" ? "from-rose-50 to-white border-rose-200/60" :
		"from-slate-50/40 to-white border-slate-200/60";

	return (
		<div className={`rounded-xl border bg-gradient-to-br ${accentClass} p-4 hover:shadow-md hover:shadow-slate-200/50 transition-all`}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<Link
						to={`/studio/workflows/${encodeURIComponent(workflow.slug)}`}
						className="font-semibold text-slate-900 hover:text-emerald-700 transition-colors block truncate"
					>
						{workflow.name}
					</Link>
					<div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
						<span>{workflow.app}</span>
						<span className="text-slate-300">·</span>
						<span>{state.this_month.run_count} runs this month</span>
					</div>
				</div>
				{/* Big-number primary metric: success rate */}
				<div className="text-right flex-shrink-0">
					<div className="text-2xl font-semibold text-slate-900 tabular-nums leading-none">
						{Math.round(state.this_month.success_rate * 100)}<span className="text-sm text-slate-500">%</span>
					</div>
					<div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">reliable</div>
				</div>
			</div>

			<div className="mt-3 space-y-1.5">
				{state.deltas.map((d, i) => (
					<DeltaRow key={i} delta={d} />
				))}
			</div>

			<button
				onClick={() => setOpen((v) => !v)}
				className="mt-3 text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 transition-colors"
			>
				{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
				{open ? "Hide stats" : "Why?"}
			</button>

			{open && (
				<div className="mt-2 rounded-lg bg-white/80 border border-slate-200/60 px-3 py-2.5 text-[11px] grid grid-cols-2 gap-x-3 gap-y-2">
					<MiniStat label="success rate" cur={state.this_month.success_rate} prev={state.prev_month.success_rate} format={pct} betterIsHigher />
					<MiniStat label="avg duration" cur={state.this_month.avg_duration_s} prev={state.prev_month.avg_duration_s} format={(v) => `${v.toFixed(1)}s`} betterIsHigher={false} />
					{state.this_month.drafts_created ? (
						<>
							<MiniStat label="drafts made" cur={state.this_month.drafts_created} prev={state.prev_month.drafts_created || 0} format={(v) => String(Math.round(v))} betterIsHigher />
							<MiniStat label="accept rate" cur={state.this_month.draft_accept_rate || 0} prev={state.prev_month.draft_accept_rate || 0} format={pct} betterIsHigher />
						</>
					) : null}
				</div>
			)}
		</div>
	);
}

function DeltaRow({ delta }: { delta: { headline: string; detail?: string; trend: "up" | "down" | "flat" } }) {
	const Icon = delta.trend === "up" ? TrendingUp : delta.trend === "down" ? TrendingDown : Minus;
	const wrapperClass =
		delta.trend === "up" ? "bg-emerald-50/60 border-emerald-100 text-emerald-900" :
		delta.trend === "down" ? "bg-rose-50/60 border-rose-100 text-rose-900" :
		"bg-slate-50/60 border-slate-100 text-slate-700";
	const iconClass =
		delta.trend === "up" ? "text-emerald-600" :
		delta.trend === "down" ? "text-rose-600" :
		"text-slate-400";
	return (
		<div className={`flex items-start gap-2 text-xs leading-relaxed rounded-lg px-2.5 py-1.5 border ${wrapperClass}`}>
			<Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${iconClass}`} />
			<div className="min-w-0 flex-1">
				<div>{delta.headline}</div>
				{delta.detail && <div className="text-[11px] opacity-70 mt-0.5">{delta.detail}</div>}
			</div>
		</div>
	);
}

function MiniStat({
	label, cur, prev, format, betterIsHigher = true,
}: {
	label: string; cur: number; prev: number;
	format: (v: number) => string;
	betterIsHigher?: boolean;
}) {
	const diff = cur - prev;
	const sig = Math.abs(diff) > 0.001;
	const better = sig && (betterIsHigher ? diff > 0 : diff < 0);
	const worse = sig && (betterIsHigher ? diff < 0 : diff > 0);
	const trendClass = better ? "text-emerald-700" : worse ? "text-rose-700" : "text-slate-400";
	const trendSign = better ? "↑" : worse ? "↓" : "•";
	return (
		<div>
			<div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</div>
			<div className="flex items-baseline gap-1.5 mt-0.5">
				<span className="font-mono text-[13px] text-slate-900 tabular-nums">{format(cur)}</span>
				<span className={`text-[10px] font-medium ${trendClass}`}>{trendSign} {format(Math.abs(diff))}</span>
			</div>
			<div className="text-[10px] text-slate-400">was {format(prev)}</div>
		</div>
	);
}

function pct(v: number): string {
	return `${Math.round(v * 100)}%`;
}

function EmptyState() {
	return (
		<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
			No scheduled workflows installed yet —{" "}
			<Link to="/studio/skills" className="text-emerald-700 underline">install one</Link>{" "}
			and your AI&apos;s progress will show up here.
		</div>
	);
}

// Advanced: cross-skill comparison plot (W&B-inspired parallel
// coords). Collapsed by default; users find it when they want to
// dig into "which skill version actually scores better?"
const COMPARE_SKILLS = [
	"tavily-search", "brave-search", "gmail-mcp", "github-mcp",
	"wikipedia-search", "arxiv-search", "slack-mcp", "calendar-mcp",
];

function SkillComparison() {
	const [open, setOpen] = useState(false);
	const [skill, setSkill] = useState<string>(COMPARE_SKILLS[0]);
	const [data, setData] = useState<{ rows: any[]; count: number } | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		me.mindSkills(skill)
			.then((d) => setData({ rows: d.rows, count: d.count }))
			.catch(() => setData({ rows: [], count: 0 }))
			.finally(() => setLoading(false));
	}, [open, skill]);

	return (
		<section className="rounded-xl border border-slate-200 bg-white">
			<button
				onClick={() => setOpen((v) => !v)}
				className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
			>
				<div className="flex items-center gap-2">
					{open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
					<span className="text-sm font-medium text-slate-800">Skill comparison (advanced)</span>
				</div>
				<span className="text-xs text-slate-500">
					{open ? "How skill versions stack up on shared casebooks." : "open"}
				</span>
			</button>
			{open && (
				<div className="border-t border-slate-100 p-4 space-y-3">
					<div className="flex items-center gap-2 text-xs">
						<span className="text-slate-500">Compare:</span>
						<select
							value={skill}
							onChange={(e) => setSkill(e.target.value)}
							className="px-2 py-1 rounded border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
						>
							{COMPARE_SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
						</select>
						{data && <span className="ml-auto text-slate-500">{data.count} evaluations</span>}
					</div>
					{loading ? (
						<div className="text-sm text-slate-500 italic py-4 text-center">Loading…</div>
					) : data ? (
						<ParallelCoordsPlot rows={data.rows} />
					) : null}
				</div>
			)}
		</section>
	);
}

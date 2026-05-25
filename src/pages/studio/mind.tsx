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

			<div className="pt-6 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
				<p>
					Reports are computed from your own run history + draft accept-rate (tenant-isolated).
					Skill-level comparisons across global attestations land when the marketplace has more data — for now, run the evaluator on a skill
					from the chat (&quot;trigger an evaluation for tavily-search on personal-agent&quot;).
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

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-200 hover:shadow-sm transition-all">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<Link
						to={`/studio/workflows/${encodeURIComponent(workflow.slug)}`}
						className="font-semibold text-slate-900 hover:text-emerald-700 transition-colors block truncate"
					>
						{workflow.name}
					</Link>
					<div className="text-xs text-slate-500 mt-0.5">{workflow.app}</div>
				</div>
				<div className="text-[10px] text-slate-400">
					{state.this_month.run_count} runs this month
				</div>
			</div>

			<div className="mt-3 space-y-1.5">
				{state.deltas.map((d, i) => (
					<DeltaRow key={i} delta={d} />
				))}
			</div>

			<button
				onClick={() => setOpen((v) => !v)}
				className="mt-3 text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
			>
				{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
				Why?
			</button>

			{open && (
				<div className="mt-2 rounded-lg bg-slate-50 border border-slate-200/60 px-3 py-2 text-[11px] text-slate-600 grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
					<MiniStat label="success rate" cur={pct(state.this_month.success_rate)} prev={pct(state.prev_month.success_rate)} />
					<MiniStat label="avg duration" cur={`${state.this_month.avg_duration_s.toFixed(1)}s`} prev={`${state.prev_month.avg_duration_s.toFixed(1)}s`} />
					{state.this_month.drafts_created ? (
						<>
							<MiniStat label="drafts made" cur={String(state.this_month.drafts_created)} prev={String(state.prev_month.drafts_created || 0)} />
							<MiniStat label="accept rate" cur={pct(state.this_month.draft_accept_rate || 0)} prev={pct(state.prev_month.draft_accept_rate || 0)} />
						</>
					) : null}
				</div>
			)}
		</div>
	);
}

function DeltaRow({ delta }: { delta: { headline: string; detail?: string; trend: "up" | "down" | "flat" } }) {
	const Icon = delta.trend === "up" ? TrendingUp : delta.trend === "down" ? TrendingDown : Minus;
	const color =
		delta.trend === "up" ? "text-emerald-700" :
		delta.trend === "down" ? "text-rose-700" :
		"text-slate-500";
	return (
		<div className={["flex items-start gap-1.5 text-xs leading-relaxed", color].join(" ")}>
			<Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
			<div>
				<div>{delta.headline}</div>
				{delta.detail && <div className="text-[11px] text-slate-500 mt-0.5">{delta.detail}</div>}
			</div>
		</div>
	);
}

function MiniStat({ label, cur, prev }: { label: string; cur: string; prev: string }) {
	return (
		<div>
			<div className="text-slate-400">{label}</div>
			<div className="text-slate-700">
				{cur} <span className="text-slate-400">(was {prev})</span>
			</div>
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

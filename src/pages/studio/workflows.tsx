// /studio/workflows — the unified workflow list (W1).
//
// One table; three kinds (scheduled + visual + on-demand skill).
// Three lenses (Live, All, Available). Click any row → detail page.
// "+ New" button opens the composer (W2 wires the chat-driven path
// + n8n iframe; for W1 it points to /studio/skills which already
// hosts the composer at xp.io/go).

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Workflow as WorkflowIcon, Play, Pause, RefreshCw, Plus, Filter, ExternalLink, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError, type MeWorkflowRow } from "@/api/me";
import PageHints from "@/components/PageHints";
import WorkflowComposer from "@/components/WorkflowComposer";
import RunSparkline from "@/components/RunSparkline";

type Lens = "live" | "all" | "available";

export default function StudioWorkflows() {
	const [rows, setRows] = useState<MeWorkflowRow[] | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [lens, setLens] = useState<Lens>("live");
	const [kindFilter, setKindFilter] = useState<"all" | "scheduled" | "visual">("all");
	const [composerOpen, setComposerOpen] = useState(false);

	const load = async () => {
		try {
			const r = await me.listWorkflows();
			setRows(r.workflows);
		} catch (e) {
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, []);

	const filtered = useMemo(() => {
		if (!rows) return [];
		let out = rows;
		if (kindFilter !== "all") {
			out = out.filter((r) => r.kind === kindFilter);
		}
		if (lens === "live") {
			out = out.filter((r) => r.enabled);
		}
		return out;
	}, [rows, kindFilter, lens]);

	if (err) return <div className="text-rose-700 text-sm">{err}</div>;

	return (
		<div className="space-y-4">
			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-semibold flex items-center gap-2">
						<WorkflowIcon className="w-5 h-5 text-emerald-600" />
						Workflows
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">
						Everything your AI runs — scheduled loops, visual DAGs, on-demand skills.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setComposerOpen(true)}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 shadow-sm shadow-emerald-200 transition-all"
					>
						<Plus className="w-3.5 h-3.5" /> New workflow
					</button>
					<button
						onClick={load}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-slate-200 hover:bg-slate-50 text-slate-700"
					>
						<RefreshCw className="w-3 h-3" /> Refresh
					</button>
				</div>
			</header>

			<WorkflowComposer open={composerOpen} onClose={() => { setComposerOpen(false); load(); }} />

			<PageHints prompts={[
				"what workflows do I have?",
				"pause cc_watcher",
				"build me a workflow that watches Slack hourly",
			]} />

			<div className="flex items-center gap-2 flex-wrap text-xs">
				<LensTab active={lens === "live"}      onClick={() => setLens("live")}      label="Live" />
				<LensTab active={lens === "all"}       onClick={() => setLens("all")}       label="All" />
				<LensTab active={lens === "available"} onClick={() => setLens("available")} label="Available" />
				<div className="ml-3 flex items-center gap-1 text-slate-500">
					<Filter className="w-3 h-3" />
					<select
						value={kindFilter}
						onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
						className="text-xs bg-transparent border-0 focus:outline-none cursor-pointer"
					>
						<option value="all">All kinds</option>
						<option value="scheduled">Scheduled</option>
						<option value="visual">Visual</option>
					</select>
				</div>
				<div className="ml-auto text-slate-500">
					{filtered.length} {filtered.length === 1 ? "workflow" : "workflows"}
				</div>
			</div>

			{lens === "available" ? (
				<AvailableLensRedirect />
			) : rows === null ? (
				<div className="space-y-2">
					{[0, 1, 2].map((i) => (
						<div key={i} className="h-16 rounded-xl bg-white border border-slate-200/50 animate-pulse" />
					))}
				</div>
			) : filtered.length === 0 ? (
				<EmptyState lens={lens} />
			) : (
				<div className="space-y-2">
					{filtered.map((w) => <WorkflowRowView key={w.slug} row={w} onChanged={load} />)}
				</div>
			)}
		</div>
	);
}

function LensTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			onClick={onClick}
			className={[
				"px-3 py-1 rounded-full transition-colors",
				active
					? "bg-gray-900 text-white"
					: "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
			].join(" ")}
		>
			{label}
		</button>
	);
}

function WorkflowRowView({ row, onChanged }: { row: MeWorkflowRow; onChanged: () => void }) {
	const [busy, setBusy] = useState(false);

	const togglePause = async () => {
		if (busy) return;
		setBusy(true);
		try {
			if (row.kind === "scheduled" && row.app) {
				const loopName = row.name;
				await me.patchLoop(row.app, loopName, { enabled: !row.enabled });
				toast.success(row.enabled ? "Paused" : "Resumed");
				onChanged();
			} else {
				toast.info("Pause for visual workflows: use n8n's toggle in the iframe (W2).");
			}
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const runNow = async () => {
		if (busy) return;
		setBusy(true);
		try {
			if (row.kind === "scheduled" && row.app) {
				await me.runLoopNow(row.app, row.name);
				toast.success("Cycle queued");
			} else {
				toast.info("Run-now for visual workflows: W2.");
			}
		} catch (e) {
			toast.error(`Run failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const lastRun = row.last_run_ts
		? relativeTime(row.last_run_ts * 1000)
		: "—";

	return (
		<div className={[
			"group relative rounded-xl border bg-white px-4 py-3 transition-all",
			row.enabled
				? "border-slate-200 hover:border-emerald-200 hover:shadow-sm"
				: "border-slate-200/60 opacity-70 hover:opacity-100",
		].join(" ")}>
			<div className="flex items-center gap-4">
				{/* State indicator — pulsing emerald dot when last run ok, rose if failed */}
				<div className="relative flex-shrink-0">
					<div className={[
						"w-2 h-2 rounded-full",
						row.last_run_ok === true ? "bg-emerald-500" :
						row.last_run_ok === false ? "bg-rose-500" :
						"bg-slate-300",
					].join(" ")} />
					{row.enabled && row.last_run_ok === true && (
						<div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75" />
					)}
				</div>

				{/* Name + path */}
				<Link
					to={`/studio/workflows/${encodeURIComponent(row.slug)}`}
					className="flex-1 min-w-0 group/link"
				>
					<div className="flex items-center gap-2">
						<span className="font-semibold text-slate-900 group-hover/link:text-emerald-700 transition-colors truncate">
							{row.name}
						</span>
						{row.app && (
							<span className="text-[11px] font-normal text-slate-400 truncate">/ {row.app}</span>
						)}
						<KindChip kind={row.kind} />
					</div>
					{row.description && (
						<div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{row.description}</div>
					)}
				</Link>

				{/* Sparkline — what's been happening lately */}
				<div className="hidden md:flex items-center" title="Last 14 runs">
					<RunSparkline spec={row.run_spark || ""} />
				</div>

				{/* Trigger + last run */}
				<div className="hidden lg:block text-right min-w-[110px]">
					<div className="font-mono text-[11px] text-slate-600 truncate">{row.trigger || "@trigger"}</div>
					<div className="text-[10px] text-slate-400 mt-0.5">{lastRun}</div>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-1 flex-shrink-0">
					<button
						title="Run now"
						onClick={runNow}
						disabled={busy}
						className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 active:scale-95 transition-all disabled:opacity-40"
					>
						<Play className="w-3.5 h-3.5" />
					</button>
					<button
						title={row.enabled ? "Pause" : "Resume"}
						onClick={togglePause}
						disabled={busy}
						className={[
							"p-1.5 rounded-lg active:scale-95 transition-all disabled:opacity-40",
							row.enabled
								? "text-slate-500 hover:bg-slate-100"
								: "text-amber-700 hover:bg-amber-50",
						].join(" ")}
					>
						<Pause className="w-3.5 h-3.5" />
					</button>
					<Link
						to={`/studio/workflows/${encodeURIComponent(row.slug)}`}
						title="Open"
						className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
					>
						<ChevronRight className="w-3.5 h-3.5" />
					</Link>
				</div>
			</div>
		</div>
	);
}

// Human-readable "5m ago" / "2h ago" / "Mar 12" relative time. Falls
// back to absolute date for > 7 days old.
function relativeTime(ms: number): string {
	const diff = Date.now() - ms;
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return `${sec}s ago`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
	if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
	return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function KindChip({ kind }: { kind: "scheduled" | "visual" }) {
	const cfg = kind === "scheduled"
		? { label: "scheduled", className: "bg-indigo-50 text-indigo-700 border-indigo-200" }
		: { label: "visual",    className: "bg-violet-50 text-violet-700 border-violet-200" };
	return (
		<span
			data-testid={`kind-chip-${kind}`}
			className={["text-[10px] px-2 py-0.5 rounded border font-medium", cfg.className].join(" ")}
		>
			{cfg.label}
		</span>
	);
}

function AvailableLensRedirect() {
	return (
		<div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 text-center">
			<p className="text-sm text-slate-700">
				Browse the marketplace to add new workflows.
			</p>
			<Link
				to="/studio/skills"
				className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
			>
				Open marketplace <ExternalLink className="w-3.5 h-3.5" />
			</Link>
		</div>
	);
}

function EmptyState({ lens }: { lens: Lens }) {
	if (lens === "live") {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
				No live workflows. Switch to <strong>All</strong> to see paused ones, or
				visit <Link to="/studio/skills" className="text-emerald-700 underline">marketplace</Link> to install one.
			</div>
		);
	}
	return (
		<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
			You don&apos;t have any workflows yet.{" "}
			<Link to="/studio/skills" className="text-emerald-700 underline">Install one from the marketplace</Link>.
		</div>
	);
}

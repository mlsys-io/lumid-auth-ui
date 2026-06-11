// /studio/workflows — the unified workflow list (W1).
//
// One table; three kinds (scheduled + visual + on-demand skill).
// Three lenses (Live, All, Available). Click any row → detail page.
// "+ New" button opens the composer (W2 wires the chat-driven path
// + n8n iframe; for W1 it points to /studio/skills which already
// hosts the composer at xp.io/go).

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Workflow as WorkflowIcon, Play, Pause, RefreshCw, Plus, Filter, ExternalLink, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError, type MeWorkflowRow } from "@/api/me";
import PageHints from "@/components/PageHints";
import WorkflowComposer from "@/components/WorkflowComposer";
import WorkflowDetailPanel from "@/components/WorkflowDetailPanel";
import RunSparkline from "@/components/RunSparkline";

type Lens = "live" | "all" | "available";

export default function StudioWorkflows() {
	const [rows, setRows] = useState<MeWorkflowRow[] | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [lens, setLens] = useState<Lens>("live");
	const [kindFilter, setKindFilter] = useState<"all" | "scheduled" | "visual">("all");
	const [composerOpen, setComposerOpen] = useState(false);

	// Master-detail: `?selected=<slug>` opens the right-side detail
	// panel. URL-state lets the back button collapse the panel and
	// makes the view sharable as a deep link.
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedSlug = searchParams.get("selected") || "";
	const selectRow = (slug: string) => {
		setSearchParams((sp) => {
			const next = new URLSearchParams(sp);
			next.set("selected", slug);
			return next;
		}, { replace: false });
	};
	const clearSelection = () => {
		setSearchParams((sp) => {
			const next = new URLSearchParams(sp);
			next.delete("selected");
			return next;
		}, { replace: false });
	};

	const load = async () => {
		try {
			const r = await me.listWorkflows();
			setRows(r.workflows);
		} catch (e) {
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, []);

	// Cross-surface entry: any page can route here with `?compose=1` to
	// pop the composer modal on mount (e.g. inbox-zero "New workflow"
	// CTA). Strip the param so a back/forward navigation doesn't re-pop.
	useEffect(() => {
		const u = new URL(window.location.href);
		if (u.searchParams.get("compose") === "1") {
			setComposerOpen(true);
			u.searchParams.delete("compose");
			window.history.replaceState({}, "", u.pathname + (u.search || "") + u.hash);
		}
	}, []);

	// `?show=operator` opt-in: surfaces operator-shared workflows
	// (everything not in the user's tenant tree). Default view is
	// tenant-only — what the user has created or forked — so the page
	// doesn't crowd a fresh user with platform-shared apps.
	const showOperator = searchParams.get("show") === "operator";

	const filtered = useMemo(() => {
		if (!rows) return [];
		let out = rows;
		if (!showOperator) {
			out = out.filter((r) => r.tenant === true);
		}
		if (kindFilter !== "all") {
			out = out.filter((r) => r.kind === kindFilter);
		}
		if (lens === "live") {
			out = out.filter((r) => r.enabled);
		}
		return out;
	}, [rows, kindFilter, lens, showOperator]);

	if (err) return <div className="text-rose-700 text-sm">{err}</div>;

	return (
		<div className="space-y-4">
			{/* Page identity now lives in the StudioShell top-bar; this
			    row carries only the page actions. */}
			<header className="flex items-center justify-end">
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
				"score consulting case answers against the MBB framework",
				"find the best NL-to-SQL config under 200ms",
				"turn KOL tweets into a trading strategy",
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
				<div className="ml-auto flex items-center gap-3 text-slate-500">
					<label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Show platform-shared workflows alongside yours">
						<input
							type="checkbox"
							checked={showOperator}
							onChange={(e) => {
								setSearchParams((sp) => {
									const next = new URLSearchParams(sp);
									if (e.target.checked) next.set("show", "operator");
									else next.delete("show");
									return next;
								}, { replace: true });
							}}
							className="w-3 h-3 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400/40 cursor-pointer"
						/>
						<span className="text-[11px]">Show shared</span>
					</label>
					<span>
						{filtered.length} {filtered.length === 1 ? "workflow" : "workflows"}
					</span>
				</div>
			</div>

			{lens === "available" ? (
				<AvailableLensRedirect />
			) : (
				<div
					className={[
						// Master-detail when something is selected; single
						// column otherwise. The list compacts itself when
						// selected (via the `compact` prop on each row).
						// Split only at xl+ (≥1280px) so the side-by-side
						// has room to breathe — below that it stacks
						// vertically (panel scrolls into view below list).
						selectedSlug
							? "grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 items-start"
							: "block",
					].join(" ")}
				>
					<div className="space-y-2 min-w-0">
						{rows === null ? (
							[0, 1, 2].map((i) => (
								<div key={i} className="h-16 rounded-xl bg-white border border-slate-200/50 animate-pulse" />
							))
						) : filtered.length === 0 ? (
							<EmptyState lens={lens} />
						) : (
							<AppGroupedList
								rows={filtered}
								onChanged={load}
								compact={!!selectedSlug}
								selectedSlug={selectedSlug}
								onSelect={selectRow}
							/>
						)}
					</div>

					{selectedSlug && (
						<WorkflowDetailPanel
							key={selectedSlug}
							slug={selectedSlug}
							onClose={clearSelection}
						/>
					)}
				</div>
			)}
		</div>
	);
}

// AppGroupedList — workflows grouped by their parent app (xpio bundle).
// Each app gets a collapsible card header showing aggregate state; rows
// expand under it. Apps with at least one enabled workflow expand by
// default; fully-disabled apps collapse so they don't crowd the view.
// Apps with the same name as their single workflow render flat (no
// extra header — avoids noise for single-workflow apps).
function AppGroupedList({
	rows,
	onChanged,
	compact,
	selectedSlug,
	onSelect,
}: {
	rows: MeWorkflowRow[];
	onChanged: () => void;
	compact: boolean;
	selectedSlug: string;
	onSelect: (slug: string) => void;
}) {
	// Group by app. Workflows without an app (visual/n8n) bucket as "—".
	const groups = useMemo(() => {
		const byApp = new Map<string, MeWorkflowRow[]>();
		for (const w of rows) {
			const k = w.app || "—";
			if (!byApp.has(k)) byApp.set(k, []);
			byApp.get(k)!.push(w);
		}
		return Array.from(byApp.entries())
			.map(([app, ws]) => ({ app, workflows: ws }))
			.sort((a, b) => a.app.localeCompare(b.app));
	}, [rows]);

	return (
		<div className="space-y-3">
			{groups.map((g) => (
				<AppGroup
					key={g.app}
					app={g.app}
					workflows={g.workflows}
					onChanged={onChanged}
					compact={compact}
					selectedSlug={selectedSlug}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

function AppGroup({
	app,
	workflows,
	onChanged,
	compact,
	selectedSlug,
	onSelect,
}: {
	app: string;
	workflows: MeWorkflowRow[];
	onChanged: () => void;
	compact: boolean;
	selectedSlug: string;
	onSelect: (slug: string) => void;
}) {
	// Collapse persistence per app — survives a route change.
	const lsKey = `studio:workflows:app-open:${app}`;
	const enabledCount = workflows.filter((w) => w.enabled).length;
	const failingCount = workflows.filter((w) => w.last_run_ok === false).length;
	const totalCost = workflows.reduce((sum, w) => sum + (w.cost_cents_mtd || 0), 0);
	const defaultOpen = enabledCount > 0;
	const [open, setOpen] = useState<boolean>(() => {
		const stored = window.localStorage.getItem(lsKey);
		if (stored === "0") return false;
		if (stored === "1") return true;
		return defaultOpen;
	});
	const toggle = () => {
		const next = !open;
		setOpen(next);
		window.localStorage.setItem(lsKey, next ? "1" : "0");
	};

	// A single-workflow "app" whose only workflow shares the app's name
	// (e.g. some legacy single-loop bundles) — render flat.
	const isSingleton = workflows.length === 1
		&& (workflows[0].name === app || workflows[0].name === `${app}-draft` || app === "—");
	if (isSingleton) {
		return (
			<WorkflowRowView
				key={workflows[0].slug}
				row={workflows[0]}
				onChanged={onChanged}
				compact={compact}
				selected={workflows[0].slug === selectedSlug}
				onSelect={() => onSelect(workflows[0].slug)}
			/>
		);
	}

	return (
		<section
			className={[
				"rounded-xl border bg-white/40 overflow-hidden transition-colors",
				failingCount > 0 ? "border-rose-200/70" : "border-slate-200/70",
			].join(" ")}
		>
			<button
				onClick={toggle}
				className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white transition-colors text-left"
			>
				<ChevronRight className={[
					"w-4 h-4 text-slate-400 transition-transform flex-shrink-0",
					open ? "rotate-90" : "",
				].join(" ")} />
				<div className="flex-1 min-w-0 flex items-center gap-2">
					<span className="font-medium text-slate-900 truncate text-[14px]">{app}</span>
					<span className="text-[11px] text-slate-400 font-mono">
						{workflows.length} workflow{workflows.length === 1 ? "" : "s"}
					</span>
					{enabledCount > 0 && (
						<span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200/70 rounded px-1.5 py-0.5">
							<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
							{enabledCount} live
						</span>
					)}
					{failingCount > 0 && (
						<span className="inline-flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200/70 rounded px-1.5 py-0.5">
							<span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
							{failingCount} failing
						</span>
					)}
				</div>
				{totalCost > 0 && (
					<span
						className="text-[10px] font-mono tabular-nums text-slate-500"
						title={`Month-to-date cost across this app's workflows`}
					>
						{formatCents(totalCost)}
					</span>
				)}
			</button>

			{open && (
				<div className="px-2 pb-2 pt-1 space-y-1.5 bg-slate-50/40 border-t border-slate-100">
					{workflows.map((w) => (
						<WorkflowRowView
							key={w.slug}
							row={w}
							onChanged={onChanged}
							compact={compact}
							selected={w.slug === selectedSlug}
							onSelect={() => onSelect(w.slug)}
						/>
					))}
				</div>
			)}
		</section>
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

function WorkflowRowView({
	row,
	onChanged,
	compact = false,
	selected = false,
	onSelect,
}: {
	row: MeWorkflowRow;
	onChanged: () => void;
	compact?: boolean;
	selected?: boolean;
	onSelect?: () => void;
}) {
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
				toast.success("Run queued");
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

	// The row is one big clickable surface — click anywhere outside an
	// action button selects the row. Action buttons stopPropagation so
	// they don't bubble.
	const handleRowClick = () => {
		if (onSelect) onSelect();
	};

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={handleRowClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleRowClick();
				}
			}}
			className={[
				"group relative rounded-xl border bg-white px-4 py-3 transition-all cursor-pointer",
				selected
					? "border-emerald-300 ring-2 ring-emerald-200/60 shadow-sm"
					: row.enabled
						? "border-slate-200 hover:border-emerald-200 hover:shadow-sm"
						: "border-slate-200/60 opacity-70 hover:opacity-100",
			].join(" ")}
		>
			<div className="flex items-center gap-3">
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
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className={[
							"font-medium transition-colors truncate",
							selected ? "text-emerald-800" : "text-slate-900 group-hover:text-emerald-700",
						].join(" ")}>
							{row.name}
						</span>
						{row.app && (
							<span className="text-[11px] font-normal text-slate-400 truncate">/ {row.app}</span>
						)}
						<KindChip kind={row.kind} />
					</div>
					{!compact && row.description && (
						<div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{row.description}</div>
					)}
				</div>

				{/* Sparkline — what's been happening lately. Hidden in
				    compact mode to give the name + actions room. */}
				{!compact && (
					<div className="hidden md:flex items-center" title="Last 14 runs">
						<RunSparkline spec={row.run_spark || ""} />
					</div>
				)}

				{/* Cost MTD — only when non-zero; positioned before trigger so
				    the eye lands on it before the metadata. Tooltip shows the
				    full picture. */}
				{row.cost_cents_mtd && row.cost_cents_mtd > 0 ? (
					<div
						className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-600 text-[10px] font-mono tabular-nums border border-slate-200/60"
						title={`Month-to-date cost: ${formatCents(row.cost_cents_mtd)}`}
					>
						{formatCents(row.cost_cents_mtd)}
					</div>
				) : null}

				{/* Trigger + last run — drop when compact to make room. */}
				{!compact && (
					<div className="hidden lg:block text-right min-w-[110px]">
						<div className="font-mono text-[11px] text-slate-600 truncate">{row.trigger || "@trigger"}</div>
						<div className="text-[10px] text-slate-400 mt-0.5">{lastRun}</div>
					</div>
				)}

				{/* Actions */}
				<div
					className="flex items-center gap-1 flex-shrink-0"
					onClick={(e) => e.stopPropagation()}
				>
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
					<ChevronRight className={[
						"w-3.5 h-3.5 transition-transform",
						selected ? "text-emerald-600 rotate-90" : "text-slate-400",
					].join(" ")} />
				</div>
			</div>
		</div>
	);
}

// formatCents — int cents → "$0.42" / "$12.30" / "$1,250.00". Always
// 2dp because the chip is a money quantity; commas for ≥ $1,000.
function formatCents(cents: number): string {
	if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
	const dollars = cents / 100;
	return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Human-readable "5m ago" / "2h ago" / "Mar 12" relative time. Falls
// back to absolute date for > 7 days old.
// Guard against null/0/pre-2024 timestamps that otherwise render as
// "20580d ago" (diff measured from the unix epoch).
const MIN_VALID_MS = new Date("2024-01-01T00:00:00Z").getTime();

function relativeTime(ms: number): string {
	if (!ms || Number.isNaN(ms) || ms < MIN_VALID_MS) return "—";
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
			<a
				href="https://xp.io"
				target="_blank"
				rel="noreferrer"
				className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
			>
				Open marketplace <ExternalLink className="w-3.5 h-3.5" />
			</a>
		</div>
	);
}

function EmptyState({ lens }: { lens: Lens }) {
	const openComposer = () => {
		window.location.href = "/studio/workflows?compose=1";
	};
	if (lens === "live") {
		return (
			<div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-white p-8 text-center">
				<div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-100/60 flex items-center justify-center mb-3">
					<Plus className="w-5 h-5 text-emerald-600" />
				</div>
				<h3 className="text-base font-medium text-slate-900">No workflows yet</h3>
				<p className="text-sm text-slate-600 mt-1.5 max-w-md mx-auto leading-relaxed">
					Your AI runs workflows for you across every domain — personal
					(briefs, email triage), consulting (case analysis), systems
					research (config optimization), and creations you assemble yourself,
					like turning KOL tweets into trading strategies. Start with a template
					or describe what you want.
				</p>
				<div className="flex items-center justify-center gap-2 mt-4">
					<button
						onClick={openComposer}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm shadow-emerald-100"
					>
						<Plus className="w-4 h-4" /> New workflow
					</button>
					<a
						href="https://xp.io"
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
					>
						Browse marketplace <ExternalLink className="w-3.5 h-3.5" />
					</a>
				</div>
			</div>
		);
	}
	return (
		<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
			You don&apos;t have any workflows yet.{" "}
			<a href="https://xp.io" target="_blank" rel="noreferrer" className="text-emerald-700 underline">Install one from the marketplace</a>.
		</div>
	);
}

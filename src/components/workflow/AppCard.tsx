// AppCard — one app on the My Apps home, showing ongoing progress.
//
// An app is a bundle of one or more workflows (loops). The card reads the
// app's workflow rows (me.listWorkflows grouped by app) for live progress —
// workflow count, how many are healthy, last activity, and a compact strip
// of each workflow's recent-run sparkline — plus optional identity (version,
// published) from me.loopsHealth().apps. Clicking opens /studio/apps/:app.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, ArrowRight, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { me, type MeWorkflowRow } from "@/api/me";
import RunSparkline from "@/components/RunSparkline";
import { CardMetrics } from "@/components/workflow/MetricTrend";
import { loopLabel } from "@/lib/workflow-names";
import { iconFor, APP_NAV_INVALIDATE } from "@/components/useAppNav";
import { cn } from "@/lib/utils";

export interface AppIdentity {
	version?: string;
	kind?: string;
	published?: boolean;
	status?: string;
	// From the app's own xpcloud `ui:` block — the card is CONFIGURED by the
	// app, not by hard-coded maps, so My Apps, the sidebar, and the app page
	// always agree on name/icon. hasSurface routes the header click to the
	// app's configured UI (/studio/a/<app>) instead of the raw loop overview.
	label?: string;
	icon?: string;
	hasSurface?: boolean;
}

// Legacy fallbacks for upstream apps that predate ui.sidebar config.
// Static fallback names — ALIGNED to each app's own ui.sidebar.label so the
// sidebar name wins everywhere even before the runtime registry populates.
// (The registry below, fed from live ui.sidebar.label, is authoritative.)
const TITLE: Record<string, string> = {
	"personal-agent": "Personal Agent",
	"mbb-ai": "MBB Coach",
	"auto-sysresearch": "Systems Optimizer",
	"auto-quant": "Auto-Quant",
};

// Runtime label registry — populated from each installed app's
// ui.sidebar.label (see useAppNav). This is the canonical source: "sidebar
// wins", so appTitle() shows the SAME name in chat / breadcrumbs / surface
// cards as the sidebar nav, for EVERY app (not just the few in TITLE).
const SIDEBAR_LABELS: Record<string, string> = {};
export function registerAppLabel(app: string, label: string): void {
	if (app && label) SIDEBAR_LABELS[app] = label;
}

const BLURB: Record<string, string> = {
	"personal-agent": "Morning briefs, inbox triage, and reflections over your email + calendar.",
	"mbb-ai": "Active-learning over consulting cases — sharpens its judgement with every run.",
	"auto-sysresearch": "Proposes, benchmarks, and learns better systems configurations.",
	"auto-quant": "Momentum + mean-reversion crypto strategies — proposes, backtests, and risk-gates paper trades, learning from every run.",
};

const ACRONYMS: Record<string, string> = { gpu: "GPU", ai: "AI", lqt: "LQT", sql: "SQL", mbb: "MBB", kol: "KOL", ci: "CI", api: "API" };

export function appTitle(app: string): string {
	// Sidebar wins: the app's live ui.sidebar.label first, then the (aligned)
	// static map, then a humanized slug.
	if (SIDEBAR_LABELS[app]) return SIDEBAR_LABELS[app];
	if (TITLE[app]) return TITLE[app];
	// Humanize an unmapped slug: drop a leading "lumid-", split on -/_, title-
	// case, uppercase known acronyms. "lumid-gpu-rentals" -> "GPU Rentals".
	const humanized = app
		.replace(/^lumid-/, "")
		.split(/[-_]/)
		.filter(Boolean)
		.map((w) => ACRONYMS[w.toLowerCase()] || w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
	return humanized || app;
}

function whenLast(ts?: number): string {
	if (!ts) return "no activity yet";
	const s = (Date.now() - ts * 1000) / 1000;
	if (s < 60) return "active just now";
	if (s < 3600) return `active ${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `active ${Math.floor(s / 3600)}h ago`;
	return `active ${Math.floor(s / 86400)}d ago`;
}

export default function AppCard({
	app, workflows, identity, index = 0, onOpen, onRemoved,
}: {
	app: string;
	workflows: MeWorkflowRow[];
	identity?: AppIdentity;
	index?: number;
	onOpen?: (app: string, loop?: string) => void;
	onRemoved?: () => void;
}) {
	const navigate = useNavigate();
	const [removing, setRemoving] = useState(false);
	const label = identity?.label || TITLE[app] || app;
	// Same remove behavior as the surface-app cards: confirm → async
	// uninstall (archived, recoverable) → refresh the sidebar.
	const remove = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!confirm(`Remove "${label}"? It will be archived (recoverable).`)) return;
		try {
			setRemoving(true);
			await me.uninstallApp(app);
			toast.success(`Removing ${label}…`);
			window.dispatchEvent(new Event(APP_NAV_INVALIDATE)); // refresh the sidebar too
			onRemoved?.();
		} catch (err) {
			toast.error(String((err as Error)?.message ?? err));
			setRemoving(false);
		}
	};
	const loopOf = (w: MeWorkflowRow) => {
		if (w.app && w.slug.startsWith(w.app + ":")) return w.slug.slice(w.app.length + 1);
		const i = w.slug.indexOf(":");
		return i >= 0 ? w.slug.slice(i + 1) : w.slug;
	};
	const open = (loop?: string) => {
		if (onOpen) onOpen(app, loop);
		else navigate(`/studio/apps/${encodeURIComponent(app)}${loop ? `?selected=${encodeURIComponent(loop)}` : ""}`);
	};
	// Header click: the app's CONFIGURED surface when it declares one (the
	// same page the sidebar opens); per-workflow rows still open the cycle
	// inspector. Apps without a surface keep the loop overview.
	const openHeader = () => {
		if (identity?.hasSurface) navigate(`/studio/a/${encodeURIComponent(app)}`);
		else open();
	};
	const Icon = identity?.icon ? iconFor(identity.icon) : Boxes;
	const total = workflows.length;
	const healthy = workflows.filter((w) => w.last_run_ok === true).length;
	const failing = workflows.filter((w) => w.last_run_ok === false).length;
	const running = workflows.filter((w) => w.running).length;
	const lastActivity = workflows.reduce((m, w) => Math.max(m, w.last_run_ts || 0), 0);

	const cls = "group relative block w-full text-left rounded-xl border border-slate-200/80 bg-white overflow-hidden hover:shadow-md hover:shadow-slate-200/60 hover:border-slate-300 transition-all hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-500";
	const style = { animationDelay: `${index * 70}ms`, animationFillMode: "both" as const };

	return (
		<div style={style} className={cls}>

			{/* header → the app's configured UI (or the workflow overview when none) */}
			<button type="button" onClick={openHeader} className="block w-full text-left px-4 pt-3 pb-2">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
						<Icon className="w-[18px] h-[18px]" />
					</div>
					<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="text-[14px] font-medium text-slate-900 truncate">{label}</h3>
						{/* ONE status signal: running > failing > quiet health ratio.
						    (The rail, heartbeat dot, wf-count, and mono slug all said the
						    same thing four ways — scrubbed 2026-06-12.) */}
						<span className="ml-auto flex items-center text-[11px] flex-shrink-0">
							{running > 0 ? (
								<span className="inline-flex items-center gap-1 text-sky-700" title="a run is in progress">
									<span className="w-1.5 h-1.5 rounded-full bg-sky-500 running-pulse" />running
								</span>
							) : failing > 0 ? (
								<span className="inline-flex items-center gap-0.5 text-rose-700"><AlertTriangle className="w-3 h-3" />{failing} failing</span>
							) : total > 0 ? (
								<span className="text-slate-400">{healthy}/{total} healthy</span>
							) : null}
						</span>
					</div>
					<div className="text-[12px] text-slate-400 mt-0.5 truncate">{whenLast(lastActivity)}</div>
					</div>
					<ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 transition-colors flex-shrink-0" />
					<span
						role="button" tabIndex={0} onClick={remove}
						className="shrink-0 p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-opacity"
						aria-label={`Remove ${label}`} aria-disabled={removing}
					>
						<Trash2 className="w-3.5 h-3.5" />
					</span>
				</div>
			</button>

			{/* each workflow row → label opens the app; the sparkline's dots are
			    individually clickable (hover previews / click pins the cycle). */}
			<div className="px-4 pb-3 space-y-0.5 border-t border-slate-100 pt-2">
				{[...workflows].sort((a, b) => Number(!!b.run_spark) - Number(!!a.run_spark)).slice(0, 2).map((w) => (
					<div
						key={w.slug}
						className="flex items-center gap-2 w-full rounded-md px-1.5 -mx-1.5 py-0.5 hover:bg-emerald-50/60 transition-colors"
					>
						<button
							type="button"
							onClick={() => open(loopOf(w))}
							className="text-[11px] text-slate-600 truncate flex-1 text-left"
							title={`Open ${loopLabel(w.name, w.slug)}`}
						>
							{loopLabel(w.name, w.slug)}
						</button>
						{w.run_spark ? <RunSparkline spec={w.run_spark} runs={w.runs_recent} app={w.app} loop={loopOf(w)} /> : null}
					</div>
				))}
				{total > 2 && <div className="text-[10px] text-slate-400 pt-0.5 pl-1.5">+{total - 2} more</div>}
				{/* How the app's key metrics are trending over iterations — curves +
				    insight (to the right). Tries the app's loops; null if none move. */}
				{(() => {
					const appName = workflows.find((x) => x.app)?.app;
					const loops = workflows.filter((x) => x.app).map((x) => loopOf(x));
					const tracked = workflows.find((x) => x.goal?.tracked?.length)?.goal?.tracked;
					return appName && loops.length ? <CardMetrics app={appName} loops={loops} tracked={tracked} /> : null;
				})()}
			</div>
		</div>
	);
}

// /studio/apps — the Studio spine.
//
//   /studio/apps        → My Apps home: a grid of app cards (live
//                         progress) above a "start a new intent" launcher.
//   /studio/apps/:app   → app overview: the app's workflows, each
//                         expandable to its observability panel
//                         (status + insights + suggested improvements).
//                         ?selected=<loop> deep-links an open panel.
//
// All data is real, via me.* — no mock. App identity + per-loop schedule
// come from me.loopsHealth(); per-workflow run health + sparklines from
// me.listWorkflows(); per-cycle observability from me.cycleDetail (inside
// the panel).

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, ChevronDown, Check, ArrowRight, Boxes, Sparkles, Wrench, Brain, Activity, AlertTriangle, Trash2, Inbox, Loader2, RotateCcw, X, Plus, MoreHorizontal, SlidersHorizontal, Settings, Pencil, Cpu, Cloud, Workflow, Clock, Database } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpiralOverlay } from "@/components/BrandLoader";
import { toast } from "sonner";
import { me, type MeWorkflowRow, type MeAppCard } from "@/api/me";
import { takePendingCustomize } from "@/lib/just-installed";
import apiClient from "@/api/client";
import { iconFor, APP_NAV_INVALIDATE } from "@/components/useAppNav";
import { setStudioSelection } from "@/components/StudioContext";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { TONES, workflowTone } from "@/lib/tones";
import { describeSchedule } from "@/lib/schedule";
import { Skeleton, humanizeLoop, loopLabel } from "@/pages/app-revamp/loops";
import { QuickStarters } from "@/components/studio/QuickStarters";
import NewWorkflowFlow from "@/components/workflow/NewWorkflowFlow";
import StudioPortfolio from "@/pages/studio/portfolio";
import AppCard, { appTitle, type AppIdentity } from "@/components/workflow/AppCard";
import type { LoopHealth } from "@/components/workflow/WorkflowObservabilityPanel";
import NeedsAttentionRail from "@/components/workflow/NeedsAttentionRail";
import IndexList, { type IndexRow } from "@/components/studio/IndexList";
import { askApp } from "@/lib/grounded-asks";
import { APP_OVERVIEW_MD } from "@/content/appOverviews";
import { useInAppSurface } from "@/components/app-surface/surfaceContext";
import LoopOrbit, { type LoopMode, type LoopStageKey } from "@/components/workflow/LoopOrbit";

// Heavy, AppOverview-only components — lazy so the /studio/apps INDEX chunk
// (AppsHome) doesn't statically pull the DAG canvas (@xyflow → vendor-flow) +
// charts (recharts → vendor-charts) that only the per-app overview renders.
// They load on demand when an overview actually mounts them.
const WorkflowObservabilityPanel = lazy(() => import("@/components/workflow/WorkflowObservabilityPanel"));
const WorkflowList = lazy(() => import("@/components/workflow/WorkflowList"));
// Markdown renderer (named export) for the per-app Overview story copy.
const LumidMarkdown = lazy(() => import("@/components/app-surface/LumidMarkdown").then((m) => ({ default: m.LumidMarkdown })));
// An app with no scheduled workflows is a UI-surface app (GPU Rentals, Lumid
// Market, …). Rather than a dead-end "no workflows" message, show its actual
// surface inline — AppSurface renders the page, or its own "generate a page"
// CTA when the app has none yet.
const AppSurface = lazy(() => import("@/components/app-surface/AppSurface"));
import { RUNNING_APPS } from "@/lib/demo";
import { useCountUp } from "@/lib/use-count-up";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { cn } from "@/lib/utils";

// Scope the surface to the showcase apps (keeps the demo focused).
const inScope = (app?: string) => !app || (RUNNING_APPS as readonly string[]).includes(app);

// Apps the user just deleted. Uninstall is async (intent queue → picker ~5s),
// so /me/workflows keeps returning a deleted app for a few seconds; without
// this the grid shows it until the next poll/refresh. The grid filters these
// out, and drops an entry once the backend stops returning that app (so
// re-installing a same-named app later isn't hidden).
const recentlyDeleted = new Set<string>();

// me.loopsHealth() is typed {apps} in the client, but the handler also
// returns `loops` (per-loop schedule/status). Read both via this shape.
type LoopsHealthResp = {
	apps?: Array<{ app: string; version?: string; kind?: string; published?: boolean; status?: string }>;
	loops?: LoopHealth[];
};

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || "";
	if (app && w.slug.startsWith(app + ":")) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(":");
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

// Relative time from an epoch-seconds timestamp ("5m ago"); "" when 0.
function relSec(tsSec?: number): string {
	if (!tsSec) return "";
	const diff = Date.now() / 1000 - tsSec;
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

function cycleTsToIso(ts: string): string {
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
	if (!m) return ts;
	const [, y, mo, d, h, mi, s] = m;
	return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

type TodayCycle = Awaited<ReturnType<typeof me.today>>["cycles"][number];

// A specific, human summary of a just-completed cycle for the AI-panel note
// (vs. a vague "insights updated").
function describeCycle(c: TodayCycle): string {
	const verb =
		c.outcome === "ran" ? "completed a run"
		: c.outcome === "no_change" ? "observed — nothing new to act on"
		: c.outcome === "awaiting_review" ? "ran — items awaiting your review"
		: c.outcome === "no_setup" ? "needs setup"
		: c.ok === false ? "hit an error" : "ran";
	const bits: string[] = [];
	if (c.review_count) bits.push(`${c.review_count} to review`);
	if (c.offers_count) bits.push(`${c.offers_count} new suggestion${c.offers_count > 1 ? "s" : ""}`);
	if (typeof c.duration_s === "number" && c.duration_s > 0) bits.push(`${c.duration_s.toFixed(0)}s`);
	const extra = bits.length ? ` (${bits.join(" · ")})` : "";
	return `✓ ${appTitle(c.app)} · ${humanizeLoop(c.loop)} ${verb}${extra}. Ask me what changed.`;
}

// ══════════════════════════════════════════════════════════════════
//  My Apps home
// ══════════════════════════════════════════════════════════════════

interface Hero { apps: number; workflows: number; runsToday: number; selfHeals: number; memories: number; failing: number; inbox: number }

// A card for a UI-surface app (no loops/workflows) — Data Exploration,
// Lumid Market, etc. Opens the app's declared surface; operator-shared
// apps (tenant:false) are shown read-only (no Remove). Tenant apps get a
// Remove that fires the uninstall intent.
function SurfaceAppCard({ app, onOpen, onRemoved }: {
	app: MeAppCard; onOpen: () => void; onRemoved: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const Icon = iconFor(app.ui?.sidebar?.icon || app.name);
	const label = app.ui?.sidebar?.label || appTitle(app.name);
	const section = app.ui?.sidebar?.section;
	const remove = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!confirm(`Remove "${label}"? It will be archived (recoverable).`)) return;
		try {
			setBusy(true);
			await me.uninstallApp(app.name);
			toast.success(`Removing ${label}…`);
			window.dispatchEvent(new Event(APP_NAV_INVALIDATE)); // refresh the sidebar too
			onRemoved();
		} catch (err) {
			toast.error(String((err as Error)?.message ?? err));
			setBusy(false);
		}
	};
	// Same card family as AppCard: rounded-xl border, lift-on-hover, 9x9
	// emerald icon, 14px title + 12px status line, hover-reveal remove. It
	// just has no status rail / workflow rows (those are AppCard's
	// differentiator for workflow-bearing apps).
	return (
		<button
			type="button" onClick={onOpen}
			className="group text-left rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 hover:shadow-md hover:shadow-slate-200/60 hover:border-slate-300 transition-all hover:-translate-y-0.5 flex items-center gap-3"
		>
			<div className="w-9 h-9 shrink-0 rounded-lg bg-gold-50 text-gold-600 flex items-center justify-center">
				<Icon className="w-[18px] h-[18px]" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="text-[14px] font-medium text-slate-900 truncate">{label}</div>
				<div className="text-[12px] text-slate-400 truncate">
					{section ? `${section} · ` : ""}{app.tenant ? "installed" : "shared"}
				</div>
			</div>
			<ArrowRight className="w-4 h-4 shrink-0 text-slate-300 group-hover:text-gold-600 transition-colors" />
			<span
				role="button" tabIndex={0} onClick={remove}
				className="shrink-0 p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 opacity-0 group-hover:opacity-100 transition-opacity"
				aria-label={`Remove ${label}`} aria-disabled={busy}
			>
				<Trash2 className="w-3.5 h-3.5" />
			</span>
		</button>
	);
}

// PendingAppCard — optimistic card for an install that's still cloning
// (status "installing") or that failed (status "failed", with Retry/Dismiss).
// Flips to a real AppCard once the picker materializes the app on disk.
function PendingAppCard({ app, onRetry, onDismiss }: {
	app: MeAppCard; onRetry: () => void; onDismiss: () => void;
}) {
	const label = appTitle(app.name);
	const failed = app.status === "failed";
	return (
		<div className={cn(
			"rounded-xl border px-4 py-3.5 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2",
			failed ? "border-rose-200 bg-rose-50/40" : "border-slate-200/70 bg-white",
		)}>
			<div className={cn(
				"w-9 h-9 shrink-0 rounded-lg border flex items-center justify-center",
				failed ? "bg-rose-50 border-rose-200 text-rose-500" : "bg-slate-50 border-slate-200 text-gold-500",
			)}>
				{failed ? <AlertTriangle className="w-[18px] h-[18px]" /> : <Loader2 className="w-[18px] h-[18px] animate-spin" />}
			</div>
			<div className="min-w-0 flex-1">
				<div className="text-[14px] font-medium text-slate-900 truncate">{label}</div>
				<div className={cn("text-[12px] truncate", failed ? "text-rose-600" : "text-slate-400")}>
					{failed ? (app.error || "install failed") : "Setting up — first run starts automatically (~30s)"}
				</div>
			</div>
			{failed && (
				<>
					<button
						type="button" onClick={onRetry}
						className="shrink-0 inline-flex items-center gap-1 text-[12px] rounded-md px-2 py-1 text-gold-700 hover:bg-gold-50 transition-colors"
					>
						<RotateCcw className="w-3.5 h-3.5" /> Retry
					</button>
					<button
						type="button" onClick={onDismiss}
						className="shrink-0 p-1.5 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
						aria-label={`Dismiss ${label}`}
					>
						<X className="w-3.5 h-3.5" />
					</button>
				</>
			)}
		</div>
	);
}

function AppsHome() {
	const [byApp, setByApp] = useState<Map<string, MeWorkflowRow[]> | null>(null);
	// UI-surface apps — those declaring a `ui:` block in xpcloud.yaml but no
	// loops/workflows (e.g. Data Exploration, Lumid Market). They never enter
	// `byApp` (which is workflow-derived), so we list them alongside as their
	// own cards. Source: me.listApps().
	const [uiApps, setUiApps] = useState<MeAppCard[]>([]);
	// In-flight / failed installs (optimistic cards from the server-side
	// intent merge). They flip to a real AppCard once the picker materializes
	// the app on disk.
	const [pendingApps, setPendingApps] = useState<MeAppCard[]>([]);
	// Per-loop health rows (status + last_errors) for the attention rail.
	const [healthLoops, setHealthLoops] = useState<LoopHealth[]>([]);
	const [identity, setIdentity] = useState<Map<string, AppIdentity>>(new Map());
	// app slug → ui.sidebar.section, so the index can group apps the same
	// way the sidebar does (Compute / Research / Trading / …).
	const [sections, setSections] = useState<Map<string, string>>(new Map());
	const [hero, setHero] = useState<Hero | null>(null);
	const navigate = useNavigate();
	const appsRef = useRef<HTMLDivElement>(null);
	// Aggregate loop state for the big LoopOrbit banner on the intent page.
	const [loopMode, setLoopMode] = useState<LoopMode>("idle");
	const [pulseStage, setPulseStage] = useState<LoopStageKey | null>(null);
	const [eventApp, setEventApp] = useState<string | null>(null);
	const prevMaxTsRef = useRef<string>("");

	// Composer host — the standalone modal still opens on an explicit
	// ?compose=1 deep-link or the manual "+ New workflow" button
	// (studio:new-workflow). It NO LONGER auto-opens when the chat agent
	// finishes compose_workflow — that build now renders inline in the chat
	// as an AssemblyCard (no popup). See StudioChat compose_workflow handler.
	const [composerOpen, setComposerOpen] = useState(false);
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		if (searchParams.get("compose") === "1") {
			setComposerOpen(true);
			const sp = new URLSearchParams(searchParams);
			sp.delete("compose");
			setSearchParams(sp, { replace: true });
		}
	}, [searchParams, setSearchParams]);
	useEffect(() => {
		const f = () => setComposerOpen(true);
		window.addEventListener("studio:new-workflow", f);
		return () => window.removeEventListener("studio:new-workflow", f);
	}, []);

	const load = useCallback(async () => {
			const [wfR, lhR, todayR, agentsR, appsR, draftsR] = await Promise.allSettled([
				// scheduled-only: app cards group xpio loops by app; n8n visual
				// rows have no app, so fetching them just adds the n8n round-trip.
				me.listWorkflows("scheduled"),
				me.loopsHealth(),
				me.today(),
				apiClient.get("/api/v1/me/knowledge/agents"),
				me.listApps(),
				me.listDrafts({ state: "pending" }),
			]);

			// A failed poll (network blip, token refresh, slow backend) must NOT
			// blank the panel — keep the last good render and try again next tick.
			// Only the very first load (byApp still null) falls through to the
			// skeleton via the early `byApp === null` guard below.
			if (wfR.status !== "fulfilled") return;
			// Drop just-deleted apps from the recently-deleted set once the
			// backend stops returning them (uninstall finished) — then they
			// neither appear nor stay stuck in the hide-set.
			const fetchedApps = new Set((wfR.value.workflows || []).map((w) => w.app || ""));
			for (const a of [...recentlyDeleted]) if (!fetchedApps.has(a)) recentlyDeleted.delete(a);
			// Show the user's OWN apps (tenant:true) always — a freshly-composed
			// bot gets a fresh slug, so gating it would hide the user's own
			// creation. Operator-shared apps surface when the BACKEND marks them
			// showcase (LUMID_SHOWCASE_APPS — curated without a frontend rebuild);
			// inScope(RUNNING_APPS) stays as a static fallback for older backends.
			// `recentlyDeleted` hides an app the moment the user deletes it (the
			// async uninstall keeps returning it for a few seconds otherwise).
			const wfs = (wfR.value.workflows || []).filter(
				(w) => (w.tenant || w.showcase || inScope(w.app)) && !recentlyDeleted.has(w.app || ""));
			const m = new Map<string, MeWorkflowRow[]>();
			for (const w of wfs) {
				const k = w.app || "—";
				const a = m.get(k);
				if (a) a.push(w); else m.set(k, [w]);
			}
			setByApp(m);

			let uiCount = 0;
			// UI-surface apps: declare a `ui:` block but aren't already
			// represented by a workflow card (no loops). These are the
			// Data Exploration / Market surfaces — show them so "My Apps"
			// reflects everything installed, not just loop-driven bots.
			if (appsR.status === "fulfilled") {
				const seen = new Set(m.keys());
				const ua = (appsR.value.apps || []).filter(
					(a) =>
						!seen.has(a.name) && !recentlyDeleted.has(a.name) &&
						a.status !== "installing" && a.status !== "failed" &&
						// Show every installed TENANT app that isn't a loop card — even
						// without a ui block — so a freshly-installed app never falls
						// through the cracks (opening it auto-generates a surface).
						// Operator-shared apps still need a declared ui block to appear.
						(a.tenant || a.ui?.surface || a.ui?.surfaces || a.ui?.sidebar),
				);
				// Dedup by name (an app can surface in both tenant + operator roots).
				const byName = new Map<string, MeAppCard>();
				for (const a of ua) if (!byName.has(a.name) || a.tenant) byName.set(a.name, a);
				uiCount = byName.size;
				setUiApps([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));

				// Optimistic install cards: server merges this user's in-flight /
				// failed install intents into the list with status set. Dedup by
				// name; honor the session dismiss-set.
				const pend = new Map<string, MeAppCard>();
				for (const a of (appsR.value.apps || [])) {
					if ((a.status === "installing" || a.status === "failed") && !recentlyDeleted.has(a.name)) {
						pend.set(a.name, a);
					}
				}
				setPendingApps([...pend.values()].sort((a, b) => a.name.localeCompare(b.name)));

				// Note: we deliberately do NOT auto-navigate a just-installed app
				// into page generation — auto-generation blocked the screen and
				// surprised users. Generation is opt-in now: open the app and use
				// "Generate a page" if it has no surface yet. When the install
				// marker drains (the app just became ready), confirm it with a
				// toast that offers to open the app.
				for (const a of (appsR.value.apps || [])) {
					if (a.status === "ready" && takePendingCustomize(a.name)) {
						const label = a.ui?.sidebar?.label || appTitle(a.name);
						toast.success(`✓ ${label} is ready`, {
							action: { label: "Open", onClick: () => navigate(`/studio/a/${encodeURIComponent(a.name)}`) },
						});
					}
				}
			}

			// Identity (version/kind badges). Seed from each app's workflow rows
			// first — they carry version for EVERY app incl. tenant ones (the
			// loops-health/AdminLoops path only reads the operator home, so
			// tenant apps were version-less). Then overlay loops-health identity
			// where it has richer data (published/status), without clobbering a
			// version the rows already provided.
			const im = new Map<string, AppIdentity>();
			for (const [app, rows] of m.entries()) {
				const v = rows.find((r) => r.version)?.version;
				if (v) im.set(app, { version: v });
			}
			if (lhR.status === "fulfilled") {
				const apps = (lhR.value as unknown as LoopsHealthResp).apps || [];
				for (const a of apps) {
					const prev = im.get(a.app);
					im.set(a.app, {
						version: a.version || prev?.version,
						kind: a.kind, published: a.published, status: a.status,
					});
				}
			}
			// NeedsAttentionRail rows come from the TENANT workflow rows (the
			// same last_run_ok truth as the card dots) — /me/loops/health is
			// operator-scoped, so filtering it by tenant app names silently
			// produced an empty rail while the "failing" pill showed 2.
			{
				const lhLoops = lhR.status === "fulfilled" ? ((lhR.value as unknown as LoopsHealthResp).loops || []) : [];
				const opErr = new Map(lhLoops.map((l) => [`${l.app}:${l.loop}`, l] as const));
				// Newest error text per app:loop from today's cycle feed (the
				// grid already fetches it; cycles are newest-first).
				const todayErr = new Map<string, string>();
				if (todayR.status === "fulfilled") {
					for (const c of todayR.value.cycles) {
						const k = `${c.app}:${c.loop}`;
						if (c.ok === false && c.last_error && !todayErr.has(k)) todayErr.set(k, c.last_error);
					}
				}
				const fails: LoopHealth[] = [];
				for (const [appName, rows] of m.entries()) {
					for (const w of rows) {
						if (w.enabled === false || w.last_run_ok !== false) continue;
						const loop = loopOf(w);
						const newestErr = todayErr.get(`${appName}:${loop}`);
						const op = opErr.get(`${appName}:${loop}`);
						fails.push({
							app: appName, loop, status: "failing", enabled: true,
							consecutive_failures: op?.consecutive_failures,
							last_errors: newestErr ? [{ error: newestErr }] : op?.last_errors,
						});
					}
				}
				setHealthLoops(fails);
			}
			// Overlay each app's own `ui:` config — name/icon come from the SAME
			// ui.sidebar the sidebar renders, so the card and sidebar can't
			// disagree; hasSurface routes the card header to the configured UI.
			const sm = new Map<string, string>();
			if (appsR.status === "fulfilled") {
				for (const a of (appsR.value.apps || [])) {
					if (a.ui?.sidebar?.section) sm.set(a.name, a.ui.sidebar.section);
					if (!a.ui) continue;
					const prev = im.get(a.name) ?? {};
					im.set(a.name, {
						...prev,
						label: a.ui.sidebar?.label || prev.label,
						icon: a.ui.sidebar?.icon || prev.icon,
						hasSurface: !!(a.ui.surface || (a.ui.surfaces && Object.keys(a.ui.surfaces).length > 0)),
					});
				}
			}
			setIdentity(im);
			setSections(sm);

			let runsToday = 0;
			if (todayR.status === "fulfilled") {
				const start = new Date(); start.setHours(0, 0, 0, 0);
				const ms = start.getTime();
				for (const c of todayR.value.cycles) {
					const t = Date.parse(cycleTsToIso(c.ts));
					if (!isNaN(t) && t >= ms) runsToday++;
				}
			}
			let memories = 0;
			if (agentsR.status === "fulfilled") {
				const ags = agentsR.value.data?.data?.agents || [];
				memories = ags.reduce((n: number, a: { memory_count?: number }) => n + (a.memory_count || 0), 0);
			}
			const failing = wfs.filter((w) => w.last_run_ok === false).length;
			const selfHeals = wfs.reduce((n, w) => n + (w.run_spark || "").split("").filter((c) => c === "r").length, 0);
			const inbox = draftsR.status === "fulfilled" ? (draftsR.value.drafts?.length || 0) : 0;
			setHero({ apps: m.size + uiCount, workflows: wfs.length, runsToday, selfHeals, memories, failing, inbox });

			// Loop-event detection → drives the orbit banner. Running if any
			// cycle is mid-flight; a newer cycle ts than last poll = an event.
			const anyRunning = wfs.some((w) => w.running || (w.run_spark || "").endsWith("."));
			setLoopMode(anyRunning ? "running" : wfs.some((w) => w.enabled !== false) ? "idle" : "paused");
			let maxCycleTs = "";
			let freshCycle: TodayCycle | null = null;
			if (todayR.status === "fulfilled") {
				for (const c of todayR.value.cycles) {
					if (!inScope(c.app)) continue;
					if ((c.ts || "") > maxCycleTs) { maxCycleTs = c.ts || ""; freshCycle = c; }
				}
			}
			if (prevMaxTsRef.current && maxCycleTs && maxCycleTs !== prevMaxTsRef.current && freshCycle) {
				setPulseStage("learn");
				setEventApp(freshCycle.app);
				window.setTimeout(() => { setPulseStage(null); setEventApp(null); }, 3200);
				// Specific summary of what just ran (non-disruptive note).
				window.dispatchEvent(new CustomEvent("studio:notify", { detail: { message: describeCycle(freshCycle) } }));
			}
			if (maxCycleTs) prevMaxTsRef.current = maxCycleTs;
	}, [navigate]);

	// Poll so the home moves on its own — sparklines extend, counts tick.
	// 40s (was 20s): the chat→page bus already pushes instant updates after a
	// tool mutates state, so the timer is only a slow safety net — no need to
	// hammer /me/* six-deep every 20s (that was a chief 429 contributor).
	useEffect(() => {
		load();
		const id = window.setInterval(load, 40_000);
		return () => window.clearInterval(id);
	}, [load]);

	// Chat→page bus: refetch when a chat tool changes the things THIS page
	// shows (apps + their workflow health). Narrowed from 6 scopes — runs/
	// cycles/drafts don't change the app index, so they shouldn't trigger a
	// full 3-endpoint reload on every such tool call.
	useStudioRefetch(["apps", "workflows", "loops"], load);

	// While an install is in flight, poll a little faster so the optimistic
	// card flips to a real app quickly — but 10s (was 4s = 90 req/min!) and
	// capped at ~2 min so a stuck "installing" card can't hammer /me/* forever.
	const anyInstalling = pendingApps.some((a) => a.status === "installing");
	useEffect(() => {
		if (!anyInstalling) return;
		let elapsed = 0;
		const id = window.setInterval(() => {
			elapsed += 10_000;
			if (elapsed > 120_000) { window.clearInterval(id); return; }
			load();
		}, 10_000);
		return () => window.clearInterval(id);
	}, [anyInstalling, load]);

	const retryInstall = useCallback(async (name: string) => {
		try {
			await me.installApp(name);
			setPendingApps((prev) => prev.map((a) => a.name === name ? { ...a, status: "installing", error: undefined } : a));
			load();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setPendingApps((prev) => prev.map((a) => a.name === name ? { ...a, status: "failed", error: msg } : a));
		}
	}, [load]);

	const dismissPending = useCallback(async (name: string) => {
		recentlyDeleted.add(name);
		setPendingApps((prev) => prev.filter((a) => a.name !== name));
		// Permanently delete the underlying install intent so the failed card
		// doesn't reappear on refresh (session hide alone wasn't enough).
		try { await me.deleteInstallIntent(name); } catch { /* best-effort */ }
	}, []);

	if (byApp === null) {
		return (
			<div className="relative space-y-6">
				<div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
				<Skeleton lines={3} />
				<SpiralOverlay />
			</div>
		);
	}

	const apps = [...byApp.keys()].sort();
	const fresh = apps.length === 0 && uiApps.length === 0 && pendingApps.length === 0;

	// Build the claude-style index rows — one common shape across every app
	// type (loop apps + UI-surface apps). Failing apps float into a "Needs
	// attention" group that leads the list; otherwise they group by the same
	// ui.sidebar.section the left nav uses. Clicking a row opens the grounded
	// chat (askApp); the old observability panel stays one click away via the
	// hover-only "details →" link.
	const SECTION_ORDER = ["Needs attention", "Compute", "Research", "Trading", "Knowledge", "Agents"];
	const appRows: IndexRow[] = apps.map((a) => {
		const rows = byApp.get(a) || [];
		const failing = rows.filter((w) => w.enabled !== false && w.last_run_ok === false).length;
		const running = rows.some((w) => w.running);
		const ran = rows.some((w) => w.last_run_ok === true);
		const lastTs = rows.reduce((mx, w) => Math.max(mx, w.last_run_ts || 0), 0);
		const tone = failing > 0 ? "failing" : running ? "running" : ran ? "ok" : "idle";
		const statusLabel = failing > 0 ? `${failing}× failing` : running ? "running" : ran ? "healthy" : "idle";
		const count = rows.length;
		const when = relSec(lastTs);
		const meta = [`${count} workflow${count === 1 ? "" : "s"}`, when].filter(Boolean).join(" · ");
		return {
			id: a,
			title: identity.get(a)?.label || appTitle(a),
			icon: iconFor(identity.get(a)?.icon || a),
			tone, statusLabel, meta,
			section: failing > 0 ? "Needs attention" : (sections.get(a) || "Agents"),
			ask: askApp(a),
			// Click opens the app's overview page; the chat is the hover "ask".
			navTo: `/studio/apps/${encodeURIComponent(a)}`,
		} as IndexRow;
	});
	// UI-surface apps (Data Exploration, Market, …) — no loops; their home IS
	// their surface, so the row opens the surface via "details →" while the
	// click still lets you ask about it.
	const surfaceRows: IndexRow[] = uiApps.map((a) => ({
		id: `ui:${a.name}`,
		title: a.ui?.sidebar?.label || appTitle(a.name),
		icon: iconFor(a.ui?.sidebar?.icon || a.name),
		tone: "idle",
		section: a.ui?.sidebar?.section || "Agents",
		ask: askApp(a.name),
		// Surface apps: click opens their page (the workspace renders the
		// surface as the app's overview); chat is the hover "ask".
		navTo: `/studio/apps/${encodeURIComponent(a.name)}`,
	} as IndexRow));
	const allRows = [...appRows, ...surfaceRows];

	const launcher = (
		<div className="border-t border-border pt-5">
			<QuickStarters heading="Set up a new agent" />
		</div>
	);

	return (
		<>
			<NewWorkflowFlow open={composerOpen} onClose={() => setComposerOpen(false)} />
			{fresh ? (
				// Fresh user — lead with the launcher so they assemble app #1.
				<div className="max-w-[760px] mx-auto w-full space-y-6 px-1 py-2">
					<div className="rounded-2xl border border-border bg-card p-6">
						<div className="flex items-center gap-3">
							<div className="w-11 h-11 rounded-xl bg-foreground text-background flex items-center justify-center">
								<Sparkles className="w-5 h-5" />
							</div>
							<div>
								<h2 className="font-display text-xl font-medium text-foreground tracking-tight">Set up your first agent.</h2>
								<p className="text-sm text-muted-foreground mt-1">Pick a starter and your AI assembles an agent — schedules its workflows and runs them for you. Progress lives here.</p>
							</div>
						</div>
					</div>
					<QuickStarters heading="Start with a starter" />
				</div>
			) : (
				<div className="panel-in-left" ref={appsRef}>
					{/* Fleet rollup — the cross-workflow health/cost/learning view,
					    merged into Manage apps so there's one place for the fleet. */}
					<div className="max-w-[760px] mx-auto w-full px-1 mb-5">
						<StudioPortfolio embedded />
					</div>
					{/* In-flight / failed installs stay as action-bearing cards above
					    the index (retry / dismiss aren't list-row affordances). */}
					{pendingApps.length > 0 && (
						<div className="max-w-[760px] mx-auto w-full px-1 mb-3 grid grid-cols-1 gap-2.5">
							{pendingApps.map((a) => (
								<PendingAppCard
									key={`pending:${a.name}`} app={a}
									onRetry={() => retryInstall(a.name)}
									onDismiss={() => dismissPending(a.name)}
								/>
							))}
						</div>
					)}
					<IndexList
						title="Agents"
						rows={allRows}
						search={allRows.length > 6}
						searchPlaceholder="Search agents…"
						sectionOrder={SECTION_ORDER}
						footer={launcher}
					/>
				</div>
			)}
		</>
	);
}

// Compact top stat bar — a single thin row of inline, clickable stats
// (numbers consolidated to the top), including a failing count.
function HeroBar({ h, onApps }: { h: Hero; onApps: () => void }) {
	return (
		<div className="flex items-center flex-wrap gap-x-1 gap-y-1 -ml-2">
			<StatChip icon={Boxes} value={h.apps} label="agents" tone="text-slate-400" onClick={onApps} />
			<StatChip icon={Activity} value={h.workflows} label="workflows" tone="text-slate-400" onClick={onApps} />
			<StatChip icon={Sparkles} value={h.runsToday} label="runs today" tone="text-slate-400" to="/studio/runs" />
			{h.selfHeals > 0 && <StatChip icon={Wrench} value={h.selfHeals} label="auto-recovered" tone="text-slate-400" title="workflows that recovered from a failed run on their own" onClick={onApps} />}
			<StatChip icon={Brain} value={h.memories} label="learned" tone="text-slate-400" title="insights your agents saved from recent runs" to="/studio/knowledge" />
			{/* failing count intentionally absent — the attention rail below
			    IS the failure surface (top-strip pill covers other pages). */}
			<StatChip icon={Inbox} value={h.inbox} label="inbox" tone="text-slate-400" to="/studio/inbox" />
		</div>
	);
}

function StatChip({
	icon: Icon, value, label, tone, title, to, onClick,
}: {
	icon: React.ComponentType<{ className?: string }>;
	value: number; label: string; tone: string; title?: string; to?: string; onClick?: () => void;
}) {
	const shown = Math.round(useCountUp(value));
	const inner = (
		<>
			<Icon className={cn("w-3.5 h-3.5", tone)} />
			<span className="font-semibold text-slate-800 tabular-nums">{shown}</span>
			<span className="text-slate-400">{label}</span>
		</>
	);
	const cls = "inline-flex items-center gap-1.5 text-[12px] rounded-lg px-2 py-1 hover:bg-slate-100/70 transition-colors";
	if (onClick) return <button type="button" onClick={onClick} title={title} className={cls}>{inner}</button>;
	if (to) return <Link to={to} title={title} className={cls}>{inner}</Link>;
	return <div className={cls} title={title}>{inner}</div>;
}

// ══════════════════════════════════════════════════════════════════
//  App overview — workflows + expandable observability panels
// ══════════════════════════════════════════════════════════════════

interface Row { loop: string; wf: MeWorkflowRow; lh?: LoopHealth }

const wfDot = (wf: MeWorkflowRow) => cn("w-2 h-2 rounded-full flex-shrink-0", TONES[workflowTone(wf)].dot);
const wfSub = (wf: MeWorkflowRow) =>
	`${describeSchedule(wf.trigger)}${wf.enabled === false ? " · paused" : ""}${wf.running ? " · running…" : (wf.last_run_ok === false && wf.enabled !== false ? " · failed" : "")}`;

// WorkflowSelect — the workflow list consolidated into a dropdown. The trigger
// shows the active workflow (status dot + name + count); the popover lists all
// workflows to switch. Replaces the left-rail master list so the panel shows
// only the selected workflow's content.
function WorkflowSelect({ rows, selected, onSelect, onNew }: { rows: Row[]; selected: string | null; onSelect: (loop: string) => void; onNew?: () => void }) {
	const [open, setOpen] = useState(false);
	// `selected` is null in app-overview mode — show a neutral "Pick a workflow"
	// label then (not a stale workflow name), since the Overview tab is active.
	const cur = rows.find((r) => r.loop === selected) ?? null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors max-w-full min-w-0">
					{cur ? (
						<>
							<span className={wfDot(cur.wf)} />
							<span className="text-[13px] font-medium text-slate-800 truncate">{loopLabel(cur.wf.name, cur.loop)}</span>
						</>
					) : (
						<span className="text-[13px] font-medium text-slate-500 truncate">Pick a workflow</span>
					)}
					<span className="text-[11px] text-slate-500 flex-shrink-0 hidden sm:inline">· {rows.length} workflows</span>
					<ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-1 max-h-[60vh] overflow-y-auto">
				{rows.map(({ loop, wf }) => {
					const active = loop === cur?.loop;
					return (
						<button key={loop} type="button" onClick={() => { onSelect(loop); setOpen(false); }}
							className={cn("w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors", active ? "bg-gold-50" : "hover:bg-muted")}>
							<span className={wfDot(wf)} />
							<span className="flex-1 min-w-0">
								<span className="block text-[12.5px] font-medium text-slate-800 truncate">{loopLabel(wf.name, loop)}</span>
								<span className="block text-[11px] text-slate-500 truncate">{wfSub(wf)}</span>
							</span>
							{/* Recent-run strip so run health is glanceable while switching
							    (display-only here; the panel header has the clickable one). */}
							{active && <Check className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />}
						</button>
					);
				})}
				{onNew && (
					<>
						<div className="my-1 border-t border-slate-100" />
						<button type="button" onClick={() => { setOpen(false); onNew(); }}
							className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
							<Plus className="w-3.5 h-3.5 flex-shrink-0" /> New workflow
						</button>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}

// Stale-while-revalidate caches so re-opening an app renders instantly
// (no skeleton flash) while a fresh fetch updates in the background.
const rowsCache = new Map<string, Row[]>();
const identCache = new Map<string, AppIdentity | undefined>();
// The app's own one-line summary (xpcloud.yaml `summary:`), folded into the
// overview as an "About this app" line so the page is self-describing (the
// old lum.id/<app> landing copy lives here now).
const aboutCache = new Map<string, string>();
// Explicit "show the app-level overview LIST" marker (the Overview tab). The
// DEFAULT view is the selected workflow's panel — overview is opt-in.
const OVERVIEW_SEL = "__overview__";

// "Runtime & harness" strip — a compact, muted row that tells the operator what
// the agent actually runs ON. Everything is DERIVED from already-fetched data
// (rows = MeWorkflowRow + LoopHealth, identity = AppIdentity); no new API calls,
// no per-app hardcoding. Each chip only renders when its field exists, so the
// strip degrades gracefully (an empty strip renders nothing).
function RuntimeStrip({ rows, identity, embedded }: { rows: Row[]; identity?: AppIdentity; embedded?: boolean }) {
	if (!rows.length) return null;

	// Engine / pattern — MeWorkflowRow.engine is the loop's declared engine
	// ("command" → Pattern B, anything else / steps-driven → Pattern A). We read
	// the freshest row's engine; fall back to "steps" when absent (Pattern A is
	// the runner-driven default). Distinct engines across loops are de-duped.
	const engines = Array.from(new Set(rows.map((r) => (r.wf.engine || "").trim().toLowerCase()).filter(Boolean)));
	const isCommand = engines.includes("command");
	const pattern = engines.length === 0 ? null : isCommand ? "B · command" : "A · steps";

	// Runtime — there is no explicit target/compute field on the loop payload,
	// so we infer: an operator (non-tenant) app runs locally on the Claude Code
	// subscription; a tenant app's cycles are routed to the cloud GPU fleet by
	// the scheduler (see CLAUDE.md "LLM in xpio apps"). `wf.tenant` is the only
	// honest signal we have here.
	const isTenant = rows.some((r) => r.wf.tenant);
	const runtime = isTenant ? { label: "Cloud GPU", Icon: Cloud } : { label: "Local Claude Code", Icon: Cpu };

	// Workflow(s) driving the agent — the human loop labels.
	const wfNames = rows.map((r) => loopLabel(r.wf.name, r.loop)).filter(Boolean);
	const wfText = wfNames.length <= 2 ? wfNames.join(", ") : `${wfNames.slice(0, 2).join(", ")} +${wfNames.length - 2}`;

	// Schedule — prefer the tenant cron (wf.trigger) and fall back to loop-health
	// schedule; render the distinct human-readable schedules.
	const scheds = Array.from(new Set(
		rows.map((r) => describeSchedule(r.wf.trigger || r.lh?.schedule)).filter((s) => s && s !== "—"),
	));
	const schedText = scheds.length ? (scheds.length <= 2 ? scheds.join(", ") : `${scheds.slice(0, 2).join(", ")} +${scheds.length - 2}`) : null;

	// Memory banks — app-level memory_agents, repeated on each loop row; de-dupe.
	const banks = Array.from(new Set(rows.flatMap((r) => r.wf.memory_agents || []).filter(Boolean)));
	const banksText = banks.length ? (banks.length <= 2 ? banks.join(", ") : `${banks.slice(0, 2).join(", ")} +${banks.length - 2}`) : null;

	// The runtime ("Cloud GPU"), engine pattern ("Pattern A · steps") and kind
	// chips were removed — inferred / internal-jargon metadata that read as
	// clutter. Only the workflow list remains, and only when standalone (the
	// workspace already lists workflows in the top-bar picker).
	void runtime; void pattern; void identity; void schedText; void banksText;
	type Chip = { Icon: typeof Cpu; label: string; title?: string };
	const chips: Chip[] = [];
	if (wfText && !embedded) chips.push({ Icon: Workflow, label: wfText, title: wfNames.join(", ") });
	if (!chips.length) return null;

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500">
			{chips.map((c, i) => (
				<span key={i} className="inline-flex items-center gap-1 min-w-0" title={c.title}>
					<c.Icon className="w-3 h-3 flex-shrink-0 text-slate-400" />
					<span className="truncate max-w-[14rem]">{c.label}</span>
				</span>
			))}
		</div>
	);
}

export function AppOverview({ app, embedded, initialLoop }: { app: string; embedded?: boolean; initialLoop?: string | null }) {
	const [rows, setRows] = useState<Row[] | null>(() => rowsCache.get(app) ?? null);
	const [identity, setIdentity] = useState<AppIdentity | undefined>(() => identCache.get(app));
	const [deleting, setDeleting] = useState(false);
	const navigate = useNavigate();
	// In the workspace, the workflow switcher + "New workflow" portal into the
	// top strip right after the app name (topstrip-app-slot is empty for
	// workflow apps — only surface apps fill it). Standalone, they render inline.
	// Its OWN slot — the app surface owns "topstrip-app-slot" for its nav tabs.
	// Two portals into one node stack their children (that is what put the
	// surface tabs on top of this selector); separate nodes lay out side by side.
	const nestedInSurface = useInAppSurface();
	// Only the OUTERMOST overview owns the strip. A nested AppOverview (a surface
	// mounting `lumid:native app-workflows`) is a panel inside the page, not the
	// page's chrome — it was portaling a SECOND workflow selector into the same
	// slot, which collapsed the slot to zero width and overlapped the status
	// pills. The depth guard stops it rendering the surface; it must also stop it
	// claiming the strip.
	const appSlotTarget = usePortalTarget("topstrip-wf-slot", !!embedded && !nestedInSurface);
	const [params, setParams] = useSearchParams();
	const selected = params.get("selected");
	const initialCycle = params.get("cycle"); // deep-link anchor → open that run

	// "About this app" — the app's own summary, folded into the overview.
	const [about, setAbout] = useState<string>(() => aboutCache.get(app) ?? "");
	useEffect(() => {
		let live = true;
		me.appConfig(app)
			.then((r) => {
				if (!live) return;
				const m = (r.yaml || "").match(/^summary:[ \t]*(.+?)[ \t]*$/m);
				const s = m ? m[1].replace(/^["']|["']$/g, "").trim() : "";
				setAbout(s); aboutCache.set(app, s);
			})
			.catch(() => { /* no config / not permitted → no about line */ });
		return () => { live = false; };
	}, [app]);

	const load = useCallback(async () => {
		const [lhR, wfR, uaR] = await Promise.allSettled([me.loopsHealth(), me.listWorkflows("scheduled"), me.listApps()]);
		// A failed workflows poll (429 rate-limit storm, network blip, token
		// refresh) must NOT blank the page — keep the last-good rows and retry
		// next tick. Without this, a transient 429 set rows=[] and the app page
		// rendered the empty surface/"no workflows" state instead of the loops.
		if (wfR.status !== "fulfilled") return;
		const lhMap = new Map<string, LoopHealth>();
		// Configured display name/icon (ui.sidebar) — same source as the sidebar.
		const uiCfg = uaR.status === "fulfilled" ? (uaR.value.apps || []).find((a) => a.name === app)?.ui : undefined;
		// Drive from listWorkflows (tenant-correct) so the user's own
		// workflows always show; enrich with loop health when present.
		const wfs = wfR.status === "fulfilled" ? (wfR.value.workflows || []).filter((w) => w.app === app) : [];
		// Version: /me/loops/health is OPERATOR-scoped, so its `ident` carries NO
		// version for TENANT installs (the app is absent there) — fall back to the
		// tenant workflow rows' version. Without this the panel's Agents version
		// bar read empty for every tenant app even though the agent repo exists.
		const wfVersion = wfs.find((w) => w.version)?.version;
		if (lhR.status === "fulfilled") {
			const resp = lhR.value as unknown as LoopsHealthResp;
			for (const l of (resp.loops || []).filter((l) => l.app === app)) lhMap.set(l.loop, l);
			const ident = (resp.apps || []).find((a) => a.app === app);
			if (ident || uiCfg || wfVersion) {
				const id = {
					version: ident?.version || wfVersion, kind: ident?.kind, published: ident?.published, status: ident?.status,
					label: uiCfg?.sidebar?.label, icon: uiCfg?.sidebar?.icon,
					hasSurface: !!(uiCfg?.surface || (uiCfg?.surfaces && Object.keys(uiCfg.surfaces).length > 0)),
				};
				identCache.set(app, id); setIdentity(id);
			}
		}
		const next = wfs.map((w) => { const loop = loopOf(w); return { loop, wf: w, lh: lhMap.get(loop) }; });
		rowsCache.set(app, next);
		setRows(next);
	}, [app]);
	useEffect(() => {
		load();
		const id = window.setInterval(load, 20_000);
		return () => window.clearInterval(id);
	}, [load]);
	useStudioRefetch(["workflows", "loops", "cycles", "runs"], load);

	// Announce the active app so the chat agent knows what "pause it" means.
	useEffect(() => {
		setStudioSelection({ kind: "app", id: app, label: app, affordances: ["patch_loop (schedule/enabled)", "run_loop_now", "list_loops"] });
		return () => setStudioSelection(null);
	}, [app]);

	// Master–detail selection: there is ALWAYS a selected workflow (the
	// detail column never goes empty), so selecting never deselects.
	const select = (loop: string) => {
		const sp = new URLSearchParams(params);
		sp.set("selected", loop);
		setParams(sp, { replace: true });
		// Mobile: the detail renders below the list — bring it into view.
		window.setTimeout(() => document.getElementById("wf-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
	};
	// Show the app-level overview LIST — the "Overview" tab (opt-in; the panel
	// is the default view).
	const selectOverview = () => {
		const sp = new URLSearchParams(params);
		sp.set("selected", OVERVIEW_SEL);
		setParams(sp, { replace: true });
	};

	// App-level delete is offered for every app: the uninstall intent now
	// archives operator-shared apps (e.g. auto-quant) too — it resolves the
	// app in the tenant tree OR the operator-shared root and moves it to
	// .xp/.trash (recoverable). Per-LOOP delete below stays tenant-only.
	// Async via the uninstall intent; we navigate home optimistically.
	const isTenantApp = !!rows && rows.some((r) => r.wf.tenant);
	const del = async () => {
		if (deleting) return;
		if (!window.confirm(
			`Delete "${appTitle(app)}"?\n\nThis uninstalls the agent and removes it from ` +
			`your agents. The bundle (incl. run history) is archived to .xp/.trash and is ` +
			`recoverable; any scheduled workflows stop running.`)) return;
		setDeleting(true);
		try {
			await me.uninstallApp(app);
			toast.success(`Deleting ${appTitle(app)}…`);
			recentlyDeleted.add(app);   // hide from the grid immediately (async uninstall)
			rowsCache.delete(app);
			identCache.delete(app);
			window.setTimeout(() => navigate("/studio/apps"), 1200);
		} catch (e) {
			toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
			setDeleting(false);
		}
	};

	// Pull / publish — toolbar buttons (fork + propose happen in xpio, not here).
	const [shareBusy, setShareBusy] = useState<null | "pull" | "publish">(null);
	// Pull/publish push the AGENT (app) repo — the buttons now live in the
	// workflow panel header (passed down via onShare); shareAction stays here.
	const shareAction = async (kind: "pull" | "publish", path: string, okMsg: string) => {
		setShareBusy(kind);
		try {
			await apiClient.post(`/api/v1/me/apps/${encodeURIComponent(app)}/${path}`, {});
			toast.success(okMsg);
		} catch (e) {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const msg = (e as any)?.response?.data?.message || (e instanceof Error ? e.message : String(e));
			toast.error(`Failed: ${String(msg).slice(0, 180)}`);
		} finally { setShareBusy(null); }
	};

	// Per-workflow (loop) hard-delete — only for the user's own apps, and never
	// the last loop (the backend blocks that; we also hide the button then).
	const [deletingLoop, setDeletingLoop] = useState<string | null>(null);
	const delLoop = async (loop: string, label: string) => {
		if (deletingLoop) return;
		if (!window.confirm(
			`Delete workflow "${label}" from ${appTitle(app)}?\n\n` +
			`Removes it and its run history. This cannot be undone.`)) return;
		setDeletingLoop(loop);
		try {
			await me.deleteLoop(app, loop);
			toast.success(`Removed workflow "${label}"`);
			rowsCache.delete(app);
			if (selected === loop) {
				const sp = new URLSearchParams(params);
				sp.delete("selected");
				setParams(sp, { replace: true });
			}
			await load();
		} catch (e) {
			toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setDeletingLoop(null);
		}
	};

	// DEFAULT = the freshest workflow's PANEL (the detailed view). The Overview
	// LIST is an explicit opt-in via the "Overview" tab (?selected=__overview__).
	const freshestLoop = rows && rows.length
		? [...rows].sort((a, b) => (b.wf.last_run_ts || 0) - (a.wf.last_run_ts || 0))[0].loop
		: null;
	// Land on the app's OWN page when it declares one and nothing specific was
	// requested. Defaulting to the freshest workflow meant an authored overview
	// was reachable only by clicking a tab nobody knew to click — the app's
	// front door sat behind its own observability panel.
	//
	// An EXPLICIT `?surface=` in the URL counts as declaring one. `hasSurface`
	// is INFERRED — it comes from the `ui:` block on /me/apps, which identity
	// can only fill in for an app it can read locally or whose published spec
	// it managed to fetch. Identity mounts no tenant volume, so for a
	// cloud-installed app that inference fails silently and the app is
	// downgraded to "workflow app": /studio/apps/<app>?surface=runtime rendered
	// the run-trajectory panel instead of the Runtime surface, on an account
	// where the app was installed, healthy and listed in the sidebar.
	//
	// The doc links these surfaces, so the failure lands on a reader following
	// the walkthrough. A URL that names a surface is not a hint to weigh
	// against a probe — it is the request. AppSurface already renders an honest
	// "no page yet" when the surface genuinely is not there, so trusting the
	// URL costs nothing when the inference was right to be false.
	const urlSurface = (params.get("surface") || "").trim();
	const overviewMode = selected ? selected === OVERVIEW_SEL : (!!identity?.hasSurface || !!urlSurface);
	const validSelected = selected && rows?.some((r) => r.loop === selected) ? selected : null;
	const validInitial = initialLoop && rows?.some((r) => r.loop === initialLoop) ? initialLoop : null;
	const effSelected = overviewMode ? null : (validSelected ?? validInitial ?? freshestLoop);
	const selectedRow = rows?.find((r) => r.loop === effSelected) ?? null;

	return (
		<div className="space-y-5">
			{!embedded && (
				<Link to="/studio/apps" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 gap-1">
					<ChevronRight className="w-4 h-4 rotate-180" /> My Agents
				</Link>
			)}

			{/* In the workspace (embedded), the AppSwitcher in the workspace header
			    owns identity + delete — so this big icon/name header is dropped to
			    avoid printing the app name twice. */}
			{!embedded && (
				<header className="flex items-start gap-3">
					<div className="w-10 h-10 rounded-xl bg-gold-50 text-gold-600 flex items-center justify-center flex-shrink-0">
						<Boxes className="w-5 h-5" />
					</div>
					<div className="min-w-0">
						<h1 className="text-lg font-semibold text-slate-900">{identity?.label || appTitle(app)}</h1>
						<div className="text-xs text-slate-400 font-mono mt-0.5">
							{app}{identity?.version ? ` · v${identity.version}` : ""}{identity?.published ? " · published" : ""}
						</div>
					</div>
					<button
						type="button"
						onClick={del}
						disabled={deleting}
						title="Delete this agent — archives it (recoverable) and removes it from your agents"
						className="ml-auto flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
					>
						<Trash2 className="w-3.5 h-3.5" />
						{deleting ? "Deleting…" : "Delete"}
					</button>
				</header>
			)}

			{/* Per-app subtitle (the xpcloud.yaml summary) removed — the title +
			    runtime strip carry enough; the full summary still lives in the
			    "About this app" overview section. */}

			{/* Runtime & harness — what the agent runs ON (runtime, engine pattern,
			    workflows, schedule, memory banks). Derived from the already-loaded
			    rows/identity; only shown once there are scheduled workflows. */}
			{rows !== null && rows.length > 0 && (
				<RuntimeStrip rows={rows} identity={identity} embedded={embedded} />
			)}

			{rows === null ? (
				// No spiral/logo animation on app switch — just a calm skeleton.
				<Skeleton lines={3} />
			) : rows.length === 0 ? (
				// No workflows → this is a UI-surface app; show its surface (or its
				// own "generate a page" CTA) instead of a dead-end message. Negative
				// margins cancel the AppOverview body padding so the surface (which
				// brings its own chrome + padding) sits flush in the panel.
				//
				// NESTED GUARD — same rule as the overview branch below. A surface
				// can mount this component again (ui/workflows.md → lumid:native
				// key: app-workflows), and this branch was the one mount of
				// AppSurface WITHOUT the guard: an app whose workflow rows came
				// back empty recursed surface → native → overview → surface until
				// React gave up, portaling a tab bar into the top strip per level
				// (observed on quant-research 2026-09-04, ~9 deep). Inside a
				// surface, an empty row set renders the honest empty state instead.
				nestedInSurface ? (
					<div className="text-sm text-slate-500 px-1 py-2">
						No workflows discovered for this app yet — they appear here once
						the scheduler reports them (or after the first run).
					</div>
				) : (
				<div className="-mx-5 -my-5">
					<Suspense fallback={<div className="px-5 py-8"><Skeleton lines={4} /></div>}>
						<AppSurface app={app} embedded={embedded} surface={params.get("surface") || undefined} />
					</Suspense>
				</div>
				)
			) : (
				// The workflow LIST is consolidated into a dropdown, surfaced (with
				// "New workflow") in the top strip next to the app name when embedded.
				// The panel shows ONLY the selected workflow — its content (pipeline /
				// runs / data / insights) is tabbed inside the panel.
				<div className="space-y-3.5">
					{(() => {
						// Top strip nav: [Overview tab] + the workflow selector. EVERY app
						// (incl. single-workflow) shows Overview + the selector, so the bar
						// is consistent — a single workflow (e.g. case_cycle) lives INSIDE
						// the selector dropdown, not as a separate static tab.
						const cluster = (
							<>
								{/* An app that declares its own nav already has an Overview tab
								    (nav[0] → surface `home`), styled identically. Two lit pills for
								    one destination, and this one tracked ?selected= while the tabs
								    track ?surface=, so it stayed lit on every surface. The app's
								    tab bar owns navigation; this pill only exists for apps without one. */}
								{!identity?.hasSurface && (
									<button
										type="button"
										onClick={selectOverview}
										title="App overview — every workflow at a glance"
										className={cn(
											"px-2.5 py-1 rounded-lg text-[12px] flex-shrink-0 transition-colors",
											overviewMode ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
										)}
									>Overview</button>
								)}
								{rows.length >= 1 && (
									<WorkflowSelect rows={rows} selected={effSelected} onSelect={select}
										onNew={() => navigate(`/studio/a/${encodeURIComponent(app)}/manage`)} />
								)}
								{/* Slot: the open workflow panel hoists its run controls (status ·
								    version dots · pull/publish · plan-next · pause) onto this line. */}
								<span id="topstrip-wf-controls" className="flex items-center gap-1.5 flex-wrap min-w-0" />
							{/* App actions ("⋯") — Manage / Advanced / Remove. Workflow apps
								    were missing this; only surface apps (AppSurface) had it. */}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 shadow-sm transition-all flex-shrink-0"
											title="App actions" aria-label="App actions"
										>
											<MoreHorizontal className="w-4 h-4" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-52">
										<DropdownMenuItem asChild>
											<Link to={`/studio/a/${encodeURIComponent(app)}/edit`} title="Edit this page (surface markdown / layout)">
												<Pencil className="w-3.5 h-3.5" /> Edit this page
											</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link to={`/studio/a/${encodeURIComponent(app)}/manage`} title="name, workflows, skills">
												<SlidersHorizontal className="w-3.5 h-3.5" />
												<span className="flex flex-col">
													<span>Manage agent</span>
													<span className="text-[11px] text-slate-500">name, workflows, skills</span>
												</span>
											</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link to={`/studio/a/${encodeURIComponent(app)}/config`}>
												<Settings className="w-3.5 h-3.5" /> Advanced (YAML)
											</Link>
										</DropdownMenuItem>
										{/* Delete THIS workflow (one loop) — folded in here so the top
										    strip has a single "⋯" instead of two adjacent ones (the
										    open workflow panel used to hoist its own delete menu). */}
										{!overviewMode && selectedRow && (
											<>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onSelect={() => delLoop(selectedRow.loop, loopLabel(selectedRow.wf.name, selectedRow.loop))}
													className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
												>
													<Trash2 className="w-3.5 h-3.5" /> Delete workflow
												</DropdownMenuItem>
											</>
										)}
										<DropdownMenuSeparator />
										<DropdownMenuItem
											disabled={deleting}
											onSelect={() => del()}
											className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
										>
											<Trash2 className="w-3.5 h-3.5" /> {deleting ? "Removing…" : "Remove agent…"}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</>
						);
						// Embedded → portal into the top strip beside the app name; the
						// portal target may resolve a tick late, so fall back to inline.
						//
						// A NESTED overview renders no chrome at all. When an app mounts
						// `lumid:native app-workflows` as a surface there are two
						// AppOverviews on the page: the outer one owns the strip, the nested
						// one is a panel inside it — and because the nested one cannot claim
						// the strip it fell back to inline, so "Pick a workflow · 10
						// workflows" appeared TWICE on quant-research's Workflows tab (top
						// bar, then again in the panel). The outer chrome is the app's
						// chrome; the nested panel just lists.
						if (embedded && nestedInSurface) return null;
						return embedded && appSlotTarget
							? createPortal(<div className="flex items-center gap-2 min-w-0">{cluster}</div>, appSlotTarget)
							: <div className="flex items-center gap-2 flex-wrap">{cluster}</div>;
					})()}
					<Suspense fallback={<Skeleton lines={3} />}>
						{overviewMode ? (
							// ── App-level OVERVIEW — the app's story (re-authored from the
							// old lum.id/<app> landing page). No workflow list / data here;
							// pick a workflow from the top-bar dropdown to drill in. Apps
							// without curated copy fall back to the workflow list so the
							// overview is never blank. ──
							<div className="space-y-6 animate-in fade-in duration-200">
								{(identity?.hasSurface || !!urlSurface) && !nestedInSurface ? (
									// The app DECLARED a page — that wins. Previously the surface
									// rendered only for apps with zero workflows, so any app that
									// scheduled one lost its own overview to APP_OVERVIEW_MD (copy
									// hardcoded in this bundle, keyed by app name) or to a bare
									// workflow list. An app's page then could not be changed by
									// editing the app, which is backwards: the app supplies the
									// environment, the UI stays generic.
									// inlineChrome: the app's chrome (tabs + New workflow + share
									// actions) needs ~600px and the strip slot resolves to ~180 beside
									// the app name and the workflow selector — portaled, the five tabs
									// wrapped to one per line and stacked under "New workflow". Inline
									// they get the panel's full width. The tabs are still the ONLY tab
									// bar; the strip's duplicate Overview pill is gone either way.
									<div className="-mx-5 -my-5">
										<Suspense fallback={<div className="px-5 py-8"><Skeleton lines={4} /></div>}>
											<AppSurface app={app} embedded={embedded} inlineChrome surface={params.get("surface") || undefined} />
										</Suspense>
									</div>
								) : APP_OVERVIEW_MD[app] ? (
									<div className="max-w-3xl studio-prose">
										<LumidMarkdown source={APP_OVERVIEW_MD[app]} />
									</div>
								) : (
									<div className="space-y-2">
										<div className="text-[11px] tracking-[0.08em] font-semibold text-slate-500 uppercase">Workflows</div>
										<WorkflowList rows={rows} selected={null} onSelect={select} />
									</div>
								)}
							</div>
						) : (
							<div id="wf-detail" className="min-w-0">
								{selectedRow && (
									<WorkflowObservabilityPanel
										app={app} loop={selectedRow.loop} wf={selectedRow.wf} loopHealth={selectedRow.lh}
										identity={identity}
										onShare={(action) => action === "pull"
											? shareAction("pull", "update", "Update queued — upstream changes merge in ~a minute (your edits are preserved).")
											: shareAction("publish", "publish", "Publish queued — your repo updates in ~a minute.")}
										shareBusy={shareBusy}
										onChanged={load}
										initialCycle={(effSelected === (selected ?? initialLoop)) ? initialCycle : null}
										canDelete={isTenantApp && rows.length > 1}
										onDelete={() => delLoop(selectedRow.loop, loopLabel(selectedRow.wf.name, selectedRow.loop))}
									/>
								)}
							</div>
						)}
					</Suspense>
				</div>
			)}

		</div>
	);
}

export default function StudioApps() {
	const { app } = useParams<{ app?: string }>();
	return app ? <AppOverview app={app} /> : <AppsHome />;
}

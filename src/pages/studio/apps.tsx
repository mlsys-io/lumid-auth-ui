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
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, ArrowRight, Boxes, Sparkles, Wrench, Brain, Activity, AlertTriangle, Trash2, Inbox, Loader2, RotateCcw, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { me, type MeWorkflowRow, type MeAppCard } from "@/api/me";
import { takePendingCustomize } from "@/lib/just-installed";
import apiClient from "@/api/client";
import { iconFor, APP_NAV_INVALIDATE } from "@/components/useAppNav";
import { setStudioSelection } from "@/components/StudioContext";
import { Skeleton, humanizeLoop, loopLabel } from "@/pages/app-revamp/loops";
import { QuickStarters } from "@/components/studio/QuickStarters";
import WorkflowComposer from "@/components/WorkflowComposer";
import AppCard, { appTitle, type AppIdentity } from "@/components/workflow/AppCard";
import type { LoopHealth } from "@/components/workflow/WorkflowObservabilityPanel";
import NeedsAttentionRail from "@/components/workflow/NeedsAttentionRail";
import IndexList, { type IndexRow } from "@/components/studio/IndexList";
import { askApp } from "@/lib/grounded-asks";
import LoopOrbit, { type LoopMode, type LoopStageKey } from "@/components/workflow/LoopOrbit";

// Heavy, AppOverview-only components — lazy so the /studio/apps INDEX chunk
// (AppsHome) doesn't statically pull the DAG canvas (@xyflow → vendor-flow) +
// charts (recharts → vendor-charts) that only the per-app overview renders.
// They load on demand when an overview actually mounts them.
const WorkflowObservabilityPanel = lazy(() => import("@/components/workflow/WorkflowObservabilityPanel"));
const WorkflowList = lazy(() => import("@/components/workflow/WorkflowList"));
const DatasetExplorer = lazy(() => import("@/components/workflow/DatasetExplorer"));
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
		return <div className="space-y-6"><div className="h-20 rounded-xl bg-slate-100 animate-pulse" /><Skeleton lines={3} /></div>;
	}

	const apps = [...byApp.keys()].sort();
	const fresh = apps.length === 0 && uiApps.length === 0 && pendingApps.length === 0;

	// Build the claude-style index rows — one common shape across every app
	// type (loop apps + UI-surface apps). Failing apps float into a "Needs
	// attention" group that leads the list; otherwise they group by the same
	// ui.sidebar.section the left nav uses. Clicking a row opens the grounded
	// chat (askApp); the old observability panel stays one click away via the
	// hover-only "details →" link.
	const SECTION_ORDER = ["Needs attention", "Compute", "Research", "Trading", "Knowledge", "Apps"];
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
			section: failing > 0 ? "Needs attention" : (sections.get(a) || "Apps"),
			ask: askApp(a),
			detailsHref: `/studio/apps/${encodeURIComponent(a)}?full=1`,
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
		section: a.ui?.sidebar?.section || "Apps",
		ask: askApp(a.name),
		detailsHref: `/studio/a/${encodeURIComponent(a.name)}?full=1`,
	} as IndexRow));
	const allRows = [...appRows, ...surfaceRows];

	const launcher = (
		<div className="border-t border-border pt-5">
			<QuickStarters heading="Set up a new app" />
		</div>
	);

	return (
		<>
			<WorkflowComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
			{fresh ? (
				// Fresh user — lead with the launcher so they assemble app #1.
				<div className="max-w-[760px] mx-auto w-full space-y-6 px-1 py-2">
					<div className="rounded-2xl border border-border bg-card p-6">
						<div className="flex items-center gap-3">
							<div className="w-11 h-11 rounded-xl bg-foreground text-background flex items-center justify-center">
								<Sparkles className="w-5 h-5" />
							</div>
							<div>
								<h2 className="font-display text-xl font-medium text-foreground tracking-tight">Set up your first app.</h2>
								<p className="text-sm text-muted-foreground mt-1">Pick a starter and your AI assembles an app — schedules its workflows and runs them for you. Progress lives here.</p>
							</div>
						</div>
					</div>
					<QuickStarters heading="Start with a starter" />
				</div>
			) : (
				<div className="panel-in-left" ref={appsRef}>
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
						title="Apps"
						rows={allRows}
						search={allRows.length > 6}
						searchPlaceholder="Search apps…"
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
			<StatChip icon={Boxes} value={h.apps} label="apps" tone="text-slate-400" onClick={onApps} />
			<StatChip icon={Activity} value={h.workflows} label="workflows" tone="text-slate-400" onClick={onApps} />
			<StatChip icon={Sparkles} value={h.runsToday} label="runs today" tone="text-slate-400" to="/studio/runs" />
			{h.selfHeals > 0 && <StatChip icon={Wrench} value={h.selfHeals} label="auto-recovered" tone="text-slate-400" title="workflows that recovered from a failed run on their own" onClick={onApps} />}
			<StatChip icon={Brain} value={h.memories} label="learned" tone="text-slate-400" title="insights your apps saved from recent runs" to="/studio/knowledge" />
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

// Stale-while-revalidate caches so re-opening an app renders instantly
// (no skeleton flash) while a fresh fetch updates in the background.
const rowsCache = new Map<string, Row[]>();
const identCache = new Map<string, AppIdentity | undefined>();

export function AppOverview({ app, embedded, initialLoop, hideLeft }: { app: string; embedded?: boolean; initialLoop?: string | null; hideLeft?: boolean }) {
	const [rows, setRows] = useState<Row[] | null>(() => rowsCache.get(app) ?? null);
	const [identity, setIdentity] = useState<AppIdentity | undefined>(() => identCache.get(app));
	const [deleting, setDeleting] = useState(false);
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const selected = params.get("selected");
	const initialCycle = params.get("cycle"); // deep-link anchor → open that run

	const load = useCallback(async () => {
		const [lhR, wfR, uaR] = await Promise.allSettled([me.loopsHealth(), me.listWorkflows("scheduled"), me.listApps()]);
		const lhMap = new Map<string, LoopHealth>();
		// Configured display name/icon (ui.sidebar) — same source as the sidebar.
		const uiCfg = uaR.status === "fulfilled" ? (uaR.value.apps || []).find((a) => a.name === app)?.ui : undefined;
		if (lhR.status === "fulfilled") {
			const resp = lhR.value as unknown as LoopsHealthResp;
			for (const l of (resp.loops || []).filter((l) => l.app === app)) lhMap.set(l.loop, l);
			const ident = (resp.apps || []).find((a) => a.app === app);
			if (ident || uiCfg) {
				const id = {
					version: ident?.version, kind: ident?.kind, published: ident?.published, status: ident?.status,
					label: uiCfg?.sidebar?.label, icon: uiCfg?.sidebar?.icon,
					hasSurface: !!(uiCfg?.surface || (uiCfg?.surfaces && Object.keys(uiCfg.surfaces).length > 0)),
				};
				identCache.set(app, id); setIdentity(id);
			}
		}
		// Drive from listWorkflows (tenant-correct) so the user's own
		// workflows always show; enrich with loop health when present.
		const wfs = wfR.status === "fulfilled" ? (wfR.value.workflows || []).filter((w) => w.app === app) : [];
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

	// App-level delete is offered for every app: the uninstall intent now
	// archives operator-shared apps (e.g. auto-quant) too — it resolves the
	// app in the tenant tree OR the operator-shared root and moves it to
	// .xp/.trash (recoverable). Per-LOOP delete below stays tenant-only.
	// Async via the uninstall intent; we navigate home optimistically.
	const isTenantApp = !!rows && rows.some((r) => r.wf.tenant);
	const del = async () => {
		if (deleting) return;
		if (!window.confirm(
			`Delete "${appTitle(app)}"?\n\nThis uninstalls the app and removes it from ` +
			`your apps. The bundle (incl. run history) is archived to .xp/.trash and is ` +
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

	// There is always a selection: URL param (if it names a real workflow —
	// some deep links pass the APP name), then the caller's initialLoop,
	// then the freshest workflow.
	const freshestLoop = rows && rows.length
		? [...rows].sort((a, b) => (b.wf.last_run_ts || 0) - (a.wf.last_run_ts || 0))[0].loop
		: null;
	const validSelected = selected && rows?.some((r) => r.loop === selected) ? selected : null;
	const validInitial = initialLoop && rows?.some((r) => r.loop === initialLoop) ? initialLoop : null;
	const effSelected = validSelected ?? validInitial ?? freshestLoop;
	const selectedRow = rows?.find((r) => r.loop === effSelected) ?? null;

	return (
		<div className="space-y-5">
			{!embedded && (
				<Link to="/studio/apps" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 gap-1">
					<ChevronRight className="w-4 h-4 rotate-180" /> My Apps
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
						title="Delete this app — archives it (recoverable) and removes it from your apps"
						className="ml-auto flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
					>
						<Trash2 className="w-3.5 h-3.5" />
						{deleting ? "Deleting…" : "Delete"}
					</button>
				</header>
			)}

			{rows === null ? (
				<Skeleton lines={3} />
			) : rows.length === 0 ? (
				<div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
					No workflows discovered for this app yet.
				</div>
			) : (
				<div className="space-y-2.5">
					<div className="text-[11px] tracking-[0.08em] font-semibold text-slate-400 uppercase">Workflows</div>
					{/* Master–detail: list left, ONE detail card right. A single-
					    workflow app skips the list entirely. Suspense boundary for
					    the lazy DAG/charts panels (kept out of the index chunk). */}
					<Suspense fallback={<Skeleton lines={3} />}>
					{rows.length === 1 ? (
						selectedRow && (
							<div id="wf-detail">
								<WorkflowObservabilityPanel
									app={app} loop={selectedRow.loop} wf={selectedRow.wf} loopHealth={selectedRow.lh}
									onChanged={load} initialCycle={initialCycle}
								/>
							</div>
						)
					) : (
						<div className={hideLeft ? "" : "lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 lg:items-start"}>
							{!hideLeft && (
							<div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto mb-4 lg:mb-0 pr-0.5 space-y-5">
								<WorkflowList
									rows={rows}
									selected={effSelected}
									onSelect={select}
								/>
								{/* + New workflow — creation lived only in the Manage panel;
								    surface it right under the list. */}
								<button
									type="button"
									onClick={() => navigate(`/studio/a/${encodeURIComponent(app)}/manage`)}
									className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-border text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
								>
									<Plus className="w-3.5 h-3.5" /> New workflow
								</button>
								{/* "What it's learned" removed (low signal). Datasets kept. */}
								<div className="space-y-2">
									<div className="text-[11px] tracking-[0.08em] font-semibold text-slate-400 uppercase">Data it works on</div>
									<DatasetExplorer app={app} />
								</div>
							</div>
							)}
							<div id="wf-detail" className="min-w-0">
								{selectedRow && (
									<WorkflowObservabilityPanel
										app={app} loop={selectedRow.loop} wf={selectedRow.wf} loopHealth={selectedRow.lh}
										onChanged={load}
										initialCycle={effSelected === (selected ?? initialLoop) ? initialCycle : null}
										canDelete={isTenantApp && rows.length > 1}
										onDelete={() => delLoop(selectedRow.loop, loopLabel(selectedRow.wf.name, selectedRow.loop))}
									/>
								)}
							</div>
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

// TopStatusStrip — the canonical page header for /studio/*.
//
// Renders four things:
//   - Page icon + title + subtitle on the left (from the route map)
//   - Breadcrumb on detail routes (Workflows › <slug>, Runs › <id>)
//   - Status pills on the right (drafts pending, running, failing today)
//   - "● All clear" indicator when no pills are active
//
// Pages no longer render their own H1 + subtitle — that lived inside
// each page's header section and duplicated the top-bar text when the
// top-bar was used for navigation. Centralising here keeps the top-bar
// always populated, removes the duplicate, and means new pages just
// register one row in PAGE_META below.

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
	FileText, Activity, AlertTriangle, ChevronRight,
	Sparkles, Inbox as InboxIcon,
	Store, Brain, Settings, Shield, Activity as ActivityIcon, Boxes, ListChecks, LayoutDashboard,
} from "lucide-react";
import { me, type MeWorkflowRow } from "@/api/me";
import { RUNNING_APPS } from "@/lib/demo";
import { appTitle } from "@/components/workflow/AppCard";
import AppSwitcher from "@/components/studio/AppSwitcher";
import { TONES, type ToneKey } from "@/lib/tones";
import { loopLabel } from "@/lib/workflow-names";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";

// One actionable item for the top-bar "Right now" ticker.
interface TickerItem { key: string; tone: ToneKey; icon: React.ComponentType<{ className?: string }>; text: string; action: string; to: string }

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || "";
	if (app && w.slug.startsWith(app + ":")) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(":");
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

// Same scope filter as the My Apps page: count only the user's own apps,
// not operator-shared ones that listWorkflows() also returns — otherwise the
// header's failing count diverges from the hero/cards (the "3 vs 1" bug).
const inScope = (app?: string) => !app || (RUNNING_APPS as readonly string[]).includes(app);

// Per-route page identity. Subtitle is short — top-bar height is bounded.
const PAGE_META: Array<{
	pattern: RegExp;
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	subtitle?: string;
	iconTone: string; // text color class for the icon
}> = [
	{
		pattern: /^\/studio\/apps\/[^/]+/,
		icon: Boxes,
		title: "Agent",
		subtitle: "Workflows, status, insights, and suggested improvements.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/apps/,
		icon: Boxes,
		title: "Agents",
		subtitle: "Your agents and their ongoing progress.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/(intents|today)/,
		icon: Sparkles,
		title: "Agents",
		subtitle: "Your goals this week. Outcomes graded; judgment encoded.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/inbox/,
		icon: InboxIcon,
		title: "Inbox",
		subtitle: "Drafts, runs, notices, and the audit trail — in one feed.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/runs\/[^/]+/,
		icon: ActivityIcon,
		title: "Run",
		subtitle: "Per-step DAG + timeline.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/runs/,
		icon: ActivityIcon,
		title: "Jobs",
		subtitle: "Your recent runs — open any to ask about it.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/library\/skills/,
		icon: Store,
		title: "Skills",
		subtitle: "The capabilities your apps import — health, versions, who uses what.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/library\/experiments/,
		icon: Store,
		title: "Experiments",
		subtitle: "Hypotheses your apps are testing, across every app.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/(library|marketplace)/,
		icon: Store,
		title: "Library",
		subtitle: "Marketplace, skills, and experiments — pull in, refine, publish back.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/knowledge\/[^/]+/,
		icon: Brain,
		title: "Agent knowledge",
		subtitle: "Memories the agent has banked.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/knowledge/,
		icon: Brain,
		title: "Knowledge",
		subtitle: "What's been encoded — yours, audited, portable.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/dashboard\/jobs/,
		icon: ListChecks,
		title: "My Jobs",
		subtitle: "Background runs across cron, FlowMesh, Lumilake, and workflow cycles.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/settings/,
		icon: Settings,
		title: "Settings",
		subtitle: "Account, tokens, connected services, and privacy — all in one place.",
		iconTone: "text-muted-foreground",
	},
	{
		pattern: /^\/studio\/admin/,
		icon: Shield,
		title: "Admin",
		subtitle: "Operator-only.",
		iconTone: "text-muted-foreground",
	},
];

function deriveMeta(pathname: string) {
	for (const m of PAGE_META) {
		if (m.pattern.test(pathname)) return m;
	}
	// Dashboard fallback — the /dashboard tree (incl. the ported admin
	// pages) gets a derived identity instead of a blank corner + generic
	// tab title. Title = humanized last meaningful path segment.
	if (pathname.startsWith("/dashboard")) {
		const segs = pathname.split("/").filter(Boolean);
		const last = decodeURIComponent(segs[segs.length - 1] || "dashboard");
		const title = last === "dashboard"
			? "Dashboard"
			: last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]/g, " ");
		return {
			pattern: /^\/dashboard/,
			icon: pathname.startsWith("/dashboard/admin") || pathname.startsWith("/dashboard/super-admin") ? Shield : LayoutDashboard,
			title,
			subtitle: undefined as string | undefined,
			iconTone: "text-muted-foreground",
		};
	}
	return null;
}

// Breadcrumb derivation — only on detail routes where there's a parent
// hop worth surfacing. Two-segment max; the page title (above) carries
// the leaf identity.
function deriveCrumbs(pathname: string): Array<{ label: string; to: string }> {
	// /studio/apps/:app is the workspace — its in-page AppSwitcher owns the app
	// identity, so the top bar shows no "My Apps / <app>" crumb (was printed
	// twice). /apps/all (the grid) keeps no crumb either.
	const m2 = pathname.match(/^\/studio\/runs\/([^/]+)/);
	if (m2) return [{ label: "Activity", to: "/studio/runs" }];
	// Cycle inspector is reached from an app's workflow panel.
	const m3 = pathname.match(/^\/studio\/(?:intents|today)\/cycle\/([^/]+)\/([^/]+)\/[^/]+/);
	if (m3) return [{ label: "My Apps", to: "/studio/apps" }, { label: appTitle(decodeURIComponent(m3[1])), to: `/studio/apps/${m3[1]}?selected=${m3[2]}` }];
	// T13 — /studio/intents/:slug shows the autoresearch detail panel.
	// Match it AFTER the cycle regex so the cycle path isn't shadowed.
	const m3b = pathname.match(/^\/studio\/intents\/[^/]+/);
	if (m3b) return [{ label: "Intents", to: "/studio/intents" }];
	const m4 = pathname.match(/^\/studio\/knowledge\/[^/]+/);
	if (m4) return [{ label: "Knowledge", to: "/studio/knowledge" }];
	return [];
}

function detailLeafFor(pathname: string): string | null {
	// apps/:app handled by the in-page AppSwitcher (no top-bar leaf) — but keep
	// the document.title useful below via the meta title.
	const m2 = pathname.match(/^\/studio\/runs\/([^/]+)/);
	if (m2) return decodeURIComponent(m2[1]);
	const m4 = pathname.match(/^\/studio\/knowledge\/([^/]+)/);
	if (m4) return decodeURIComponent(m4[1]);
	return null;
}

export default function TopStatusStrip() {
	const location = useLocation();
	const [items, setItems] = useState<TickerItem[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
	const [, forceTick] = useState(0);
	// Ticker so the "live · updated Ns ago" stays current. 10s (was 1s) — a
	// per-second re-render of the always-mounted header is needless churn;
	// "Ns ago" granularity to 10s reads the same to a human.
	useEffect(() => {
		const id = window.setInterval(() => forceTick((x) => x + 1), 10_000);
		return () => window.clearInterval(id);
	}, []);

	const meta = useMemo(() => deriveMeta(location.pathname), [location.pathname]);
	const crumbs = useMemo(() => deriveCrumbs(location.pathname), [location.pathname]);
	// On an app workspace page the in-page AppSwitcher already shows the app
	// name, so the top strip's generic "App" identity is a redundant second
	// headline — suppress the left identity block there (keep the slot + ticker).
	const isAppWorkspace = useMemo(
		() => /^\/studio\/apps\/[^/]+/.test(location.pathname) && location.pathname !== "/studio/apps/all",
		[location.pathname],
	);
	// The app slug for the workspace identity (the AppSwitcher takes the "App"
	// place in the strip rather than leaving the left corner empty).
	const appSlug = useMemo(() => {
		if (!isAppWorkspace) return "";
		const m = location.pathname.match(/^\/studio\/apps\/([^/]+)/);
		return m ? decodeURIComponent(m[1]) : "";
	}, [isAppWorkspace, location.pathname]);

	// Keep the browser tab honest — index.html ships a static title, so
	// every page read "Sign in" forever. The leaf (app/run name) wins
	// over the registry title.
	useEffect(() => {
		const leaf = detailLeafFor(location.pathname);
		const title = leaf ?? deriveMeta(location.pathname)?.title;
		document.title = title ? `${title} · Lumid` : "Lumid Studio";
	}, [location.pathname]);

	// On detail routes, the "leaf" name (slug / run-id) lives in the URL
	// and is more specific than the registry's generic "Workflow" /
	// "Run" title. Surface it so the header reads naturally.
	const detailLeaf = useMemo(() => detailLeafFor(location.pathname), [location.pathname]);

	const load = async () => {
		try {
			const [wfR, drafts] = await Promise.allSettled([
				me.listWorkflows(),
				me.listDrafts({ state: "pending" }),
			]);
			let draftsCount = 0;
			if (drafts.status === "fulfilled") {
				draftsCount = drafts.value.drafts.length;
			}
			// Build the "Right now" ticker items (failing → running → drafts).
			// failing/running use the same scope + definitions as the app cards
			// (last_run_ok===false, excluding paused; running = cycle in-flight).
			const next: TickerItem[] = [];
			if (wfR.status === "fulfilled") {
				const wfs = (wfR.value.workflows || []).filter((w) => inScope(w.app));
				for (const w of wfs.filter((w) => w.enabled !== false && w.last_run_ok === false)) {
					const loop = loopOf(w);
					next.push({ key: w.slug, tone: "failing", icon: AlertTriangle, text: `${appTitle(w.app || "")} · ${loopLabel(w.name, loop)} failing`, action: "diagnose", to: `/studio/apps/${encodeURIComponent(w.app || "")}?selected=${encodeURIComponent(loop)}` });
				}
				for (const w of wfs.filter((w) => w.running)) {
					const loop = loopOf(w);
					next.push({ key: w.slug, tone: "running", icon: Activity, text: `${appTitle(w.app || "")} · ${loopLabel(w.name, loop)} running`, action: "watch", to: `/studio/apps/${encodeURIComponent(w.app || "")}?selected=${encodeURIComponent(loop)}` });
				}
			}
			if (draftsCount > 0) {
				next.push({ key: "drafts", tone: "ok", icon: FileText, text: `${draftsCount} draft${draftsCount === 1 ? "" : "s"} awaiting you`, action: "review", to: "/studio/inbox" });
			}
			setItems(next);
			setRefreshedAt(Date.now());
			setLoaded(true);
		} catch {
			setLoaded(true);
		}
	};

	// Chat→page bus: pills update right after a chat-tool mutation.
	useStudioRefetch(["drafts", "workflows", "loops", "runs", "cycles"], load);

	useEffect(() => {
		load();
		let timer: number | null = window.setInterval(load, 60_000);
		const onVisibility = () => {
			if (document.visibilityState === "visible") {
				load();
				if (timer == null) timer = window.setInterval(load, 60_000);
			} else if (timer != null) {
				window.clearInterval(timer);
				timer = null;
			}
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			if (timer != null) window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	// Empty top-right is fine — pills only render when there's actually
	// something for the user to act on. Removed the "● All clear" chip
	// (2026-05-25 design review) since silence is the right signal.

	const Icon = meta?.icon;

	return (
		<div className="flex-1 flex items-center justify-between gap-4 min-w-0">
			{/* App surfaces portal their nav tabs here (AppSurface) — the strip
			    otherwise sits empty on /studio/a/* and the tabs wasted a row. */}
			{/* Left — page identity. On an app workspace page the AppSwitcher
			    takes the "App" place (the app name shown once, here in the strip).
			    The workspace's left-panel toggle portals into the slot before it. */}
			{isAppWorkspace ? (
				<div className="flex items-center gap-1 min-w-0">
					<span id="topstrip-ws-left" className="flex items-center" />
					<AppSwitcher app={appSlug} />
				</div>
			) : (
			<div className="min-w-0 flex items-start gap-2.5">
				{Icon && (
					<Icon className={["w-5 h-5 flex-shrink-0 mt-0.5", meta?.iconTone || ""].join(" ")} />
				)}
				<div className="min-w-0">
					{/* Breadcrumb above the title on detail routes */}
					{crumbs.length > 0 && (
						<nav className="flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5">
							{crumbs.map((c, i) => (
								<span key={i} className="inline-flex items-center gap-1 min-w-0">
									{i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />}
									<Link to={c.to} className="hover:text-foreground transition-colors truncate">
										{c.label}
									</Link>
								</span>
							))}
						</nav>
					)}
					<h1 className="text-[15px] font-semibold text-foreground truncate leading-tight">
						{detailLeaf ?? meta?.title ?? ""}
					</h1>
					{meta?.subtitle && !detailLeaf && (
						<p className="text-[11px] text-muted-foreground mt-0.5 truncate hidden md:block">
							{meta.subtitle}
						</p>
					)}
				</div>
			</div>
			)}

			<div id="topstrip-app-slot" className="flex items-center gap-2 min-w-0 flex-1" />

			{/* Right — a steady "live" heartbeat (the surface is alive; loops
			    run in the background) + status pills (only when non-zero). */}
			<div className="flex items-center gap-2 flex-shrink-0">
				{/* Workspace's chat-panel toggle portals here. */}
				<span id="topstrip-ws-right" className="flex items-center" />
				<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Live — your loops run in the background">
					<span className="w-1.5 h-1.5 rounded-full bg-gold-500 heartbeat" />
					<span className="hidden sm:inline">live{(() => { const a = Math.max(0, Math.floor((Date.now() - refreshedAt) / 1000)); return a < 3 ? "" : a < 60 ? ` · ${a}s ago` : ` · ${Math.floor(a / 60)}m ago`; })()}</span>
				</span>
				{loaded && <RightNowTicker items={items} />}
			</div>
		</div>
	);
}

// RightNowTicker — the live digest as a single flipping line in the top-right.
// Shows ONE actionable item at a time (failing → running → drafts), auto-
// advancing every 4s with a quiet flip-in; each is a link to the relevant
// place. Replaces the old static count pills.
function RightNowTicker({ items }: { items: TickerItem[] }) {
	const [i, setI] = useState(0);
	useEffect(() => { setI(0); }, [items.length]);
	useEffect(() => {
		if (items.length <= 1) return;
		const id = window.setInterval(() => setI((x) => (x + 1) % items.length), 4000);
		return () => window.clearInterval(id);
	}, [items.length]);
	if (items.length === 0) return null;
	const it = items[Math.min(i, items.length - 1)];
	const t = TONES[it.tone];
	const Icon = it.icon;
	return (
		<Link
			to={it.to}
			title={`Right now — ${it.text}`}
			className="group inline-flex items-center gap-2 min-w-0 max-w-[260px] sm:max-w-[340px] px-2.5 py-1 rounded-full border border-border bg-card hover:bg-muted transition-colors"
		>
			<span className="text-[9px] uppercase tracking-[0.08em] font-semibold text-muted-foreground/70 shrink-0 hidden lg:inline">Now</span>
			{/* keyed so it re-mounts (and re-animates) on each flip */}
			<span key={`${it.key}-${i}`} className="inline-flex items-center gap-1.5 min-w-0 animate-in fade-in slide-in-from-bottom-1 duration-300">
				<Icon className={["w-3.5 h-3.5 shrink-0", t.icon].join(" ")} />
				<span className="truncate text-[12px] text-foreground">{it.text}</span>
				<span className={["text-[11px] font-medium shrink-0", t.text].join(" ")}>{it.action}</span>
			</span>
			{items.length > 1 && (
				<span className="text-[9px] text-muted-foreground/60 tabular-nums shrink-0">{i + 1}/{items.length}</span>
			)}
		</Link>
	);
}


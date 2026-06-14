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
import { me } from "@/api/me";
import { RUNNING_APPS } from "@/lib/demo";
import { appTitle } from "@/components/workflow/AppCard";
import { TONES, type ToneKey } from "@/lib/tones";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";

// Same scope filter as the My Apps page: count only the user's own apps,
// not operator-shared ones that listWorkflows() also returns — otherwise the
// header's failing count diverges from the hero/cards (the "3 vs 1" bug).
const inScope = (app?: string) => !app || (RUNNING_APPS as readonly string[]).includes(app);

interface Counts {
	drafts: number;
	running: number;
	failingToday: number;
}

const ZERO: Counts = { drafts: 0, running: 0, failingToday: 0 };

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
		title: "App",
		subtitle: "Workflows, status, insights, and suggested improvements.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/apps/,
		icon: Boxes,
		title: "Apps",
		subtitle: "Your apps and their ongoing progress.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/(intents|today)/,
		icon: Sparkles,
		title: "Apps",
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
	const ma = pathname.match(/^\/studio\/apps\/([^/]+)/);
	if (ma) return [{ label: "My Apps", to: "/studio/apps" }];
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
	const ma = pathname.match(/^\/studio\/apps\/([^/]+)/);
	if (ma) return appTitle(decodeURIComponent(ma[1]));
	const m2 = pathname.match(/^\/studio\/runs\/([^/]+)/);
	if (m2) return decodeURIComponent(m2[1]);
	const m4 = pathname.match(/^\/studio\/knowledge\/([^/]+)/);
	if (m4) return decodeURIComponent(m4[1]);
	return null;
}

export default function TopStatusStrip() {
	const location = useLocation();
	const [counts, setCounts] = useState<Counts>(ZERO);
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
			let failingToday = 0;
			let running = 0;
			if (drafts.status === "fulfilled") {
				draftsCount = drafts.value.drafts.length;
			}
			if (wfR.status === "fulfilled") {
				const wfs = (wfR.value.workflows || []).filter((w) => inScope(w.app));
				// "failing" = workflows whose LAST run failed (last_run_ok===false)
				// — the same definition as the red dots on the cards and the My
				// Apps hero count. Previously this counted failed *cycles today*,
				// which diverged from the dots (e.g. a workflow red since
				// yesterday, or a failure not in today's cycle list).
				// Exclude paused workflows — the attention rail does, and the
				// pill disagreeing with the rail (2 vs 1) read as a bug.
				failingToday = wfs.filter((w) => w.enabled !== false && w.last_run_ok === false).length;
				// "running" = workflows with a cycle in-flight right now. Was
				// hardcoded to 0, so the pill never appeared even mid-run.
				running = wfs.filter((w) => w.running).length;
			}
			setCounts({ drafts: draftsCount, running, failingToday });
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
			{/* Left — page identity */}
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

			<div id="topstrip-app-slot" className="flex items-center gap-2 min-w-0 flex-1" />

			{/* Right — a steady "live" heartbeat (the surface is alive; loops
			    run in the background) + status pills (only when non-zero). */}
			<div className="flex items-center gap-2 flex-shrink-0">
				<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Live — your loops run in the background">
					<span className="w-1.5 h-1.5 rounded-full bg-gold-500 heartbeat" />
					<span className="hidden sm:inline">live{(() => { const a = Math.max(0, Math.floor((Date.now() - refreshedAt) / 1000)); return a < 3 ? "" : a < 60 ? ` · ${a}s ago` : ` · ${Math.floor(a / 60)}m ago`; })()}</span>
				</span>
				{loaded && counts.drafts > 0 && (
					<StatusPill
						to="/studio/inbox"
						icon={FileText}
						count={counts.drafts}
						label="pending"
						tone="ok"
					/>
				)}
				{loaded && counts.running > 0 && (
					<StatusPill
						to="/studio/apps"
						icon={Activity}
						count={counts.running}
						label="running"
						tone="running"
						pulse
					/>
				)}
				{loaded && counts.failingToday > 0 && (
					<StatusPill
						to="/studio/apps?attention=1"
						icon={AlertTriangle}
						count={counts.failingToday}
						label="failing"
						tone="failing"
					/>
				)}
			</div>
		</div>
	);
}

function StatusPill({
	to, icon: Icon, count, label, tone, pulse = false,
}: {
	to: string;
	icon: React.ComponentType<{ className?: string }>;
	count: number;
	label: string;
	tone: ToneKey;
	pulse?: boolean;
}) {
	const t = TONES[tone];
	return (
		<Link
			to={to}
			className={[
				"inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition-all",
				t.bg, t.text, t.border,
			].join(" ")}
			title={`${count} ${label}`}
		>
			<span className="relative inline-flex">
				<span className={["w-1.5 h-1.5 rounded-full", t.dot].join(" ")} />
				{pulse && (
					<span className={["absolute inset-0 w-1.5 h-1.5 rounded-full animate-ping opacity-75", t.dot].join(" ")} />
				)}
			</span>
			<Icon className="w-3 h-3" />
			<span className="font-mono tabular-nums font-semibold">{count}</span>
			<span className="hidden sm:inline">{label}</span>
		</Link>
	);
}

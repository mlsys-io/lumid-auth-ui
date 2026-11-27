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

import { workflowPath } from "@/lib/run-routes";
import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
	ChevronRight,
	Sparkles, Inbox as InboxIcon,
	Store, Brain, Settings, Shield, Activity as ActivityIcon, Boxes, ListChecks, LayoutDashboard,
} from "lucide-react";
import { appTitle } from "@/components/workflow/AppCard";
import AppSwitcher from "@/components/studio/AppSwitcher";

// Per-route page identity. Subtitle is short — top-bar height is bounded.
const PAGE_META: Array<{
	pattern: RegExp;
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	subtitle?: string;
	iconTone: string; // text color class for the icon
	/** The page renders its own PageHeader (serif title + subtitle). The strip
	 *  then shows only breadcrumbs + live status — the title said twice was
	 *  the most visible "this looks unfinished" tell. document.title still
	 *  uses `title`. */
	ownHeader?: boolean;
}> = [
	{
		// The inventory — matched before the per-app rule, which would read
		// "all" as an app slug and title it "Agent". The page's list carries
		// its own "Agents" heading.
		pattern: /^\/studio\/apps\/all\/?$/,
		icon: Boxes,
		title: "Agents",
		iconTone: "text-gold-600",
		ownHeader: true,
	},
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
		ownHeader: true,
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
		ownHeader: true,
		icon: ActivityIcon,
		title: "Activity",
		subtitle: "What's running, what's broken, and how each workflow is doing.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/library\/skills/,
		ownHeader: true,
		icon: Store,
		title: "Skills",
		subtitle: "The capabilities your agents import — health, versions, who uses what.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/library\/experiments/,
		ownHeader: true,
		icon: Store,
		title: "Studies",
		subtitle: "Hypotheses your agents are testing, across every agent.",
		iconTone: "text-gold-600",
	},
	{
		pattern: /^\/studio\/(library|marketplace)/,
		ownHeader: true,
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
		ownHeader: true,
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
		ownHeader: true,
		icon: Settings,
		title: "Settings",
		subtitle: "Account, tokens, connected services, and privacy — all in one place.",
		iconTone: "text-muted-foreground",
	},
	{
		pattern: /^\/studio\/admin/,
		ownHeader: true,
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
			ownHeader: false,
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
	if (m3) return [{ label: "My Agents", to: "/studio/apps" }, { label: appTitle(decodeURIComponent(m3[1])), to: workflowPath(decodeURIComponent(m3[1]), decodeURIComponent(m3[2])) }];
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
				// shrink-0 + a cap: the app name keeps its own width. With min-w-0 it
				// was squeezed below its text and the workflow slot's "Overview"
				// button was drawn on top of it ("Venue Link Matcher" overprinted).
				<div className="flex items-center gap-1 flex-shrink-0 max-w-[34%]">
					<span id="topstrip-ws-left" className="flex items-center" />
					<AppSwitcher app={appSlug} />
					{/* The app's "⋯" menu, right beside its name (portaled by the app page). */}
					<span id="topstrip-app-menu" className="flex items-center flex-shrink-0" />
				</div>
			) : meta?.ownHeader ? (
			// The page carries its own title; keep only the trail (if any).
			<div className="min-w-0">
				{crumbs.length > 0 && (
					<nav className="flex items-center gap-1 text-caption text-ink-600">
						{crumbs.map((c, i) => (
							<span key={i} className="inline-flex items-center gap-1 min-w-0">
								{i > 0 && <ChevronRight className="w-3 h-3 text-ink-600 flex-shrink-0" />}
								<Link to={c.to} className="hover:text-ink-900 transition-colors truncate">{c.label}</Link>
							</span>
						))}
					</nav>
				)}
			</div>
			) : (
			<div className="min-w-0 flex items-start gap-2.5">
				{/* Lumen: one quiet ink icon for every page (the per-page bronze tint
				    made the strip's corner shout on every route). */}
				{Icon && <Icon className="w-[18px] h-[18px] flex-shrink-0 mt-0.5 text-ink-500" />}
				<div className="min-w-0">
					{/* Breadcrumb above the title on detail routes */}
					{crumbs.length > 0 && (
						<nav className="flex items-center gap-1 text-caption text-ink-600 mb-0.5">
							{crumbs.map((c, i) => (
								<span key={i} className="inline-flex items-center gap-1 min-w-0">
									{i > 0 && <ChevronRight className="w-3 h-3 text-ink-600 flex-shrink-0" />}
									<Link to={c.to} className="hover:text-foreground transition-colors truncate">
										{c.label}
									</Link>
								</span>
							))}
						</nav>
					)}
					<h1 className="text-body font-semibold text-ink-900 truncate leading-tight">
						{detailLeaf ?? meta?.title ?? ""}
					</h1>
					{meta?.subtitle && !detailLeaf && (
						<p className="text-caption text-ink-600 mt-0.5 truncate hidden md:block">
							{meta.subtitle}
						</p>
					)}
				</div>
			</div>
			)}

			{/* TWO slots, deliberately. The app's declared nav tabs and the workflow
			    controls are portaled by different components; sharing one container
			    stacked their children on top of each other, so a click landed on
			    whichever happened to be above. Separate nodes lay out side by side. */}
			{/* Right after the app's name: which of its workflows you're in, as a
			    breadcrumb ("MLSys Research / ● Simulate ⌄"). It names the place, so
			    it sits with the name — not with the run controls on the right. */}
			<div id="topstrip-crumb-slot" className="flex items-center min-w-0 -ml-1.5" />
			<div id="topstrip-app-slot" className="flex items-center gap-2 min-w-0 flex-1" />
			<div id="topstrip-wf-slot" className="flex items-center gap-2 min-w-0 overflow-hidden" />

			{/* Right — a steady "live" heartbeat (the surface is alive; loops
			    run in the background) + status pills (only when non-zero). */}
			<div className="flex items-center gap-2 flex-shrink-0">
				{/* Simplified 2026-11-24: no rotating "NOW" ticker and no "live"
				    heartbeat. The ticker repeated what the rail already shows (the
				    Inbox count, the Runs "N failed" pill) on every page; the
				    heartbeat only said the page was polling. */}
				{/* Workspace's chat-panel toggle portals here — kept the TOP-MOST RIGHT. */}
				<span id="topstrip-ws-right" className="flex items-center" />
			</div>
		</div>
	);
}



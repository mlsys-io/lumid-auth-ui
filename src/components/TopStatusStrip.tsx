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
	Sparkles, Inbox as InboxIcon, Workflow as WorkflowIcon,
	Store, Brain, Settings, Shield, Activity as ActivityIcon, Boxes,
} from "lucide-react";
import { me } from "@/api/me";
import { RUNNING_APPS } from "@/lib/demo";

// Same scope filter as the My Apps page: count only the user's own apps,
// not operator-shared ones that listWorkflows() also returns — otherwise the
// header's failing count diverges from the hero/cards (the "3 vs 1" bug).
const inScope = (app?: string) => !app || (RUNNING_APPS as readonly string[]).includes(app);

// Friendly app titles for the header (kept in sync with AppCard's map).
const APP_TITLE: Record<string, string> = {
	"personal-agent": "Personal agent",
	"mbb-ai": "Consulting research",
	"auto-sysresearch": "Systems research",
	"auto-quant": "Auto-quant trading",
};

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
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/apps/,
		icon: Boxes,
		title: "My Apps",
		subtitle: "Your apps and their ongoing progress.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/(intents|today)/,
		icon: Sparkles,
		title: "Intents",
		subtitle: "Your goals this week. Outcomes graded; judgment encoded.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/inbox/,
		icon: InboxIcon,
		title: "Inbox",
		subtitle: "Drafts, cycles, notices, and the audit trail — in one feed.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/workflows\/[^/]+/,
		icon: WorkflowIcon,
		title: "Workflow",
		subtitle: "Graph, runs, and definition for this workflow.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/workflows/,
		icon: WorkflowIcon,
		title: "Workflows",
		subtitle: "Everything your AI runs — scheduled, visual, or on-demand.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/runs\/[^/]+/,
		icon: ActivityIcon,
		title: "Run",
		subtitle: "Per-step DAG + timeline.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/runs/,
		icon: ActivityIcon,
		title: "Runs",
		subtitle: "What your AI has been doing.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/(library|marketplace)/,
		icon: Store,
		title: "Library",
		subtitle: "Skills and workflows — pull in, refine, publish back.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/mind/,
		icon: Sparkles,
		title: "Mind",
		subtitle: "How your AI is getting better over time.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/knowledge\/[^/]+/,
		icon: Brain,
		title: "Agent knowledge",
		subtitle: "Memories the agent has banked.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/knowledge/,
		icon: Brain,
		title: "Knowledge",
		subtitle: "What's been encoded — yours, audited, portable.",
		iconTone: "text-emerald-600",
	},
	{
		pattern: /^\/studio\/settings/,
		icon: Settings,
		title: "Settings",
		subtitle: "Account, tokens, connected services, and privacy — all in one place.",
		iconTone: "text-slate-600",
	},
	{
		pattern: /^\/studio\/admin/,
		icon: Shield,
		title: "Admin",
		subtitle: "Operator-only.",
		iconTone: "text-slate-600",
	},
];

function deriveMeta(pathname: string) {
	for (const m of PAGE_META) {
		if (m.pattern.test(pathname)) return m;
	}
	return null;
}

// Breadcrumb derivation — only on detail routes where there's a parent
// hop worth surfacing. Two-segment max; the page title (above) carries
// the leaf identity.
function deriveCrumbs(pathname: string): Array<{ label: string; to: string }> {
	const ma = pathname.match(/^\/studio\/apps\/([^/]+)/);
	if (ma) return [{ label: "My Apps", to: "/studio/apps" }];
	const m1 = pathname.match(/^\/studio\/workflows\/([^/]+)/);
	if (m1) return [{ label: "Workflows", to: "/studio/workflows" }];
	const m2 = pathname.match(/^\/studio\/runs\/([^/]+)/);
	if (m2) return [{ label: "Runs", to: "/studio/runs" }];
	// Cycle inspector is reached from an app's workflow panel.
	const m3 = pathname.match(/^\/studio\/(?:intents|today)\/cycle\/([^/]+)\/([^/]+)\/[^/]+/);
	if (m3) return [{ label: "My Apps", to: "/studio/apps" }, { label: APP_TITLE[decodeURIComponent(m3[1])] || decodeURIComponent(m3[1]), to: `/studio/apps/${m3[1]}?selected=${m3[2]}` }];
	// T13 — /studio/intents/:slug shows the autoresearch detail panel.
	// Match it AFTER the cycle regex so the cycle path isn't shadowed.
	const m3b = pathname.match(/^\/studio\/intents\/[^/]+/);
	if (m3b) return [{ label: "Intents", to: "/studio/intents" }];
	const m4 = pathname.match(/^\/studio\/knowledge\/[^/]+/);
	if (m4) return [{ label: "Knowledge", to: "/studio/knowledge" }];
	return [];
}

export default function TopStatusStrip() {
	const location = useLocation();
	const [counts, setCounts] = useState<Counts>(ZERO);
	const [loaded, setLoaded] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
	const [, forceTick] = useState(0);
	// 1s ticker so the "live · updated Ns ago" stays current.
	useEffect(() => {
		const id = window.setInterval(() => forceTick((x) => x + 1), 1000);
		return () => window.clearInterval(id);
	}, []);

	const meta = useMemo(() => deriveMeta(location.pathname), [location.pathname]);
	const crumbs = useMemo(() => deriveCrumbs(location.pathname), [location.pathname]);

	// On detail routes, the "leaf" name (slug / run-id) lives in the URL
	// and is more specific than the registry's generic "Workflow" /
	// "Run" title. Surface it so the header reads naturally.
	const detailLeaf = useMemo(() => {
		const ma = location.pathname.match(/^\/studio\/apps\/([^/]+)/);
		if (ma) { const slug = decodeURIComponent(ma[1]); return APP_TITLE[slug] || slug; }
		const m1 = location.pathname.match(/^\/studio\/workflows\/([^/]+)/);
		if (m1) return decodeURIComponent(m1[1]);
		const m2 = location.pathname.match(/^\/studio\/runs\/([^/]+)/);
		if (m2) return decodeURIComponent(m2[1]);
		const m4 = location.pathname.match(/^\/studio\/knowledge\/([^/]+)/);
		if (m4) return decodeURIComponent(m4[1]);
		return null;
	}, [location.pathname]);

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
				failingToday = wfs.filter((w) => w.last_run_ok === false).length;
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
			{/* Left — page identity */}
			<div className="min-w-0 flex items-start gap-2.5">
				{Icon && (
					<Icon className={["w-5 h-5 flex-shrink-0 mt-0.5", meta?.iconTone || ""].join(" ")} />
				)}
				<div className="min-w-0">
					{/* Breadcrumb above the title on detail routes */}
					{crumbs.length > 0 && (
						<nav className="flex items-center gap-1 text-[11px] text-slate-400 mb-0.5">
							{crumbs.map((c, i) => (
								<span key={i} className="inline-flex items-center gap-1 min-w-0">
									{i > 0 && <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />}
									<Link to={c.to} className="hover:text-slate-700 transition-colors truncate">
										{c.label}
									</Link>
								</span>
							))}
						</nav>
					)}
					<h1 className="text-[15px] font-semibold text-slate-900 truncate leading-tight">
						{detailLeaf ?? meta?.title ?? ""}
					</h1>
					{meta?.subtitle && !detailLeaf && (
						<p className="text-[11px] text-slate-500 mt-0.5 truncate hidden md:block">
							{meta.subtitle}
						</p>
					)}
				</div>
			</div>

			{/* Right — a steady "live" heartbeat (the surface is alive; loops
			    run in the background) + status pills (only when non-zero). */}
			<div className="flex items-center gap-2 flex-shrink-0">
				<span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Live — your loops run in the background">
					<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 heartbeat" />
					<span className="hidden sm:inline">live{(() => { const a = Math.max(0, Math.floor((Date.now() - refreshedAt) / 1000)); return a < 3 ? "" : a < 60 ? ` · ${a}s ago` : ` · ${Math.floor(a / 60)}m ago`; })()}</span>
				</span>
				{loaded && counts.drafts > 0 && (
					<StatusPill
						to="/studio/inbox"
						icon={FileText}
						count={counts.drafts}
						label="pending"
						tone="emerald"
					/>
				)}
				{loaded && counts.running > 0 && (
					<StatusPill
						to="/studio/apps"
						icon={Activity}
						count={counts.running}
						label="running"
						tone="sky"
						pulse
					/>
				)}
				{loaded && counts.failingToday > 0 && (
					<StatusPill
						to="/studio/apps"
						icon={AlertTriangle}
						count={counts.failingToday}
						label="failing"
						tone="rose"
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
	tone: "emerald" | "sky" | "rose";
	pulse?: boolean;
}) {
	const tones: Record<string, { bg: string; text: string; dot: string }> = {
		emerald: { bg: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200/60", text: "text-emerald-700", dot: "bg-emerald-500" },
		sky:     { bg: "bg-sky-50 hover:bg-sky-100 border-sky-200/60",            text: "text-sky-700",     dot: "bg-sky-500"     },
		rose:    { bg: "bg-rose-50 hover:bg-rose-100 border-rose-200/60",         text: "text-rose-700",    dot: "bg-rose-500"    },
	};
	const t = tones[tone];
	return (
		<Link
			to={to}
			className={[
				"inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition-all",
				t.bg, t.text,
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

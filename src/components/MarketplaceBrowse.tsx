// MarketplaceBrowse — xp.io-aligned catalog for /studio/marketplace.
//
// Visual language mirrors xp.io's marketspace:
//   - Kind glyphs: ⁂ app  ⌘ skill  ◫ dataset
//   - Left-border color accent per kind (teal / violet / amber)
//   - White cards, gray-200 borders, compact metadata footer
//   - Tag chips + sort selector
//   - Install button lives inside the detail drawer (click card → drawer)

import { useEffect, useMemo, useRef, useState } from "react";
import { bearerHeader } from "@/api/session-bearer";
import { SpiralOverlay } from "@/components/BrandLoader";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
	Search, ExternalLink, Plus, Check, Loader2,
	Star, Download, GitFork, ArrowRight,
	X, Eye, EyeOff, Tag, PanelLeft,
	ChevronDown, Sparkles, Puzzle, BookOpen, Database, LineChart,
} from "lucide-react";
import { AddSkillToAppDialog } from "@/components/studio/AddSkillToAppDialog";
import { SubscribeAgentDialog } from "@/components/studio/SubscribeAgentDialog";
import { me } from "@/api/me";
import { cn } from "@/lib/utils";
import { GradientIcon } from "@/components/studio/GradientIcon";
import { AppMetaChips } from "@/components/studio/MetaChips";
import { StateAwareCTA, type CTAState } from "@/components/studio/StateAwareCTA";
import { STAGGER_CLASS, staggerDelay } from "@/components/studio/stagger";
import { markPendingCustomize } from "@/lib/just-installed";
import {
	loadRefinements, lastPublishedAt, REFINEMENTS_EVENT,
	type Refinement,
} from "@/lib/refinements";
import { parse as parseYaml } from "yaml";
import { resolveSpecPath } from "@/lib/manifestPaths";

// ── Kind metadata (mirrors xp.io kindMeta) ────────────────────────

const KIND_META: Record<string, { glyph: string; border: string; bg: string; text: string; label: string }> = {
	app:        { glyph: "⁂", border: "border-l-gold-400",    bg: "bg-gold-50",    text: "text-gold-700",    label: "App" },
	skill:      { glyph: "⌘", border: "border-l-violet-400",  bg: "bg-violet-50",  text: "text-violet-700",  label: "Skill" },
	dataset:    { glyph: "◫", border: "border-l-gold-400",   bg: "bg-gold-50",   text: "text-gold-700",   label: "Dataset" },
	agent:      { glyph: "❋", border: "border-l-pink-400",    bg: "bg-pink-50",    text: "text-pink-700",    label: "Agent" },
	workflow:   { glyph: "▷", border: "border-l-blue-400",    bg: "bg-blue-50",    text: "text-blue-700",    label: "Workflow" },
	experiment: { glyph: "⬡", border: "border-l-gold-400", bg: "bg-gold-50", text: "text-gold-700", label: "Experiment" },
	autoresearch:{ glyph: "⬡", border: "border-l-gold-400", bg: "bg-gold-50", text: "text-gold-700", label: "Experiment" },
	strategy:   { glyph: "◈", border: "border-l-blue-400",    bg: "bg-blue-50",    text: "text-blue-700",    label: "Strategy" },
};
const kindMeta = (k?: string) =>
	KIND_META[k ?? ""] ?? { glyph: "·", border: "border-l-slate-300", bg: "bg-slate-50", text: "text-slate-600", label: k ?? "other" };

// ── Types ──────────────────────────────────────────────────────────

interface RepoCard {
	owner_sub: string;
	name: string;
	kind?: string;
	display_name?: string;
	summary?: string;
	tags?: string[];
	version?: string;
	stars?: number;
	downloads?: number;
	forks?: number;
	consumers_count?: number;
	updated_at?: number;
	published_at?: number;
	visibility?: string;
	fork_of?: string | null;
}

interface SkillCard {
	name: string;
	display_name: string;
	summary: string;
	category: string;
	tags: string[];
	needs_secrets: string[];
	source_url?: string;
	kind?: string;
}

type InstallStatus =
	| { state: "idle" }
	| { state: "installing"; intentId?: string }
	| { state: "installed"; appName: string }
	| { state: "failed"; error: string };

type Tab = "apps" | "workflows" | "agents" | "strategies" | "skills" | "datasets" | "refinements";
type SortKey = "updated" | "stars" | "name";

// ── Kind hierarchy — what the primary action IS per kind ──────────────
//
// The kinds are hierarchical, not flat: apps INSTALL into My Apps; skills
// are IMPORTED by apps (skill_imports[]); knowledge agents are SUBSCRIBED
// into the caller's KG; datasets are MOUNTED by apps (datasets[]); strategy
// and workflow repos are browse-only. The server enforces the same contract
// (install endpoint 422s on non-app kinds), this map just keeps the UI from
// offering the wrong verb in the first place.
type KindAction = "install" | "add-skill" | "subscribe" | "view";
function kindAction(kind?: string): KindAction {
	switch (kind) {
		case "skill": return "add-skill";
		case "agent": return "subscribe";
		case "workflow": return "install"; // forks into a runnable app (loop-bearing); strategy-graph workflows error w/ guidance
		case "dataset":
		case "strategy": return "view";
		default: return "install"; // app, autoresearch (legacy), unknown
	}
}

// The marketplace's secondary-action dialogs (Add to app… / Subscribe).
type PendingAction =
	| { type: "add-skill"; slug: string; label: string; version?: string }
	| { type: "subscribe"; slug: string; label: string };

// ── Root component ─────────────────────────────────────────────────

// Module-level catalog cache. The 6 catalog fetches use raw fetch() (not the
// TTL-cached me client), so EVERY visit to Library re-ran all of them + the
// bearer round-trip — the "second load still slow". Cache the result briefly so
// navigating away and back is instant; the marketplace changes rarely.
interface CatalogCache { at: number; apps: RepoCard[]; workflows: RepoCard[]; agents: RepoCard[]; strategies: RepoCard[]; skills: SkillCard[]; datasets: RepoCard[] }
let catalogCache: CatalogCache | null = null;
const CATALOG_TTL = 60_000;

export default function MarketplaceBrowse() {
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>("apps");
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<SortKey>("updated");
	const [activeTag, setActiveTag] = useState<string | null>(null);
	const [statuses, setStatuses] = useState<Record<string, InstallStatus>>({});
	const [detail, setDetail] = useState<RepoCard | null>(null);

	const [apps, setApps]           = useState<RepoCard[] | null>(null);
	const [workflows, setWorkflows]  = useState<RepoCard[] | null>(null);
	const [agents, setAgents]        = useState<RepoCard[] | null>(null);
	const [strategies, setStrategies] = useState<RepoCard[] | null>(null);
	const [skills, setSkills]        = useState<SkillCard[] | null>(null);
	const [datasets, setDatasets]    = useState<RepoCard[] | null>(null);
	// Names of apps already in the caller's account — survives reloads (the
	// per-session `statuses` map doesn't), so an installed app's card shows
	// "Open" instead of offering a second install.
	const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
	const [action, setAction] = useState<PendingAction | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		const apply = (c: CatalogCache) => {
			setApps(c.apps); setWorkflows(c.workflows); setAgents(c.agents);
			setStrategies(c.strategies); setSkills(c.skills); setDatasets(c.datasets);
		};
		// Fresh cache → paint instantly, no network.
		if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) {
			apply(catalogCache);
		} else {
			(async () => {
				try {
					const auth = await bearerHeader();
					const opts = { credentials: "same-origin" as const, headers: auth };
					// The /repos endpoint returns public ∪ caller-owned, so a signed-in
					// user's OWN private apps/forks would otherwise leak into the
					// Marketplace browse (they belong in My Apps, not discovery). Filter
					// to public here. NB: we must NOT use include_forks=false — several
					// canonical published apps (mbb-ai, auto-quant) are themselves public
					// forks of templates, and dropping forks would hide them. Visibility
					// is the right axis: public forks stay, private (own) repos go.
					const repo = (kind: string) =>
						fetch(`/api/v1/repos?kind=${kind}`, opts)
							.then((r) => r.ok ? r.json().then((d: { repos?: RepoCard[] }) => (d.repos || []).filter((x) => (x.visibility ?? "public") === "public")) : Promise.resolve([]));
					const [a, wf, ag, st, s, d] = await Promise.all([
						repo("app"),
						repo("workflow"),
						repo("agent"),
						repo("strategy"),
						fetch("/api/v1/skills/catalog", opts).then((r) => r.ok ? r.json().then((d: { cards?: SkillCard[] }) => d.cards || []) : Promise.resolve([])),
						// Datasets: drop autoresearch cycle-output telemetry (tagged
						// "cycles"). These are per-run experiment artifacts auto-published
						// by every app's loops — one per tenant per app — so the browse was
						// showing e.g. 8 identical "auto-quant-cycles" cards. They aren't
						// installable/discoverable content; only genuine datasets
						// (e.g. mbb-casebook) belong here. Surfaced instead under each
						// app's own observability, not the marketplace.
						repo("dataset").then((rows) => rows.filter((x) => !(x.tags ?? []).includes("cycles"))),
					]);
					// strategy is now a workflow sub-type (workflow_type: strategy) —
					// fold any kind=strategy repos into the Workflows tab. `st` is
					// normally empty post-migration; this keeps stray/un-migrated forks
					// visible under Workflows rather than a dead Strategies tab.
					catalogCache = { at: Date.now(), apps: a, workflows: [...wf, ...st], agents: ag, strategies: [], skills: s, datasets: d };
					apply(catalogCache);
				} catch (e) {
					setErr(e instanceof Error ? e.message : String(e));
				}
			})();
		}
		// Already-installed detection (separate fetch — its failure shouldn't
		// blank the catalog).
		me.listApps()
			.then((r) => setInstalledNames(new Set((r.apps ?? []).filter((a) => (a.status ?? "ready") === "ready").map((a) => a.name))))
			.catch(() => {});
	}, []);

	// Optimistic + background: fire the install intent and hand off to My Apps,
	// where the card shows "installing" (from the server-side intent merge) and
	// flips to ready when the picker finishes. We do NOT block on a poll here —
	// the drain can lag ~60s, which used to surface successful installs as
	// false "timed out" errors.
	// Anonymous public browse (/explore, served by PublicShell) has no session,
	// so an install/subscribe mutation would 401. Bounce to login instead of
	// firing the authed call + surfacing an error toast.
	const isPublic = typeof window !== "undefined" && window.location.pathname.startsWith("/explore");
	const requireLogin = () => navigate(`/auth/login?return_to=${encodeURIComponent(window.location.pathname)}`);
	const guardedAction = (a: PendingAction) => { if (isPublic) { requireLogin(); return; } setAction(a); };

	const install = async (label: string, name: string, ownerSub?: string, sidebarConfig?: { show: boolean; label: string; section: string }) => {
		if (isPublic) { requireLogin(); return; }
		const slug = ownerSub ? `${ownerSub}/${name}` : name;
		setStatuses((m) => ({ ...m, [name]: { state: "installing" } }));
		try {
			const resp = await me.installApp(slug, "local", undefined, sidebarConfig ? {
				sidebar_show: sidebarConfig.show,
				sidebar_label: sidebarConfig.label,
				sidebar_section: sidebarConfig.section,
			} : undefined);
			setStatuses((m) => ({ ...m, [name]: { state: "installing", intentId: resp.intent_id } }));
			// Mark it so My Apps opens the generate+customize step once it lands.
			markPendingCustomize(name);
			toast.success(`Installing ${label}… it'll appear in My Apps shortly.`);
			navigate("/studio/apps");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatuses((m) => ({ ...m, [name]: { state: "failed", error: msg } }));
			toast.error(`Install failed: ${msg}`);
		}
	};

	const openInstalled = (appName: string) => isPublic ? requireLogin() : navigate(`/studio/a/${encodeURIComponent(appName)}`);

	if (err) return (
		<div className="rounded-xl border border-rose-200 bg-rose-50/40 p-6 text-sm text-rose-800">
			Couldn&apos;t load the catalog: {err}
		</div>
	);

	// Top tag counts for the active tab
	const topTags = useMemo(() => {
		const sourceMap: Record<Tab, { tags?: string[] }[] | null> = {
			apps: apps, workflows: workflows, agents: agents,
			strategies: strategies, datasets: datasets, refinements: null,
			skills: skills?.map((s) => ({ tags: s.tags })) ?? null,
		};
		const source = sourceMap[tab];
		if (!source) return [];
		const counts = new Map<string, number>();
		for (const r of source) for (const t of (r.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
	}, [tab, apps, workflows, agents, strategies, skills, datasets]);

	const tabs: Array<{ id: Tab; label: string; count: number | null }> = [
		{ id: "apps",        label: "Apps",        count: apps?.length ?? null },
		{ id: "workflows",   label: "Workflows",   count: workflows?.length ?? null },
		{ id: "agents",      label: "Agents",      count: agents?.length ?? null },
		{ id: "skills",      label: "Skills",      count: skills?.length ?? null },
		{ id: "datasets",    label: "Datasets",    count: datasets?.length ?? null },
		{ id: "refinements", label: "Refinements", count: null },
	];

	return (
		<div className="space-y-3">
			{/* Tab + search row */}
			<div className="flex items-center gap-3 flex-wrap">
				<nav className="flex items-center gap-0.5">
					{tabs.map((t) => (
						<button
							key={t.id}
							onClick={() => { setTab(t.id); setQuery(""); setActiveTag(null); }}
							className={[
								"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
								tab === t.id
									? "bg-slate-900 text-white font-medium"
									: "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
							].join(" ")}
						>
							{t.label}
							{t.count !== null && (
								<span className={["text-[10px] font-mono tabular-nums", tab === t.id ? "text-white/60" : "text-slate-400"].join(" ")}>
									{t.count}
								</span>
							)}
						</button>
					))}
				</nav>

				<div className="flex-1 relative min-w-[180px]">
					<Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
					<input
						type="search"
						value={query}
						onChange={(e) => { setQuery(e.target.value); setActiveTag(null); }}
						placeholder={`Search ${tab}…`}
						className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/20 focus:border-gold-400 transition-all placeholder:text-slate-400"
					/>
				</div>

				{tab !== "refinements" && (
					<SortDropdown value={sort} onChange={setSort} />
				)}
			</div>

			{/* Tag chips */}
			{topTags.length > 0 && !query && (
				<div className="flex items-center gap-1.5 flex-wrap">
					<Tag className="w-3 h-3 text-slate-400 flex-shrink-0" />
					{activeTag && (
						<button
							onClick={() => setActiveTag(null)}
							className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-900 text-white"
						>
							{activeTag} <X className="w-2.5 h-2.5" />
						</button>
					)}
					{topTags.filter((t) => t !== activeTag).map((t) => (
						<button
							key={t}
							onClick={() => setActiveTag(t)}
							className="px-2 py-0.5 rounded-full text-[11px] border border-slate-200 text-slate-600 hover:border-gold-400 hover:text-gold-700 transition-colors"
						>
							{t}
						</button>
					))}
				</div>
			)}

			{/* Body */}
			{(tab === "apps" || tab === "workflows" || tab === "agents" || tab === "datasets") && (
				<RepoGrid
					repos={tab === "apps" ? apps : tab === "workflows" ? workflows : tab === "agents" ? agents : datasets}
					query={query}
					sort={sort}
					activeTag={activeTag}
					statuses={statuses}
					installedNames={installedNames}
					onSelect={setDetail}
					onInstall={(r) => install(r.display_name || r.name, r.name, r.owner_sub)}
					onAction={guardedAction}
					onOpen={openInstalled}
				/>
			)}
			{tab === "skills" && (
				<SkillsGrid
					skills={skills}
					query={query}
					activeTag={activeTag}
					onAction={guardedAction}
				/>
			)}
			{tab === "refinements" && <RefinementsView query={query} />}

			{/* Detail + per-kind action drawer */}
			{detail && (
				<AppDetailDrawer
					app={detail}
					status={statuses[detail.name] || { state: "idle" }}
					installed={installedNames.has(detail.name)}
					isPublic={isPublic}
					onInstall={(cfg) => install(detail.display_name || detail.name, detail.name, detail.owner_sub, cfg)}
					onAction={(a) => { if (isPublic) { requireLogin(); return; } setAction(a); setDetail(null); }}
					onOpen={openInstalled}
					onClose={() => setDetail(null)}
				/>
			)}

			{/* Kind-action dialogs */}
			{action?.type === "add-skill" && (
				<AddSkillToAppDialog
					skillRepo={action.slug}
					skillLabel={action.label}
					version={action.version}
					open
					onClose={() => setAction(null)}
				/>
			)}
			{action?.type === "subscribe" && (
				<SubscribeAgentDialog
					sourceSlug={action.slug}
					agentLabel={action.label}
					open
					onClose={() => setAction(null)}
				/>
			)}
		</div>
	);
}

// ── Sort dropdown ──────────────────────────────────────────────────

function SortDropdown({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
	const labels: Record<SortKey, string> = { updated: "Recently updated", stars: "Stars", name: "Name" };
	return (
		<div className="relative">
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as SortKey)}
				className="appearance-none pl-3 pr-7 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-gold-400/20 focus:border-gold-400 cursor-pointer"
			>
				{(Object.keys(labels) as SortKey[]).map((k) => (
					<option key={k} value={k}>{labels[k]}</option>
				))}
			</select>
			<ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
		</div>
	);
}

// ── Repo grid (apps + datasets) ─────────────────────────────────────

function sortRepos(repos: RepoCard[], sort: SortKey): RepoCard[] {
	return [...repos].sort((a, b) => {
		if (sort === "stars") return (b.stars ?? 0) - (a.stars ?? 0);
		if (sort === "name") return (a.display_name || a.name).localeCompare(b.display_name || b.name);
		return (b.updated_at ?? 0) - (a.updated_at ?? 0);
	});
}

function RepoGrid({
	repos, query, sort, activeTag, statuses, installedNames, onSelect, onInstall, onAction, onOpen,
}: {
	repos: RepoCard[] | null;
	query: string;
	sort: SortKey;
	activeTag: string | null;
	statuses: Record<string, InstallStatus>;
	installedNames: Set<string>;
	onSelect: (r: RepoCard) => void;
	onInstall: (r: RepoCard) => void;
	onAction: (a: PendingAction) => void;
	onOpen: (name: string) => void;
}) {
	const filtered = useMemo(() => {
		if (!repos) return [];
		const q = query.trim().toLowerCase();
		let out = repos;
		if (q) out = out.filter((r) =>
			r.name.toLowerCase().includes(q) ||
			(r.display_name ?? "").toLowerCase().includes(q) ||
			(r.summary ?? "").toLowerCase().includes(q) ||
			(r.tags ?? []).some((t) => t.toLowerCase().includes(q)),
		);
		if (activeTag) out = out.filter((r) => (r.tags ?? []).includes(activeTag));
		return sortRepos(out, sort);
	}, [repos, query, sort, activeTag]);

	if (repos === null) return (
		<div className="relative">
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{[0,1,2,3,4,5].map((i) => <div key={i} className="h-28 rounded-lg bg-slate-100 animate-pulse" />)}
			</div>
			<SpiralOverlay />
		</div>
	);
	if (filtered.length === 0) return (
		<div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
			{query || activeTag ? "No matches. Try a different query or clear the filter." : "No items available."}
		</div>
	);

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
			{filtered.map((r, i) => (
				<RepoCardView
					key={r.name}
					repo={r}
					index={i}
					status={statuses[r.name] || { state: "idle" }}
					installed={installedNames.has(r.name)}
					onSelect={() => onSelect(r)}
					onInstall={() => onInstall(r)}
					onAction={onAction}
					onOpen={onOpen}
				/>
			))}
		</div>
	);
}

// Per-kind helper copy under the card body — says what the primary action
// actually DOES, since it differs per kind.
const KIND_HELPER: Record<KindAction, string> = {
	"install":   "Installs into My Apps · runs on its schedule · first run is automatic",
	"add-skill": "Plugs into an app you own — pick which one",
	"subscribe": "Syncs its knowledge into yours — re-sync anytime",
	"view":      "", // per-kind line chosen below
};

function RepoCardView({
	repo, index, status, installed, onSelect, onInstall, onAction, onOpen,
}: {
	repo: RepoCard;
	index: number;
	status: InstallStatus;
	installed: boolean;
	onSelect: () => void;
	onInstall: () => void;
	onAction: (a: PendingAction) => void;
	onOpen: (name: string) => void;
}) {
	const title = repo.display_name || repo.name;
	const updated = repo.updated_at ? relativeDays(new Date(repo.updated_at * 1000)) : null;
	const act = kindAction(repo.kind);
	const slug = `${repo.owner_sub}/${repo.name}`;
	// Server-known installs (survives reload) take precedence over the
	// per-session optimistic map.
	const ctaState: CTAState =
		installed || status.state === "installed" ? "installed" :
		status.state === "installing" ? "installing" :
		status.state === "failed" ? "failed" : "idle";

	const helper =
		act === "view"
			? repo.kind === "dataset" ? "Used by apps as a data source — see Details"
			: repo.kind === "strategy" ? "Runs on Lumid Market — see Details"
			: "A recipe that runs inside apps — see Details"
			: KIND_HELPER[act];

	return (
		<article
			className={cn(
				"group rounded-xl border bg-white p-4 flex flex-col shadow-sm transition-all duration-200",
				STAGGER_CLASS,
				ctaState === "installed"
					? "border-gold-200 bg-gold-50/30"
					: "border-slate-200 hover:border-gold-300 hover:shadow-md hover:-translate-y-0.5",
			)}
			style={staggerDelay(index)}
		>
			{/* Header — gradient avatar + title + Details affordance */}
			<div className="flex items-start gap-3">
				<GradientIcon name={repo.name} />
				<div className="min-w-0 flex-1">
					<h3 className="font-medium text-sm truncate" title={repo.name}>{title}</h3>
					<p className="text-[11px] text-slate-500 mt-0.5 truncate">
						{repo.name}
						{repo.fork_of && (
							<span
								className="ml-1.5 px-1.5 py-px rounded-full border border-slate-200 bg-slate-50 text-[10px] text-slate-400"
								title="a customized copy of another app"
							>
								customized
							</span>
						)}
					</p>
				</div>
				<button
					type="button" onClick={onSelect}
					className="p-1 -mr-1 rounded text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
					title="Details + customize"
				>
					Details →
				</button>
			</div>

			{/* Summary */}
			<p className="text-xs text-slate-600 mt-3 flex-1 line-clamp-3 leading-relaxed">
				{repo.summary || "No description provided."}
			</p>

			{/* Meta chips */}
			<AppMetaChips kind={repo.kind} version={repo.version} stars={repo.stars} />

			{/* Helper line — what the primary action does for THIS kind */}
			{ctaState === "idle" && helper && (
				<p className="mt-3 text-[10.5px] text-slate-500 leading-snug">
					<Sparkles className="inline w-2.5 h-2.5 mr-0.5 text-gold-500" />
					{helper}
				</p>
			)}
			{updated && ctaState === "idle" && (
				<p className="mt-1 text-[10.5px] text-slate-400">updated {updated}</p>
			)}

			{/* Full-width primary CTA — verb depends on the kind */}
			<div className="mt-3">
				{act === "install" && (
					<StateAwareCTA
						state={ctaState}
						onAction={() => (ctaState === "installed" ? onOpen(status.state === "installed" ? status.appName : repo.name) : onInstall())}
					/>
				)}
				{act === "add-skill" && (
					<button
						onClick={() => onAction({ type: "add-skill", slug, label: title, version: repo.version })}
						className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98] transition-all"
					>
						<Puzzle className="w-3.5 h-3.5" /> Add to app…
					</button>
				)}
				{act === "subscribe" && (
					<button
						onClick={() => onAction({ type: "subscribe", slug, label: title })}
						className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-pink-600 text-white hover:bg-pink-700 active:scale-[0.98] transition-all"
					>
						<BookOpen className="w-3.5 h-3.5" /> Subscribe
					</button>
				)}
				{act === "view" && (
					<button
						onClick={onSelect}
						className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all"
					>
						{repo.kind === "dataset" ? <Database className="w-3.5 h-3.5" /> : <LineChart className="w-3.5 h-3.5" />} How to use
					</button>
				)}
			</div>
		</article>
	);
}

// ── Skills grid ────────────────────────────────────────────────────

const SKILL_CATEGORIES: Record<string, { bg: string; text: string }> = {
	email:     { bg: "bg-rose-50",    text: "text-rose-700" },
	calendar:  { bg: "bg-gold-50",   text: "text-gold-700" },
	web:       { bg: "bg-sky-50",     text: "text-sky-700" },
	code:      { bg: "bg-violet-50",  text: "text-violet-700" },
	research:  { bg: "bg-gold-50", text: "text-gold-700" },
	messaging: { bg: "bg-indigo-50",  text: "text-indigo-700" },
	data:      { bg: "bg-cyan-50",    text: "text-cyan-700" },
	sql:       { bg: "bg-orange-50",  text: "text-orange-700" },
	llm:       { bg: "bg-purple-50",  text: "text-purple-700" },
};
const skillCat = (c: string) => SKILL_CATEGORIES[c] ?? { bg: "bg-slate-50", text: "text-slate-600" };

function SkillsGrid({
	skills, query, activeTag, onAction,
}: {
	skills: SkillCard[] | null;
	query: string;
	activeTag: string | null;
	onAction: (a: PendingAction) => void;
}) {
	const filtered = useMemo(() => {
		if (!skills) return [];
		const q = query.trim().toLowerCase();
		return skills.filter((c) => {
			if (activeTag && !c.tags.includes(activeTag)) return false;
			if (!q) return true;
			return c.display_name.toLowerCase().includes(q) ||
				c.summary.toLowerCase().includes(q) ||
				c.tags.some((t) => t.toLowerCase().includes(q));
		});
	}, [skills, query, activeTag]);

	if (skills === null) return (
		<div className="relative">
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{[0,1,2,3].map((i) => <div key={i} className="h-24 rounded-lg bg-slate-100 animate-pulse" />)}
			</div>
			<SpiralOverlay />
		</div>
	);
	if (filtered.length === 0) return (
		<div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
			No skills match.
		</div>
	);

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
			{filtered.map((c) => {
				const cat = skillCat(c.category);
				return (
					<article
						key={c.name}
						onClick={c.source_url ? () => window.open(c.source_url, "_blank", "noopener") : undefined}
						className={`rounded-lg border border-l-4 border-violet-300 border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all overflow-hidden flex flex-col ${c.source_url ? "cursor-pointer" : ""}`}
					>
						<div className="p-3.5 flex-1 flex flex-col">
							<div className="flex items-start gap-2.5">
								<div className={`w-8 h-8 rounded-md ${cat.bg} ${cat.text} flex items-center justify-center flex-shrink-0 text-base`}>
									⌘
								</div>
								<div className="flex-1 min-w-0">
									<h3 className="font-medium text-slate-900 text-[13.5px] leading-tight truncate">{c.display_name}</h3>
									<p className="text-[11px] text-slate-400 mt-0.5 font-mono">{c.category}</p>
								</div>
							</div>
							<p className="text-[12.5px] text-slate-600 mt-2 leading-relaxed line-clamp-2">{c.summary}</p>
							<div className="mt-auto pt-2.5 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
								{c.source_url
									? <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-400 hover:text-slate-700 inline-flex items-center gap-0.5 transition-colors" onClick={(e) => e.stopPropagation()}>source <ExternalLink className="w-2.5 h-2.5" /></a>
									: <span />
								}
								{/* Community skills are xp.io repos under the `community`
								    owner alias — same import-into-an-app flow as repo skills. */}
								<button
									onClick={() => onAction({ type: "add-skill", slug: `community/${c.name}`, label: c.display_name })}
									className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md bg-violet-600 text-white hover:bg-violet-700 active:scale-95 transition-all flex-shrink-0"
								>
									<Puzzle className="w-3 h-3" /> Add to app…
								</button>
							</div>
						</div>
					</article>
				);
			})}
		</div>
	);
}

// ── App detail + per-kind action drawer ─────────────────────────────

interface SidebarConfig { show: boolean; label: string; section: string }

// Skill-import entry as it appears in a published xpcloud.yaml.
type SkillImportEntry = string | { repo?: string; version?: string };

function AppDetailDrawer({
	app, status, installed, isPublic, onInstall, onAction, onOpen, onClose,
}: {
	app: RepoCard;
	status: InstallStatus;
	installed: boolean;
	isPublic?: boolean;
	onInstall: (cfg: SidebarConfig) => void;
	onAction: (a: PendingAction) => void;
	onOpen: (name: string) => void;
	onClose: () => void;
}) {
	const km = kindMeta(app.kind);
	const title = app.display_name || app.name;
	const act = kindAction(app.kind);
	const slug = `${app.owner_sub}/${app.name}`;
	// Link to the full read-only repo browser (Files + PRs). Public browse uses
	// the /explore mount; signed-in uses /studio.
	const repoHref = `${isPublic ? "/explore" : "/studio"}/r/${encodeURIComponent(app.owner_sub)}/${encodeURIComponent(app.name)}`;
	const [sidebar, setSidebar] = useState<SidebarConfig>({ show: true, label: title, section: "Apps" });
	const [preview, setPreview] = useState<{ state: "idle" | "loading" | "unavailable"; markdown?: string }>({ state: "idle" });
	// The repo's parsed xpcloud.yaml — drives the hierarchy panel (what this
	// app imports / declares) without a second fetch.
	const [repoDoc, setRepoDoc] = useState<Record<string, unknown> | null>(null);
	// For kind=skill: the apps that import this skill (xpcloud /consumers).
	const [consumers, setConsumers] = useState<{ name: string; owner_sub?: string }[] | null>(null);
	const backdropRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	// Fetch xpcloud.yaml (hierarchy panel) + markdown preview from xpcloud blobs.
	useEffect(() => {
		let live = true;
		setPreview({ state: "loading" });
		setRepoDoc(null);
		(async () => {
			try {
				const auth = await bearerHeader();
				const opts = { credentials: "same-origin" as const, headers: auth };
				// Resolve the spec blob with dual-read: prefer the canonical
				// .xpcloud.yaml dotfile, fall back to legacy xpcloud.yaml. The
				// resolver probes each candidate; cache each response so the
				// resolved path's body is reused without a second GET.
				const blobBase = `/api/v1/repos/${encodeURIComponent(app.owner_sub)}/${encodeURIComponent(app.name)}/blob/main`;
				const blobCache = new Map<string, Response>();
				const specPath = await resolveSpecPath(blobBase, async (path) => {
					const resp = await fetch(path, opts);
					blobCache.set(path, resp);
					return resp.ok;
				});
				if (!specPath) throw new Error("no xpcloud.yaml");
				const yamlResp = blobCache.get(specPath)!;
				const yamlData = await yamlResp.json().catch(() => null);
				const yamlText = yamlData?.content ?? (typeof yamlData === "string" ? yamlData : null);
				if (!yamlText) throw new Error("no content");
				const doc = parseYaml(yamlText) as Record<string, unknown> | null;
				if (live && doc) setRepoDoc(doc);
				const mdPath = (doc as Record<string, unknown> | null)?.ui &&
					(((doc as Record<string, unknown>).ui as Record<string, unknown>)?.surface as Record<string, unknown>)?.markdown;
				if (!mdPath || typeof mdPath !== "string" || mdPath.startsWith("@")) throw new Error("no markdown surface");
				const mdResp = await fetch(`/api/v1/repos/${encodeURIComponent(app.owner_sub)}/${encodeURIComponent(app.name)}/blob/main/${mdPath}`, opts);
				if (!mdResp.ok) throw new Error("markdown not found");
				const mdData = await mdResp.json().catch(() => null);
				const md = mdData?.content ?? (typeof mdData === "string" ? mdData : null);
				if (live && md) setPreview({ state: "loaded" as const, markdown: md });
				else if (live) setPreview({ state: "unavailable" });
			} catch {
				if (live) setPreview({ state: "unavailable" });
			}
		})();
		return () => { live = false; };
	}, [app.owner_sub, app.name]);

	// For skills: who uses this? (the hierarchy, bottom-up)
	useEffect(() => {
		if (app.kind !== "skill") { setConsumers(null); return; }
		let live = true;
		(async () => {
			try {
				const auth = await bearerHeader();
				const r = await fetch(`/api/v1/repos/${encodeURIComponent(app.owner_sub)}/${encodeURIComponent(app.name)}/consumers`, { credentials: "same-origin", headers: auth });
				if (!r.ok) throw new Error();
				const d = await r.json();
				if (live) setConsumers(Array.isArray(d?.consumers) ? d.consumers : Array.isArray(d) ? d : []);
			} catch {
				if (live) setConsumers([]);
			}
		})();
		return () => { live = false; };
	}, [app.kind, app.owner_sub, app.name]);

	const isInstalling = status.state === "installing";
	const isInstalled = installed || status.state === "installed";
	const isFailed = status.state === "failed";
	const updated = app.updated_at ? relativeDays(new Date(app.updated_at * 1000)) : null;

	// Hierarchy panel data (apps): what this repo imports / declares.
	const skillImports = (Array.isArray(repoDoc?.skill_imports) ? repoDoc?.skill_imports : []) as SkillImportEntry[];
	const memoryAgents = (Array.isArray(repoDoc?.memory_agents) ? repoDoc?.memory_agents : []) as unknown[];
	const datasetDecls = (Array.isArray(repoDoc?.datasets) ? repoDoc?.datasets : []) as { id?: string; repo?: string }[];
	const importRepoOf = (e: SkillImportEntry) => (typeof e === "string" ? e : e.repo || "");
	// Friendly display name: strip the `owner/` prefix from a repo slug.
	const friendlyName = (s: string) => s.replace(/^[^/]+\//, "");
	const hasHierarchy = act === "install" && (skillImports.length > 0 || memoryAgents.length > 0 || datasetDecls.length > 0 || !!app.fork_of);

	return (
		<div
			ref={backdropRef}
			onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
			className="fixed inset-0 z-50 flex items-start justify-end bg-black/15 backdrop-blur-[2px]"
		>
			<div className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
				{/* Kind accent bar */}
				<div className={`h-0.5 w-full ${km.bg} opacity-60`} />

				{/* Header */}
				<div className="flex items-start gap-3 p-5 border-b border-slate-100">
					<div className={`w-11 h-11 rounded-lg ${km.bg} ${km.text} flex items-center justify-center flex-shrink-0 text-xl`}>
						{km.glyph}
					</div>
					<div className="flex-1 min-w-0">
						<h2 className="font-semibold text-slate-900 text-[15px] leading-tight">{title}</h2>
						<p className="text-[11px] text-slate-300 mt-0.5 font-mono">
							{app.name}{app.version ? ` · v${app.version}` : ""}
							{app.visibility === "private" ? " · private" : ""}
							{app.fork_of ? " · customized copy" : ""}
						</p>
					</div>
					<button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto p-5 space-y-4">
					{app.summary && <p className="text-[13px] text-slate-600 leading-relaxed">{app.summary}</p>}

					<Link to={repoHref} onClick={onClose} className="inline-flex items-center gap-1 text-[12px] text-gold-700 hover:underline">
						Browse files &amp; pull requests →
					</Link>


					{/* Metrics */}
					<div className="flex items-center gap-3 text-[11px] text-slate-400">
						{updated && <span>{updated}</span>}
						{(app.stars ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3 text-gold-400" /> {app.stars}</span>}
						{(app.downloads ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><Download className="w-3 h-3" /> {app.downloads}</span>}
						{(app.forks ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><GitFork className="w-3 h-3" /> {app.forks}</span>}
					</div>

					{/* Tags */}
					{app.tags && app.tags.length > 0 && (
						<div className="flex items-center gap-1.5 flex-wrap">
							{app.tags.map((t) => (
								<span key={t} className="px-1.5 py-0.5 rounded-full text-[11px] border border-slate-200 text-slate-600">{t}</span>
							))}
						</div>
					)}

					{/* Hierarchy — what this app is built FROM (kinds are not flat) */}
					{hasHierarchy && (
						<div className="rounded-lg border border-slate-200 p-3.5 space-y-2">
							<div className="text-[12px] font-medium text-slate-700">What&apos;s inside</div>
							{app.fork_of && (
								<div className="flex items-center gap-1.5 text-[12px] text-slate-600">
									<GitFork className="w-3 h-3 text-slate-400 flex-shrink-0" />
									Customized copy of {friendlyName(app.fork_of)}
								</div>
							)}
							{skillImports.length > 0 && (
								<div className="space-y-1">
									<div className="text-[11px] text-slate-400 flex items-center gap-1">
										<Puzzle className="w-3 h-3" /> Uses {skillImports.length} skill{skillImports.length === 1 ? "" : "s"}:
									</div>
									{skillImports.map((e, i) => (
										<div key={i} className="font-mono text-[10.5px] text-violet-700 pl-4 truncate">{friendlyName(importRepoOf(e))}</div>
									))}
								</div>
							)}
							{memoryAgents.length > 0 && (
								<div className="text-[11px] text-slate-500 flex items-center gap-1">
									<BookOpen className="w-3 h-3 text-slate-400" />
									Learns into its own knowledge ({memoryAgents.length} agent{memoryAgents.length === 1 ? "" : "s"})
								</div>
							)}
							{datasetDecls.length > 0 && (
								<div className="space-y-1">
									<div className="text-[11px] text-slate-400 flex items-center gap-1">
										<Database className="w-3 h-3" /> Mounts {datasetDecls.length} dataset{datasetDecls.length === 1 ? "" : "s"}:
									</div>
									{datasetDecls.map((d, i) => (
										<div key={i} className="font-mono text-[10.5px] text-gold-700 pl-4 truncate">{friendlyName(d.repo || d.id || "")}</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* For skills: who uses it (hierarchy, bottom-up) */}
					{app.kind === "skill" && (
						<div className="rounded-lg border border-slate-200 p-3.5 space-y-1.5">
							<div className="text-[12px] font-medium text-slate-700">Apps using this skill</div>
							{consumers === null ? (
								<div className="text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />checking…</div>
							) : consumers.length === 0 ? (
								<div className="text-[11px] text-slate-400">No public apps use this skill yet.</div>
							) : (
								consumers.slice(0, 8).map((cns, i) => (
									<div key={i} className="font-mono text-[11px] text-gold-700 truncate">{cns.name.replace(/^[^/]+\//, "")}</div>
								))
							)}
						</div>
					)}

					{/* Per-kind "how to use" — for the kinds that aren't one-click */}
					{app.kind === "dataset" && (
						<div className="rounded-lg border border-gold-200 bg-gold-50/50 p-3.5 space-y-1.5">
							<div className="text-[12px] font-medium text-gold-800">How to use this dataset</div>
							<p className="text-[11.5px] text-gold-700 leading-relaxed">An app&apos;s owner adds this to the app&apos;s configuration:</p>
							<pre className="text-[10.5px] bg-white border border-gold-200 rounded p-2 overflow-x-auto text-slate-700">{`datasets:
  - {id: ${app.name.replace(/[^a-z0-9_]/gi, "_")}, repo: "${slug}",
     version: "${app.version || "1.0.0"}", mount_at: data/seed}`}</pre>
						</div>
					)}
					{app.kind === "strategy" && (
						<div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5 space-y-1.5">
							<div className="text-[12px] font-medium text-blue-800">How to use this strategy</div>
							<p className="text-[11.5px] text-blue-700 leading-relaxed">
								This is a trading strategy. It runs on Lumid Market (forward-testing competitions), not as an installed app.{" "}
								<Link to="/studio/a/lumid-market/competition/lobby" onClick={onClose} className="underline">Open Lumid Market →</Link>
							</p>
						</div>
					)}
					{app.kind === "workflow" && (
						<div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5 space-y-1.5">
							<div className="text-[12px] font-medium text-blue-800">How to use this workflow</div>
							<p className="text-[11.5px] text-blue-700 leading-relaxed">This is a recipe that runs inside an app — it isn&apos;t installed on its own. Browse the repo for the spec to adapt into an app you own.</p>
						</div>
					)}

					{/* Sidebar config — only meaningful for installable apps */}
					{act === "install" && !isInstalled && (
					<div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
						<div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
							<PanelLeft className="w-3.5 h-3.5 text-slate-400" /> Sidebar
						</div>
						<label className="flex items-center justify-between cursor-pointer">
							<span className="text-[12px] text-slate-600">Show in sidebar</span>
							<button
								type="button"
								role="switch"
								aria-checked={sidebar.show}
								onClick={() => setSidebar((s) => ({ ...s, show: !s.show }))}
								className={`relative inline-flex h-4.5 w-8 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${sidebar.show ? "bg-gold-500" : "bg-slate-200"}`}
							>
								<span className={`pointer-events-none inline-block h-3.5 w-3.5 mt-px transform rounded-full bg-white shadow transition-transform ${sidebar.show ? "translate-x-3.5" : "translate-x-0"}`} />
							</button>
						</label>
						{sidebar.show && (
							<>
								<label className="block">
									<span className="text-[11px] text-slate-500 block mb-1">Label</span>
									<input type="text" value={sidebar.label} onChange={(e) => setSidebar((s) => ({ ...s, label: e.target.value }))} className="w-full px-2 py-1 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/20" />
								</label>
								<label className="block">
									<span className="text-[11px] text-slate-500 block mb-1">Section</span>
									<input type="text" value={sidebar.section} onChange={(e) => setSidebar((s) => ({ ...s, section: e.target.value }))} className="w-full px-2 py-1 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/20" placeholder="e.g. Trading, Research" />
								</label>
							</>
						)}
						<div className={`text-[11px] px-2 py-1 rounded-md ${sidebar.show ? "bg-gold-50 text-gold-700" : "bg-slate-100 text-slate-500"}`}>
							{sidebar.show
								? <><Eye className="w-3 h-3 inline mr-1" />{sidebar.section} → {sidebar.label}</>
								: <><EyeOff className="w-3 h-3 inline mr-1" />Not in sidebar</>
							}
						</div>
					</div>
					)}

					{/* Preview */}
					{preview.state !== "unavailable" && (
						<details open className="rounded-lg border border-slate-200 overflow-hidden">
							<summary className="px-3.5 py-2 cursor-pointer text-[12px] font-medium text-slate-600 flex items-center gap-1.5 bg-slate-50 border-b border-slate-100 list-none select-none">
								<Eye className="w-3.5 h-3.5" /> UI Preview
								{preview.state === "loading" && <Loader2 className="w-3 h-3 animate-spin text-slate-400 ml-auto" />}
							</summary>
							<div className="p-3.5 max-h-52 overflow-y-auto text-[12px] text-slate-500">
								{preview.state === "loading" && "Loading preview…"}
								{preview.state === "idle" && ""}
								{"markdown" in preview && preview.markdown && (
									<pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-500 leading-relaxed">{preview.markdown.slice(0, 800)}{preview.markdown.length > 800 ? "\n…" : ""}</pre>
								)}
							</div>
						</details>
					)}

					{isFailed && status.state === "failed" && (
						<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{status.error}</div>
					)}
				</div>

				{/* Action footer — the verb depends on the kind */}
				<div className="p-4 border-t border-slate-100 bg-white">
					{act === "install" && (isInstalled ? (
						<button onClick={() => { onOpen(app.name); onClose(); }} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gold-50 text-gold-700 border border-gold-200 hover:bg-gold-100 text-sm font-medium transition-all">
							<Check className="w-4 h-4" /> Open {title} <ArrowRight className="w-4 h-4" />
						</button>
					) : (
						<>
							<button onClick={() => onInstall(sidebar)} disabled={isInstalling} className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isInstalling ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-700 active:scale-[0.98]"}`}>
								{isInstalling ? <><Loader2 className="w-4 h-4 animate-spin" /> Installing…</> : <><Plus className="w-4 h-4" /> Install {title}</>}
							</button>
							<p className="mt-2 text-center text-[11px] text-slate-400">Appears in My Apps — first run starts automatically.</p>
						</>
					))}
					{act === "add-skill" && (
						<button onClick={() => onAction({ type: "add-skill", slug, label: title, version: app.version })} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98] transition-all">
							<Puzzle className="w-4 h-4" /> Add {title} to an app…
						</button>
					)}
					{act === "subscribe" && (
						<button onClick={() => onAction({ type: "subscribe", slug, label: title })} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-pink-600 text-white hover:bg-pink-700 active:scale-[0.98] transition-all">
							<BookOpen className="w-4 h-4" /> Subscribe to {title}
						</button>
					)}
					{act === "view" && (
						<button onClick={onClose} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all">
							Close
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Refinements view ───────────────────────────────────────────────

function RefinementsView({ query }: { query: string }) {
	const [items, setItems] = useState<Refinement[]>(() => loadRefinements());
	const [recentTs, setRecentTs] = useState<number>(() => lastPublishedAt());

	useEffect(() => {
		const onChange = () => { setItems(loadRefinements()); setRecentTs(lastPublishedAt()); };
		window.addEventListener(REFINEMENTS_EVENT, onChange);
		window.addEventListener("focus", onChange);
		return () => { window.removeEventListener(REFINEMENTS_EVENT, onChange); window.removeEventListener("focus", onChange); };
	}, []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? items.filter((r) => r.name.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)) : items;
	}, [items, query]);

	if (filtered.length === 0) return (
		<div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
			{query ? <>No refinements match <strong>&ldquo;{query}&rdquo;</strong>.</> : <>No refinements yet.</>}
		</div>
	);

	const FRESH = 4000;
	const isFresh = (r: Refinement) => r.status === "published" && r.refinedAt === "just now" && recentTs > 0 && Date.now() - recentTs < FRESH;

	return (
		<ul className="space-y-2">
			{filtered.map((r) => (
				<li key={r.id} className={`rounded-lg border bg-white px-4 py-3 flex items-center gap-3 transition-all ${isFresh(r) ? "border-gold-300 bg-gold-50/60" : "border-slate-200"}`}>
					<GitFork className="w-4 h-4 text-slate-400 flex-shrink-0" />
					<div className="flex-1 min-w-0">
						<div className="font-medium text-slate-900 text-sm truncate">{r.name}</div>
						<div className="text-[11px] text-slate-400 mt-0.5">{r.version} · {r.refinedAt} · {r.source}</div>
					</div>
					{r.status === "published"
						? <span className="text-[11px] px-2 py-0.5 rounded bg-gold-50 text-gold-700 border border-gold-200 flex-shrink-0"><Check className="w-3 h-3 inline" /> Published</span>
						: <span className="text-[11px] text-slate-400 flex-shrink-0">Local only</span>
					}
				</li>
			))}
		</ul>
	);
}

// ── Utilities ──────────────────────────────────────────────────────

function relativeDays(d: Date): string {
	const t = d.getTime();
	if (Number.isNaN(t) || t < 1_704_067_200_000) return "—";
	const days = Math.floor((Date.now() - t) / 86_400_000);
	if (days < 1) return "today";
	if (days < 2) return "yesterday";
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

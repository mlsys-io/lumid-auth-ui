// MarketplaceBrowse — apps-first catalog UI for /studio/marketplace.
//
// Three tabs (top of page):
//   Apps      — full xpio app bundles (personal-agent, mbb-ai, etc.)
//               THIS IS THE DEFAULT. Apps are what users actually
//               install — bundles of workflows + skill_imports + a
//               privacy contract. /api/v1/repos?kind=app
//   Skills    — atomic building blocks (1-step workflows). Used to
//               compose apps. /api/v1/skills/catalog
//   Datasets  — reference data sources (FinData, KOLs, etc.).
//               /api/v1/repos?kind=dataset
//
// Search across all kinds; per-tab category rail (skills only — apps
// don't have a single "category" field today).

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
	Search, ExternalLink, Plus, Check, Loader2,
	Mail, Calendar, Globe, Code, Beaker, MessagesSquare,
	Database, FileSpreadsheet, Sparkles as LlmIcon, Layers, Settings,
	Star, Download, Package, Wrench, ArrowRight,
} from "lucide-react";
import { me, MeApiError } from "@/api/me";

// ── Apps tab ───────────────────────────────────────────────────────

interface RepoCard {
	owner_sub: string;
	name: string;
	display_name?: string;
	summary?: string;
	tags?: string[];
	version?: string;
	stars?: number;
	downloads?: number;
	forks?: number;
	updated_at?: number;
	consumers_count?: number;
	visibility?: string;
}

// ── Skills tab ─────────────────────────────────────────────────────

interface SkillCard {
	name: string;
	display_name: string;
	summary: string;
	category: string;
	tags: string[];
	needs_secrets: string[];
	knowledge_paths: string[];
	source_url?: string;
	kind?: string;
	step_count?: number;
}

const CATEGORY_META: Record<string, {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	accent: string;
	bg: string;
	text: string;
}> = {
	email:     { icon: Mail,             label: "Email",     accent: "bg-rose-400",    bg: "bg-rose-50",    text: "text-rose-700"    },
	calendar:  { icon: Calendar,         label: "Calendar",  accent: "bg-amber-400",   bg: "bg-amber-50",   text: "text-amber-700"   },
	web:       { icon: Globe,            label: "Web",       accent: "bg-sky-400",     bg: "bg-sky-50",     text: "text-sky-700"     },
	code:      { icon: Code,             label: "Code",      accent: "bg-violet-400",  bg: "bg-violet-50",  text: "text-violet-700"  },
	research:  { icon: Beaker,           label: "Research",  accent: "bg-emerald-400", bg: "bg-emerald-50", text: "text-emerald-700" },
	messaging: { icon: MessagesSquare,   label: "Messaging", accent: "bg-indigo-400",  bg: "bg-indigo-50",  text: "text-indigo-700"  },
	data:      { icon: Database,         label: "Data",      accent: "bg-cyan-400",    bg: "bg-cyan-50",    text: "text-cyan-700"    },
	sql:       { icon: FileSpreadsheet,  label: "SQL",       accent: "bg-orange-400",  bg: "bg-orange-50",  text: "text-orange-700"  },
	llm:       { icon: LlmIcon,          label: "LLM",       accent: "bg-purple-400",  bg: "bg-purple-50",  text: "text-purple-700"  },
};

function catMeta(c: string) {
	return CATEGORY_META[c] || { icon: Layers, label: c || "Other", accent: "bg-slate-400", bg: "bg-slate-50", text: "text-slate-700" };
}

// Detail page for a repo-backed card (app or dataset) — the canonical
// xp.io marketspace page. Opened in a new tab so the user keeps their
// Studio session. Skills link to their own source_url instead.
function repoHref(c: { owner_sub: string; name: string }): string {
	return `https://xp.io/${encodeURIComponent(c.owner_sub)}/${encodeURIComponent(c.name)}`;
}

function openDetail(url: string | undefined) {
	if (url) window.open(url, "_blank", "noopener,noreferrer");
}

type Tab = "apps" | "skills" | "datasets";

// InstallStatus — what each card tracks per-name. The card shows a
// stateful button: idle → installing → installed (with "Open →" link)
// or failed (with retry).
type InstallStatus =
	| { state: "idle" }
	| { state: "installing"; intentId?: string }
	| { state: "installed"; appName: string }
	| { state: "failed"; error: string };

export default function MarketplaceBrowse() {
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>("apps");
	const [query, setQuery] = useState("");
	const [statuses, setStatuses] = useState<Record<string, InstallStatus>>({});

	const [apps, setApps] = useState<RepoCard[] | null>(null);
	const [skills, setSkills] = useState<SkillCard[] | null>(null);
	const [datasets, setDatasets] = useState<RepoCard[] | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		(async () => {
			try {
				const [a, s, d] = await Promise.all([
					fetch("/api/v1/repos?kind=app").then((r) => r.ok ? r.json() : Promise.reject(`apps ${r.status}`)),
					fetch("/api/v1/skills/catalog").then((r) => r.ok ? r.json() : Promise.reject(`skills ${r.status}`)),
					fetch("/api/v1/repos?kind=dataset").then((r) => r.ok ? r.json() : Promise.reject(`datasets ${r.status}`)),
				]);
				setApps(a.repos || []);
				setSkills(s.cards || []);
				setDatasets(d.repos || []);
			} catch (e) {
				setErr(e instanceof Error ? e.message : String(e));
			}
		})();
	}, []);

	// Direct install — calls /me/apps with the slug, then polls the
	// returned intent until terminal. On success the card surfaces an
	// "Open" link that navigates to the new workflow. On failure the
	// button flips to a retry-with-error state.
	const install = async (label: string, name: string, ownerSub?: string) => {
		// xpio slugs are "owner_sub/name" for non-first-party repos; the
		// /me/apps handler accepts the bare name for first-party apps.
		const slug = ownerSub ? `${ownerSub}/${name}` : name;
		setStatuses((m) => ({ ...m, [name]: { state: "installing" } }));
		try {
			const resp = await me.installApp(slug, "local");
			setStatuses((m) => ({ ...m, [name]: { state: "installing", intentId: resp.intent_id } }));
			// Poll the intent every 1.2s; intents typically finish in 5–15s.
			// The backend signals success/failure inside result.ok; status
			// is just "pending" → "completed" (no separate failed state).
			const deadline = Date.now() + 60_000;
			let installedAs = name;
			let ok = false;
			let pollErr: string | null = null;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 1200));
				try {
					const r = await me.getIntent(resp.intent_id);
					if (r.status === "completed") {
						const result = (r.result || {}) as Record<string, unknown>;
						ok = result.ok !== false;
						installedAs = (result.app as string | undefined)
							|| (result.installed_as as string | undefined)
							|| installedAs;
						if (!ok) pollErr = String(result.error || "install failed");
						break;
					}
				} catch (e) {
					if (e instanceof MeApiError && e.code === 1404) continue;
					throw e;
				}
			}
			if (!ok && pollErr) throw new Error(pollErr);
			if (!ok) throw new Error("install timed out — check Workflows in a moment");
			setStatuses((m) => ({ ...m, [name]: { state: "installed", appName: installedAs } }));
			toast.success(`${label} installed`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatuses((m) => ({ ...m, [name]: { state: "failed", error: msg } }));
			toast.error(`Install failed: ${msg}`);
		}
	};

	const openInstalled = (appName: string) => {
		// Newly-installed apps surface as scheduled workflows under
		// /studio/workflows. Drilling to a specific workflow requires
		// knowing the loop slug; for now we just open the list and let
		// the user click into the app card.
		navigate(`/studio/workflows?selected=${encodeURIComponent(appName)}`);
	};

	if (err) {
		return (
			<div className="rounded-xl border border-rose-200 bg-rose-50/40 p-6 text-sm text-rose-800">
				Couldn&apos;t load the catalog: {err}
			</div>
		);
	}

	const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; count: number | null }> = [
		{ id: "apps",     label: "Apps",     icon: Package,  count: apps?.length ?? null },
		{ id: "skills",   label: "Skills",   icon: Wrench,   count: skills?.length ?? null },
		{ id: "datasets", label: "Datasets", icon: Database, count: datasets?.length ?? null },
	];

	return (
		<div className="space-y-4">
			{/* Tabs */}
			<nav className="flex items-center gap-1 border-b border-slate-200">
				{tabs.map((t) => {
					const Icon = t.icon;
					const active = tab === t.id;
					return (
						<button
							key={t.id}
							onClick={() => { setTab(t.id); setQuery(""); }}
							className={[
								"inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors -mb-px",
								active
									? "text-slate-900 border-emerald-500 font-medium"
									: "text-slate-500 border-transparent hover:text-slate-800",
							].join(" ")}
						>
							<Icon className="w-4 h-4" />
							{t.label}
							{t.count !== null && (
								<span className={["text-[10px] font-mono tabular-nums", active ? "text-slate-500" : "text-slate-400"].join(" ")}>
									{t.count}
								</span>
							)}
						</button>
					);
				})}
			</nav>

			{/* Search */}
			<div className="relative">
				<Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={tab === "apps"
						? "Search apps…"
						: tab === "skills"
							? "Search skills by name, tag, or what you want to do…"
							: "Search datasets…"}
					className="w-full pl-10 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white/80 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-400/15 focus:border-emerald-400 transition-all placeholder:text-slate-400"
				/>
			</div>

			{/* Body */}
			{tab === "apps" && (
				<AppsView
					apps={apps}
					query={query}
					statuses={statuses}
					onInstall={install}
					onOpen={openInstalled}
				/>
			)}
			{tab === "skills" && (
				<SkillsView
					skills={skills}
					query={query}
					statuses={statuses}
					onInstall={install}
					onOpen={openInstalled}
				/>
			)}
			{tab === "datasets" && (
				<DatasetsView
					datasets={datasets}
					query={query}
				/>
			)}
		</div>
	);
}

// ── Apps view — featured tier ──────────────────────────────────────

function AppsView({
	apps, query, statuses, onInstall, onOpen,
}: {
	apps: RepoCard[] | null;
	query: string;
	statuses: Record<string, InstallStatus>;
	onInstall: (label: string, name: string, ownerSub?: string) => void;
	onOpen: (appName: string) => void;
}) {
	const filtered = useMemo(() => {
		if (!apps) return [];
		const q = query.trim().toLowerCase();
		if (!q) return apps;
		return apps.filter((a) =>
			a.name.toLowerCase().includes(q) ||
			(a.display_name || "").toLowerCase().includes(q) ||
			(a.summary || "").toLowerCase().includes(q) ||
			(a.tags || []).some((t) => t.toLowerCase().includes(q)),
		);
	}, [apps, query]);

	if (apps === null) {
		return (
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{[0, 1, 2, 3].map((i) => (
					<div key={i} className="h-44 rounded-2xl bg-white border border-slate-200/60 animate-pulse" />
				))}
			</div>
		);
	}

	if (filtered.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
				{query ? <>No apps match <strong>&ldquo;{query}&rdquo;</strong>.</> : <>No apps available.</>}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
			{filtered.map((a) => (
				<AppCard
					key={a.name}
					app={a}
					status={statuses[a.name] || { state: "idle" }}
					onInstall={() => onInstall(a.display_name || a.name, a.name, a.owner_sub)}
					onOpen={onOpen}
				/>
			))}
		</div>
	);
}

function AppCard({
	app, status, onInstall, onOpen,
}: {
	app: RepoCard;
	status: InstallStatus;
	onInstall: () => void;
	onOpen: (appName: string) => void;
}) {
	const title = app.display_name || app.name;
	const updated = app.updated_at ? new Date(app.updated_at * 1000) : null;

	return (
		<article
			onClick={() => openDetail(repoHref(app))}
			className="group rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/20 hover:border-emerald-300 hover:shadow-md transition-all overflow-hidden flex flex-col cursor-pointer"
			title={`View ${title} on xp.io`}
		>
			<div className="p-4 flex-1 flex flex-col">
				<div className="flex items-start gap-3">
					<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-200">
						<Package className="w-5 h-5" />
					</div>
					<div className="flex-1 min-w-0">
						<h3 className="font-semibold text-slate-900 text-[14px] leading-tight">
							{title}
						</h3>
						<p className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
							{app.name}{app.version ? ` · v${app.version}` : ""}
						</p>
					</div>
				</div>

				{app.summary && (
					<p className="text-[13px] text-slate-600 mt-3 leading-relaxed line-clamp-3 min-h-[3.9rem]">
						{app.summary}
					</p>
				)}

				{app.tags && app.tags.length > 0 && (
					<div className="flex items-center gap-1.5 flex-wrap mt-3">
						{app.tags.slice(0, 4).map((t) => (
							<span
								key={t}
								className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200/60"
							>
								{t}
							</span>
						))}
						{app.tags.length > 4 && (
							<span className="text-[10px] text-slate-400">+{app.tags.length - 4}</span>
						)}
					</div>
				)}

				<div
					className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2"
					onClick={(e) => e.stopPropagation()}
				>
					<div className="flex items-center gap-3 text-[11px] text-slate-400 min-w-0">
						{(app.stars ?? 0) > 0 && (
							<span className="inline-flex items-center gap-1 flex-shrink-0" title="Stars">
								<Star className="w-3 h-3" /> {app.stars}
							</span>
						)}
						{(app.downloads ?? 0) > 0 && (
							<span className="inline-flex items-center gap-1 flex-shrink-0" title="Downloads">
								<Download className="w-3 h-3" /> {app.downloads}
							</span>
						)}
						{updated && (
							<span className="truncate" title={updated.toLocaleString()}>
								{relativeDays(updated)}
							</span>
						)}
					</div>
					<InstallButton status={status} onInstall={onInstall} onOpen={onOpen} />
				</div>
			</div>
		</article>
	);
}

// InstallButton — single source of truth for the four states. Used by
// both AppCard and SkillCardView so the visual + behavior stays
// consistent across surfaces.
function InstallButton({
	status, onInstall, onOpen,
}: {
	status: InstallStatus;
	onInstall: () => void;
	onOpen: (appName: string) => void;
}) {
	switch (status.state) {
		case "idle":
			return (
				<button
					onClick={onInstall}
					className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg transition-all flex-shrink-0 bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 shadow-sm shadow-emerald-100"
				>
					<Plus className="w-3 h-3" /> Install
				</button>
			);
		case "installing":
			return (
				<span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-slate-100 text-slate-600 flex-shrink-0">
					<Loader2 className="w-3 h-3 animate-spin" /> Installing…
				</span>
			);
		case "installed":
			return (
				<button
					onClick={() => onOpen(status.appName)}
					className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60 hover:bg-emerald-100 transition-all flex-shrink-0"
					title="Open the new workflow"
				>
					<Check className="w-3 h-3" /> Open <ArrowRight className="w-3 h-3" />
				</button>
			);
		case "failed":
			return (
				<button
					onClick={onInstall}
					className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200/60 hover:bg-rose-100 transition-all flex-shrink-0"
					title={status.error}
				>
					Retry
				</button>
			);
	}
}

// ── Skills view — atomic building blocks ───────────────────────────

function SkillsView({
	skills, query, statuses, onInstall, onOpen,
}: {
	skills: SkillCard[] | null;
	query: string;
	statuses: Record<string, InstallStatus>;
	onInstall: (label: string, name: string) => void;
	onOpen: (appName: string) => void;
}) {
	const [activeCategory, setActiveCategory] = useState<string | null>(null);

	const categories = useMemo(() => {
		if (!skills) return [];
		const counts = new Map<string, number>();
		for (const c of skills) counts.set(c.category, (counts.get(c.category) || 0) + 1);
		return Array.from(counts.entries())
			.map(([id, n]) => ({ id, n, ...catMeta(id) }))
			.sort((a, b) => b.n - a.n);
	}, [skills]);

	const filtered = useMemo(() => {
		if (!skills) return [];
		const q = query.trim().toLowerCase();
		return skills.filter((c) => {
			if (activeCategory && c.category !== activeCategory) return false;
			if (!q) return true;
			return (
				c.display_name.toLowerCase().includes(q) ||
				c.summary.toLowerCase().includes(q) ||
				c.tags.some((t) => t.toLowerCase().includes(q))
			);
		});
	}, [skills, query, activeCategory]);

	if (skills === null) {
		return (
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{[0, 1, 2, 3].map((i) => (
					<div key={i} className="h-32 rounded-xl bg-white border border-slate-200/60 animate-pulse" />
				))}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-4 items-start">
			<aside className="lg:sticky lg:top-24 space-y-1">
				<CategoryChip
					active={activeCategory === null}
					icon={Layers}
					label="All"
					count={skills.length}
					accent="bg-slate-400"
					onClick={() => setActiveCategory(null)}
				/>
				{categories.map((c) => (
					<CategoryChip
						key={c.id}
						active={activeCategory === c.id}
						icon={c.icon}
						label={c.label}
						count={c.n}
						accent={c.accent}
						onClick={() => setActiveCategory(c.id === activeCategory ? null : c.id)}
					/>
				))}
			</aside>

			<div className="min-w-0">
				{filtered.length === 0 ? (
					<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
						{query
							? <>No skills match <strong>&ldquo;{query}&rdquo;</strong>.</>
							: <>No skills in this category.</>}
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						{filtered.map((c) => (
							<SkillCardView
								key={c.name}
								card={c}
								hideCategory={activeCategory !== null}
								status={statuses[c.name] || { state: "idle" }}
								onInstall={() => onInstall(c.display_name, c.name)}
								onOpen={onOpen}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function CategoryChip({
	active, icon: Icon, label, count, accent, onClick,
}: {
	active: boolean;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	count: number;
	accent: string;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className={[
				"w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all group",
				active
					? "bg-slate-900 text-white shadow-sm"
					: "bg-white/60 hover:bg-white border border-transparent hover:border-slate-200/60 text-slate-700",
			].join(" ")}
		>
			<span className={[
				"w-1.5 h-6 rounded-full transition-opacity",
				accent,
				active ? "opacity-100" : "opacity-50 group-hover:opacity-80",
			].join(" ")} />
			<Icon className={[
				"w-4 h-4 flex-shrink-0",
				active ? "text-white" : "text-slate-500",
			].join(" ")} />
			<span className="flex-1 text-left">{label}</span>
			<span className={[
				"text-[10px] font-mono tabular-nums",
				active ? "text-white/70" : "text-slate-400",
			].join(" ")}>{count}</span>
		</button>
	);
}

function SkillCardView({
	card, hideCategory, status, onInstall, onOpen,
}: {
	card: SkillCard;
	hideCategory: boolean;
	status: InstallStatus;
	onInstall: () => void;
	onOpen: (appName: string) => void;
}) {
	const meta = catMeta(card.category);
	const Icon = meta.icon;
	const needsSecret = (card.needs_secrets?.length ?? 0) > 0;

	return (
		<article
			onClick={card.source_url ? () => openDetail(card.source_url) : undefined}
			className={[
				"group rounded-xl border border-slate-200 bg-white hover:border-emerald-200 hover:shadow-md transition-all overflow-hidden flex flex-col",
				card.source_url ? "cursor-pointer" : "",
			].join(" ")}
			title={card.source_url ? `View ${card.display_name} source` : undefined}
		>
			<div className={["h-1", meta.accent].join(" ")} />
			<div className="p-4 flex-1 flex flex-col">
				<div className="flex items-start gap-3">
					<div className={[
						"w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
						meta.bg, meta.text,
					].join(" ")}>
						<Icon className="w-4 h-4" />
					</div>
					<div className="flex-1 min-w-0">
						<h3 className="font-semibold text-slate-900 text-[14px] leading-tight">
							{card.display_name}
						</h3>
						<p className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">{card.name}</p>
					</div>
				</div>

				<p className="text-[13px] text-slate-600 mt-2.5 leading-relaxed line-clamp-2 min-h-[2.6rem]">
					{card.summary}
				</p>

				<div className="flex items-center gap-1.5 flex-wrap mt-3 min-h-[1.5rem]">
					{!hideCategory && (
						<span className={[
							"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
							meta.bg, meta.text,
						].join(" ")}>
							{meta.label}
						</span>
					)}
					{needsSecret && (
						<span
							className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/60"
							title={`Needs auth: ${card.needs_secrets.join(", ")}`}
						>
							<Settings className="w-2.5 h-2.5" />
							auth
						</span>
					)}
				</div>

				<div
					className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between"
					onClick={(e) => e.stopPropagation()}
				>
					{card.source_url ? (
						<a
							href={card.source_url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-[11px] text-slate-400 hover:text-slate-700 inline-flex items-center gap-1 transition-colors"
							title="View source"
						>
							source <ExternalLink className="w-2.5 h-2.5" />
						</a>
					) : <span />}
					<InstallButton status={status} onInstall={onInstall} onOpen={onOpen} />
				</div>
			</div>
		</article>
	);
}

// ── Datasets view ──────────────────────────────────────────────────

function DatasetsView({
	datasets, query,
}: {
	datasets: RepoCard[] | null;
	query: string;
}) {
	const filtered = useMemo(() => {
		if (!datasets) return [];
		const q = query.trim().toLowerCase();
		if (!q) return datasets;
		return datasets.filter((d) =>
			d.name.toLowerCase().includes(q) ||
			(d.display_name || "").toLowerCase().includes(q) ||
			(d.summary || "").toLowerCase().includes(q),
		);
	}, [datasets, query]);

	if (datasets === null) {
		return (
			<div className="space-y-2">
				{[0, 1, 2].map((i) => (
					<div key={i} className="h-16 rounded-xl bg-white border border-slate-200/60 animate-pulse" />
				))}
			</div>
		);
	}

	if (filtered.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
				{query ? <>No datasets match <strong>&ldquo;{query}&rdquo;</strong>.</> : <>No datasets available.</>}
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{filtered.map((d) => (
				<article
					key={d.name}
					onClick={() => openDetail(repoHref(d))}
					className="group rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-emerald-200 hover:shadow-sm transition-all flex items-center gap-3 cursor-pointer"
					title={`View ${d.display_name || d.name} on xp.io`}
				>
					<div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center flex-shrink-0">
						<Database className="w-4 h-4" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="font-medium text-slate-900 text-[14px] truncate">
							{d.display_name || d.name}
						</div>
						{d.summary && (
							<p className="text-[12px] text-slate-500 mt-0.5 line-clamp-1">{d.summary}</p>
						)}
					</div>
					<span className="text-[11px] text-slate-400 font-mono flex-shrink-0">{d.name}</span>
					<ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
				</article>
			))}
		</div>
	);
}

// ── Utilities ──────────────────────────────────────────────────────

function relativeDays(d: Date): string {
	const t = d.getTime();
	// Guard null/epoch/pre-2024 timestamps (would render "20272d ago").
	if (Number.isNaN(t) || t < 1_704_067_200_000) return "—";
	const days = Math.floor((Date.now() - t) / 86_400_000);
	if (days < 1) return "today";
	if (days < 2) return "yesterday";
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

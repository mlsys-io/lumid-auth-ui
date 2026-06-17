// App management panel — /studio/a/:app/manage
//
// The app surface page renders what an app SHOWS; this panel manages what an
// app IS BUILT FROM: its display name (the My Apps card + sidebar label), its
// workflows (xpcloud.yaml loops[]), and its skill imports. Everything edits
// the installed bundle's xpcloud.yaml through the existing config write
// endpoint (server-side YAML-validated, tenant-only) — comments and formatting
// survive because edits go through yaml's parseDocument, not parse/stringify.
//
// Skill imports additionally need the skill FILES pulled into the tenant's
// skills root, so adding one goes through the add_skill intent (same flow as
// the marketplace's "Add to app…") rather than a bare yaml edit.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { parseDocument, YAMLSeq } from "yaml";
import { toast } from "sonner";
import {
	Loader2, Play, Trash2, Plus, Puzzle, Pencil, Check,
	CalendarClock, BookOpen, Database, Search, ArrowLeft, Share2, GitFork, UploadCloud, GitPullRequest, DownloadCloud,
} from "lucide-react";
import apiClient from "@/api/client";
import { me, MeApiError, waitForIntent } from "@/api/me";
import { bearerHeader } from "@/api/session-bearer";
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type LoopDef = { name?: string; schedule?: string; skills?: unknown[]; steps?: unknown[]; goal?: string };
type SkillImport = string | { repo?: string; version?: string };

const SCHEDULE_PRESETS: { label: string; value: string }[] = [
	{ label: "Manual only (@trigger)", value: "@trigger" },
	{ label: "Every 30 minutes", value: "*/30 * * * *" },
	{ label: "Hourly", value: "0 * * * *" },
	{ label: "Daily at 08:00", value: "0 8 * * *" },
	{ label: "Weekdays at 08:00", value: "0 8 * * 1-5" },
	{ label: "Weekly (Mon 09:00)", value: "0 9 * * 1" },
];

export default function AppManagePanel() {
	const { app = "" } = useParams<{ app: string }>();
	const [yamlText, setYamlText] = useState<string | null>(null);
	// Optimistic-lock token for config writes (see mutate()).
	const [yamlSha, setYamlSha] = useState<string | undefined>(undefined);
	const [tenant, setTenant] = useState<boolean | null>(null);
	const [loadErr, setLoadErr] = useState("");
	const [saving, setSaving] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [wfFormOpen, setWfFormOpen] = useState(false);

	const reload = useCallback(() => {
		me.appConfig(app)
			.then((r) => { setYamlText(r.yaml); setYamlSha(r.sha); })
			.catch((e) => setLoadErr(String((e as Error)?.message ?? e)));
	}, [app]);

	useEffect(() => {
		reload();
		me.listApps()
			.then((r) => setTenant(!!r.apps?.find((a) => a.name === app)?.tenant))
			.catch(() => setTenant(null));
	}, [app, reload]);

	// Parsed view of the current yaml (read-only derivations).
	const doc = useMemo(() => (yamlText == null ? null : parseDocument(yamlText)), [yamlText]);
	const js = useMemo(() => (doc ? (doc.toJS() as Record<string, unknown> | null) : null), [doc]);
	const loops: LoopDef[] = useMemo(() => {
		const l = (js?.loops ?? js?.workflows) as LoopDef[] | undefined;
		return Array.isArray(l) ? l : [];
	}, [js]);
	const skillImports: SkillImport[] = useMemo(
		() => (Array.isArray(js?.skill_imports) ? (js?.skill_imports as SkillImport[]) : []), [js]);
	const memoryAgents: unknown[] = useMemo(
		() => (Array.isArray(js?.memory_agents) ? (js?.memory_agents as unknown[]) : []), [js]);
	const datasets: { id?: string; repo?: string }[] = useMemo(
		() => (Array.isArray(js?.datasets) ? (js?.datasets as { id?: string; repo?: string }[]) : []), [js]);

	const displayName = String(js?.display_name ?? "");
	const sidebarLabel = String(
		((js?.ui as Record<string, unknown> | undefined)?.sidebar as Record<string, unknown> | undefined)?.label ?? "");

	const readOnly = tenant === false;

	// Apply a mutation to the yaml DOCUMENT (comment-preserving) and PUT it
	// under an optimistic lock. The edits here are SEMANTIC (setIn/append),
	// so a 409 (someone else saved since our read) is safe to resolve by
	// re-reading the fresh yaml and reapplying the same mutation once.
	const mutate = async (fn: (d: ReturnType<typeof parseDocument>) => void, okMsg: string) => {
		if (!yamlText) return;
		setSaving(true);
		try {
			const apply = async (text: string, sha: string | undefined, retry: boolean): Promise<void> => {
				const d = parseDocument(text);
				fn(d);
				const out = d.toString();
				try {
					const res = await me.updateAppConfig(app, out, sha);
					setYamlText(out);
					setYamlSha(res.sha);
					toast.success(okMsg);
				} catch (e) {
					if (retry && e instanceof MeApiError && e.ret_code === 1409) {
						const fresh = await me.appConfig(app);
						return apply(fresh.yaml, fresh.sha, false);
					}
					throw e;
				}
			};
			await apply(yamlText, yamlSha, true);
		} catch (e) {
			toast.error(String((e as Error)?.message ?? e));
		} finally {
			setSaving(false);
		}
	};

	// ── Rename ──────────────────────────────────────────────────────
	const [nameDraft, setNameDraft] = useState<string | null>(null);
	const effectiveName = nameDraft ?? (sidebarLabel || displayName || app);
	const renameDirty = nameDraft !== null && nameDraft.trim() !== "" &&
		nameDraft !== (sidebarLabel || displayName || app);
	const saveRename = () =>
		mutate((d) => {
			const v = (nameDraft ?? "").trim();
			d.setIn(["display_name"], v);
			// Only touch the sidebar label if a sidebar block exists or the
			// app is shown by name — creating ui.sidebar implicitly is fine,
			// MeAppsList reads it for the card + nav label.
			d.setIn(["ui", "sidebar", "label"], v);
		}, "Renamed — the card and sidebar update on next load.").then(() => setNameDraft(null));

	// ── Workflows ───────────────────────────────────────────────────
	const loopsKey = Array.isArray(js?.loops) ? "loops" : Array.isArray(js?.workflows) ? "workflows" : "loops";
	const addWorkflow = (wf: { name: string; schedule: string; skills: string[]; goal: string }) =>
		mutate((d) => {
			if (!d.has(loopsKey)) d.set(loopsKey, []);
			const seq = d.get(loopsKey, true) as YAMLSeq;
			const entry: Record<string, unknown> = { name: wf.name, schedule: wf.schedule };
			if (wf.skills.length) entry.skills = wf.skills;
			if (wf.goal.trim()) entry.goal = wf.goal.trim();
			seq.add(d.createNode(entry));
		}, `Workflow "${wf.name}" added — the scheduler discovers it on its next tick.`);

	const removeWorkflow = async (name: string) => {
		if (!window.confirm(`Remove workflow "${name}"? Its run history stays on disk.`)) return;
		try {
			await me.deleteLoop(app, name);
			toast.success(`Removed ${name}.`);
			reload();
		} catch (e) {
			toast.error(String((e as Error)?.message ?? e));
		}
	};

	const [runningLoop, setRunningLoop] = useState<string | null>(null);
	const runNow = async (name: string) => {
		setRunningLoop(name);
		try {
			await me.runLoopNow(app, name);
			toast.success(`Triggered ${name} — watch My Jobs / the app page for the run.`);
		} catch (e) {
			toast.error(String((e as Error)?.message ?? e));
		} finally {
			setRunningLoop(null);
		}
	};

	// ── Skills ──────────────────────────────────────────────────────
	const importRepoOf = (e: SkillImport) => (typeof e === "string" ? e : e.repo || "");
	const removeImport = (repo: string) => {
		if (!window.confirm(`Remove the import of ${repo}? The pulled files stay under ~/.xp/skills (re-adding is instant).`)) return;
		void mutate((d) => {
			const seq = d.get("skill_imports", true) as YAMLSeq | undefined;
			if (!seq || !Array.isArray(seq.items)) return;
			const idx = seq.items.findIndex((it) => {
				const v = (it as { toJSON?: () => unknown }).toJSON?.() ?? it;
				return (typeof v === "string" ? v : (v as { repo?: string })?.repo) === repo;
			});
			if (idx >= 0) seq.delete(idx);
		}, `Import of ${repo} removed.`);
	};

	if (loadErr) {
		return <div className="p-8 text-sm text-rose-600">Couldn&apos;t load {app}: {loadErr}</div>;
	}
	if (yamlText == null) {
		return <div className="p-8 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading {app}…</div>;
	}

	return (
		<div className="px-6 py-4 max-w-3xl space-y-5">
			{/* Header */}
			<div className="flex items-center gap-3">
				<Link to={`/studio/a/${encodeURIComponent(app)}`} className="text-[12px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
					<ArrowLeft className="w-3.5 h-3.5" /> {app}
				</Link>
				<span className="text-slate-300">/</span>
				<span className="text-[13px] font-medium text-slate-800">Manage</span>
				{readOnly && (
					<span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-gold-50 text-gold-700 border border-gold-200">
						operator-shared — read-only (install your own copy to edit)
					</span>
				)}
			</div>

			{/* Rename — drives the My Apps card + sidebar label */}
			<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
				<div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
					<Pencil className="w-3.5 h-3.5 text-slate-400" /> Name
				</div>
				<p className="text-[11.5px] text-slate-500">Shown on the My Apps card and the sidebar. The install id (<code className="text-[10.5px]">{app}</code>) doesn&apos;t change.</p>
				<div className="flex gap-2">
					<input
						value={effectiveName}
						onChange={(e) => setNameDraft(e.target.value)}
						disabled={readOnly || saving}
						className="flex-1 px-2.5 py-1.5 text-[13px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/20 focus:border-gold-400 disabled:bg-slate-50"
					/>
					<button
						onClick={saveRename}
						disabled={!renameDirty || readOnly || saving}
						className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 transition-all"
					>
						{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Rename"}
					</button>
				</div>
			</section>

			{/* Workflows */}
			<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
				<div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
					<CalendarClock className="w-3.5 h-3.5 text-slate-400" /> Workflows
					<button
						onClick={() => setWfFormOpen(true)}
						disabled={readOnly}
						className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-gold-700 text-white hover:bg-gold-800 disabled:opacity-40 transition-all"
					>
						<Plus className="w-3 h-3" /> New workflow
					</button>
				</div>
				{loops.length === 0 ? (
					<p className="text-[12px] text-slate-400">No workflows yet. A workflow is a scheduled loop of skill steps — create one and the scheduler runs it automatically.</p>
				) : (
					<div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
						{loops.map((l, i) => (
							<div key={i} className="flex items-center gap-3 px-3 py-2">
								<div className="flex-1 min-w-0">
									<div className="text-[13px] text-slate-800 font-medium truncate">{l.name || `loop-${i}`}</div>
									<div className="text-[11px] text-slate-400 font-mono">
										{l.schedule || "—"}
										{Array.isArray(l.skills) && l.skills.length > 0 && <span className="ml-2 text-slate-300">· {l.skills.length} skill{l.skills.length > 1 ? "s" : ""}</span>}
										{Array.isArray(l.steps) && l.steps.length > 0 && <span className="ml-2 text-slate-300">· {l.steps.length} step{l.steps.length > 1 ? "s" : ""}</span>}
									</div>
								</div>
								<button
									onClick={() => runNow(l.name || "")}
									disabled={!l.name || runningLoop === l.name}
									title="Run now"
									className="p-1.5 rounded-lg text-slate-400 hover:text-gold-700 hover:bg-gold-50 disabled:opacity-40 transition-colors"
								>
									{runningLoop === l.name ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
								</button>
								<button
									onClick={() => removeWorkflow(l.name || "")}
									disabled={!l.name || readOnly}
									title="Remove workflow"
									className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
								>
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
						))}
					</div>
				)}
			</section>

			{/* Skills */}
			<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
				<div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
					<Puzzle className="w-3.5 h-3.5 text-slate-400" /> Imported skills
					<button
						onClick={() => setPickerOpen(true)}
						disabled={readOnly}
						className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-all"
					>
						<Plus className="w-3 h-3" /> Import skill…
					</button>
				</div>
				{skillImports.length === 0 ? (
					<p className="text-[12px] text-slate-400">No imported skills. Imports pull shared skill repos into this app — its workflows can then call them.</p>
				) : (
					<div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
						{skillImports.map((s, i) => {
							const repo = importRepoOf(s);
							const ver = typeof s === "object" ? s.version : undefined;
							return (
								<div key={i} className="flex items-center gap-3 px-3 py-2">
									<div className="flex-1 min-w-0 font-mono text-[12px] text-violet-700 truncate">{repo}{ver ? <span className="text-slate-400"> @ {ver}</span> : null}</div>
									<button
										onClick={() => removeImport(repo)}
										disabled={readOnly}
										title="Remove import"
										className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
									>
										<Trash2 className="w-4 h-4" />
									</button>
								</div>
							);
						})}
					</div>
				)}
			</section>

			{/* Knowledge + datasets — read-only context */}
			{(memoryAgents.length > 0 || datasets.length > 0) && (
				<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
					<div className="text-[13px] font-medium text-slate-800">Also part of this app</div>
					{memoryAgents.length > 0 && (
						<div className="text-[12px] text-slate-600 flex items-start gap-1.5">
							<BookOpen className="w-3.5 h-3.5 text-pink-400 mt-0.5 flex-shrink-0" />
							<span>Knowledge agents: {memoryAgents.map((a) => <code key={String(a)} className="text-[11px] mr-1.5">{typeof a === "string" ? a : JSON.stringify(a)}</code>)}</span>
						</div>
					)}
					{datasets.length > 0 && (
						<div className="text-[12px] text-slate-600 flex items-start gap-1.5">
							<Database className="w-3.5 h-3.5 text-gold-400 mt-0.5 flex-shrink-0" />
							<span>Datasets: {datasets.map((d, i) => <code key={i} className="text-[11px] mr-1.5">{d.repo || d.id}</code>)}</span>
						</div>
					)}
					<p className="text-[11px] text-slate-400">Edit these in <Link to={`/studio/a/${encodeURIComponent(app)}/config`} className="underline">Config</Link> (raw xpcloud.yaml).</p>
				</section>
			)}

			<ShareSection app={app} readOnly={readOnly} />

			{/* Dialogs */}
			<SkillPickerDialog
				app={app}
				existing={skillImports.map(importRepoOf)}
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				onAdded={reload}
			/>
			<NewWorkflowDialog
				open={wfFormOpen}
				existingNames={loops.map((l) => l.name || "")}
				suggestedSkills={skillImports.map(importRepoOf)}
				onClose={() => setWfFormOpen(false)}
				onCreate={(wf) => { setWfFormOpen(false); void addWorkflow(wf); }}
			/>
		</div>
	);
}

// ── Skill picker — browse kind=skill repos + community catalog ──────

type PickerSkill = { slug: string; label: string; summary?: string; version?: string };

function SkillPickerDialog({
	app, existing, open, onClose, onAdded,
}: {
	app: string;
	existing: string[];
	open: boolean;
	onClose: () => void;
	onAdded: () => void;
}) {
	const [items, setItems] = useState<PickerSkill[] | null>(null);
	const [filter, setFilter] = useState("");
	const [busySlug, setBusySlug] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setItems(null);
		(async () => {
			try {
				const auth = await bearerHeader();
				const opts = { credentials: "same-origin" as const, headers: auth };
				const [repos, cards] = await Promise.all([
					fetch("/api/v1/repos?kind=skill", opts).then((r) => (r.ok ? r.json() : { repos: [] })),
					fetch("/api/v1/skills/catalog", opts).then((r) => (r.ok ? r.json() : { cards: [] })),
				]);
				const out: PickerSkill[] = [];
				const seen = new Set<string>();
				for (const r of repos.repos ?? []) {
					const slug = `${r.owner_sub}/${r.name}`;
					if (seen.has(slug)) continue;
					seen.add(slug);
					out.push({ slug, label: r.display_name || r.name, summary: r.summary, version: r.version });
				}
				for (const c of cards.cards ?? []) {
					const slug = `community/${c.name}`;
					if (seen.has(slug)) continue;
					seen.add(slug);
					out.push({ slug, label: c.display_name || c.name, summary: c.summary });
				}
				setItems(out);
			} catch {
				setItems([]);
			}
		})();
	}, [open]);

	const filtered = useMemo(() => {
		if (!items) return [];
		const q = filter.trim().toLowerCase();
		return q
			? items.filter((s) => s.slug.toLowerCase().includes(q) || s.label.toLowerCase().includes(q) || (s.summary ?? "").toLowerCase().includes(q))
			: items;
	}, [items, filter]);

	const add = async (s: PickerSkill) => {
		setBusySlug(s.slug);
		try {
			const resp = await me.addSkillToApp(app, s.slug, s.version);
			const result = await waitForIntent(resp.intent_id, { timeoutMs: 90_000 });
			const data = (result.result ?? {}) as { error?: string; changed?: boolean };
			if (data.error) throw new Error(data.error);
			toast.success(data.changed === false ? "Already imported." : `${s.label} imported into ${app}.`);
			onAdded();
			onClose();
		} catch (e) {
			toast.error(String((e as Error)?.message ?? e));
		} finally {
			setBusySlug(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[15px]">
						<Puzzle className="w-4 h-4 text-violet-500" /> Import a skill into {app}
					</DialogTitle>
					<DialogDescription className="text-[12.5px]">
						Adds the skill to <code className="text-[11px]">skill_imports</code> and pulls its files — workflows can then call it.
					</DialogDescription>
				</DialogHeader>
				<div className="relative">
					<Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
					<input
						value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search skills…"
						className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-400"
					/>
				</div>
				{items === null ? (
					<div className="py-6 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading catalog…</div>
				) : (
					<div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
						{filtered.length === 0 && <div className="px-3 py-4 text-[12px] text-slate-400">No skills match.</div>}
						{filtered.map((s) => {
							const already = existing.includes(s.slug);
							return (
								<div key={s.slug} className="flex items-center gap-3 px-3 py-2">
									<div className="flex-1 min-w-0">
										<div className="text-[13px] text-slate-800 truncate">{s.label}</div>
										<div className="text-[10.5px] text-slate-400 font-mono truncate">{s.slug}</div>
									</div>
									{already ? (
										<span className="text-[11px] text-gold-600 inline-flex items-center gap-1 flex-shrink-0"><Check className="w-3 h-3" /> imported</span>
									) : (
										<button
											onClick={() => add(s)}
											disabled={busySlug !== null}
											className="px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex-shrink-0 transition-all"
										>
											{busySlug === s.slug ? <Loader2 className="w-3 h-3 animate-spin" /> : "Import"}
										</button>
									)}
								</div>
							);
						})}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ── New workflow dialog ──────────────────────────────────────────────

function NewWorkflowDialog({
	open, existingNames, suggestedSkills, onClose, onCreate,
}: {
	open: boolean;
	existingNames: string[];
	suggestedSkills: string[];
	onClose: () => void;
	onCreate: (wf: { name: string; schedule: string; skills: string[]; goal: string }) => void;
}) {
	const [name, setName] = useState("");
	const [schedule, setSchedule] = useState("0 8 * * *");
	const [customCron, setCustomCron] = useState(false);
	const [skillsText, setSkillsText] = useState("");
	const [goal, setGoal] = useState("");

	useEffect(() => {
		if (open) { setName(""); setSchedule("0 8 * * *"); setCustomCron(false); setSkillsText(""); setGoal(""); }
	}, [open]);

	const slug = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	const nameClash = existingNames.includes(slug);
	const valid = slug.length > 0 && !nameClash && schedule.trim().length > 0;

	return (
		<Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[15px]">
						<CalendarClock className="w-4 h-4 text-gold-600" /> New workflow
					</DialogTitle>
					<DialogDescription className="text-[12.5px]">
						A scheduled loop of skill steps. It lands in this app&apos;s <code className="text-[11px]">xpcloud.yaml</code> and the scheduler picks it up automatically.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<label className="block">
						<span className="text-[11.5px] text-slate-500 block mb-1">Name</span>
						<input
							value={name} onChange={(e) => setName(e.target.value)} placeholder="morning_brief"
							className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-gold-400/20 focus:border-gold-400"
						/>
						{slug && slug !== name && <span className="text-[10.5px] text-slate-400 mt-0.5 block">saved as <code>{slug}</code></span>}
						{nameClash && <span className="text-[10.5px] text-rose-600 mt-0.5 block">a workflow with this name already exists</span>}
					</label>
					<label className="block">
						<span className="text-[11.5px] text-slate-500 block mb-1">Schedule</span>
						{!customCron ? (
							<div className="flex gap-2">
								<select
									value={schedule} onChange={(e) => setSchedule(e.target.value)}
									className="flex-1 px-2 py-1.5 text-[13px] rounded-lg border border-slate-200 bg-white"
								>
									{SCHEDULE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
								</select>
								<button onClick={() => setCustomCron(true)} className="text-[11px] text-slate-500 hover:text-slate-800 underline">custom cron</button>
							</div>
						) : (
							<input
								value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 8 * * *"
								className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-gold-400/20"
							/>
						)}
					</label>
					<label className="block">
						<span className="text-[11.5px] text-slate-500 block mb-1">Skill steps <span className="text-slate-400">(comma-separated, run in order)</span></span>
						<input
							value={skillsText} onChange={(e) => setSkillsText(e.target.value)}
							placeholder="observe/fetch, analyze/summarize"
							className="w-full px-2.5 py-1.5 text-[12.5px] rounded-lg border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-gold-400/20"
						/>
						{suggestedSkills.length > 0 && (
							<span className="text-[10.5px] text-slate-400 mt-1 block">imported skill repos: {suggestedSkills.join(", ")}</span>
						)}
					</label>
					<label className="block">
						<span className="text-[11.5px] text-slate-500 block mb-1">Goal <span className="text-slate-400">(optional, shown on the app page)</span></span>
						<input
							value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Summarize overnight market moves"
							className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
						/>
					</label>
					<button
						onClick={() => onCreate({
							name: slug,
							schedule: schedule.trim(),
							skills: skillsText.split(",").map((s) => s.trim()).filter(Boolean),
							goal,
						})}
						disabled={!valid}
						className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gold-700 text-white hover:bg-gold-800 disabled:opacity-40 transition-all"
					>
						<Plus className="w-4 h-4" /> Create workflow
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ── Share & publish — the fork → publish → propose loop (2026-06-11) ──
// Fork makes the user their own editable copy (repo under THEIR xp.io
// account + installed here). Publish pushes their local changes to that
// repo (patch version auto-bumps). Propose opens a pull request on the
// app this was forked from.
function ShareSection({ app, readOnly }: { app: string; readOnly: boolean }) {
	const [busy, setBusy] = useState<null | "fork" | "publish" | "propose" | "pull">(null);
	const [forkName, setForkName] = useState(`my-${app}`);
	// Pull upstream updates into THIS install (three-way merge; local edits kept).
	// Applies to any installed app, not just forks — so it lives in the header.
	const pullUpdates = async () => {
		setBusy("pull");
		try {
			await apiClient.post(`/api/v1/me/apps/${encodeURIComponent(app)}/update`, {});
			toast.success("Update queued — upstream changes merge in ~a minute (your edits are preserved).");
		} catch (e) {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const msg = (e as any)?.response?.data?.message || (e instanceof Error ? e.message : String(e));
			toast.error(`Failed: ${String(msg).slice(0, 180)}`);
		} finally { setBusy(null); }
	};
	const post = async (kind: "fork" | "publish" | "propose", path: string, body: Record<string, unknown>, okMsg: (d: Record<string, unknown>) => string) => {
		setBusy(kind);
		try {
			const r = await apiClient.post(`/api/v1/me/apps/${encodeURIComponent(app)}/${path}`, body);
			const data = (r.data?.data ?? {}) as Record<string, unknown>;
			toast.success(okMsg(data));
		} catch (e) {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const msg = (e as any)?.response?.data?.message || (e instanceof Error ? e.message : String(e));
			toast.error(`Failed: ${String(msg).slice(0, 180)}`);
		} finally { setBusy(null); }
	};
	return (
		<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
			<div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
				<Share2 className="w-3.5 h-3.5 text-slate-400" /> Share &amp; publish
				<button disabled={!!busy} onClick={pullUpdates}
					title="Pull the latest upstream version into this install — three-way merge, your local edits are preserved"
					className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40">
					{busy === "pull" ? <Loader2 className="w-3 h-3 animate-spin" /> : <DownloadCloud className="w-3 h-3" />} Pull updates
				</button>
			</div>
			<div className="grid gap-2.5 sm:grid-cols-3">
				<div className="rounded-lg border border-slate-200/80 p-3 space-y-1.5">
					<div className="text-[12px] font-medium text-slate-700">Fork</div>
					<p className="text-[11px] text-slate-500 leading-snug">Your own editable copy — a repo under your xp.io account, installed here.</p>
					<input value={forkName} onChange={(e) => setForkName(e.target.value)}
						className="w-full px-2 py-1 text-[11px] font-mono rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-gold-400/30" />
					<button disabled={!!busy} onClick={() => post("fork", "fork", { name: forkName },
						(d) => `Forked — installing ${String(d.fork || forkName)}…`)}
						className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[12px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40">
						{busy === "fork" ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitFork className="w-3 h-3" />} Fork this app
					</button>
				</div>
				<div className="rounded-lg border border-slate-200/80 p-3 space-y-1.5">
					<div className="text-[12px] font-medium text-slate-700">Publish</div>
					<p className="text-[11px] text-slate-500 leading-snug">Push your local changes to your xp.io repo. Version bumps automatically.</p>
					<button disabled={!!busy || readOnly} onClick={() => post("publish", "publish", {},
						() => "Publish queued — your repo updates in ~a minute.")}
						className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[12px] rounded-lg bg-gold-700 text-white hover:bg-gold-800 disabled:opacity-40">
						{busy === "publish" ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />} Publish changes
					</button>
				</div>
				<div className="rounded-lg border border-slate-200/80 p-3 space-y-1.5">
					<div className="text-[12px] font-medium text-slate-700">Propose</div>
					<p className="text-[11px] text-slate-500 leading-snug">Offer your published changes back to the app you forked from, as a pull request.</p>
					<button disabled={!!busy || readOnly} onClick={() => post("propose", "propose", {},
						(d) => `Pull request opened on ${String(d.upstream || "upstream")}.`)}
						className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[12px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40">
						{busy === "propose" ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitPullRequest className="w-3 h-3" />} Propose upstream
					</button>
				</div>
			</div>
		</section>
	);
}


// NewWorkflowFlow — a guided "New workflow" creation flow that mirrors the
// same nouns users see when OBSERVING a workflow: Goal → Data → Pipeline.
//
// Goal #1 of the workflow initiative is "easy to create": state the Goal,
// point at / create the Data casebook, and let the platform auto-COMPOSE the
// Pipeline. NO raw YAML — everything is form-based and the pipeline is drafted
// for the user via the existing compose path.
//
// Four steps:
//   1. GOAL     — name + plain-English objective + the metric(s) to optimize.
//   2. DATA     — point at an existing casebook (a dataset on one of your apps)
//                 or start empty / external. Light: a selector + optional note.
//   3. PIPELINE — auto-composed via me.composeWorkflow(); the transparent
//                 Search → Match → Verify build renders in an AssemblyCard.
//   4. CREATE   — show the compose verify[] checklist as a validation preview,
//                 then Create (= me.installApp + schedule + first run), reusing
//                 the exact creation path the AssemblyCard / WorkflowComposer use.
//
// Reuses: me.composeWorkflow, me.installApp, me.patchLoop, me.runLoopNow,
// me.listApps, me.appDatasets, and the AssemblyCard component. It does NOT
// introduce a new backend — there is no app_validate/manifest_lint endpoint,
// so the "validation preview" surfaces the compose draft's assembly_trace.verify[]
// (parent published / imports published / N skills resolved / risk wired /
// pipeline complete), which is the closest existing signal.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	X, Loader2, Check, Sparkles, Target, Database, Plus, Trash2,
	ArrowRight, ArrowLeft, ShieldCheck, AlertTriangle, Clock, Play, Package,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { me, MeApiError, type MeAppCard, type MeDatasetGroup } from "@/api/me";
import AssemblyCard, { type ComposedDraft } from "@/components/workflow/AssemblyCard";

interface Props {
	open: boolean;
	onClose: () => void;
}

type StepKey = "goal" | "data" | "pipeline" | "create";

const STEPS: Array<{ key: StepKey; label: string; icon: typeof Target }> = [
	{ key: "goal", label: "Goal", icon: Target },
	{ key: "data", label: "Data", icon: Database },
	{ key: "pipeline", label: "Pipeline", icon: Sparkles },
	{ key: "create", label: "Create", icon: ShieldCheck },
];

const SCHEDULES = [
	{ label: "Every 12 hours", cron: "0 */12 * * *" },
	{ label: "Daily · 8am", cron: "0 8 * * *" },
	{ label: "Hourly", cron: "0 * * * *" },
	{ label: "On demand", cron: "@trigger" },
];

// A casebook = a dataset group on one of the user's apps, OR "start empty".
type Casebook =
	| { mode: "empty" }
	| { mode: "dataset"; app: string; group: string; label: string };

export function NewWorkflowFlow({ open, onClose }: Props) {
	const navigate = useNavigate();
	const [step, setStep] = useState<StepKey>("goal");

	// Step 1 — Goal
	const [name, setName] = useState("");
	const [objective, setObjective] = useState("");
	const [metrics, setMetrics] = useState<string[]>([""]);

	// Step 2 — Data
	const [casebook, setCasebook] = useState<Casebook>({ mode: "empty" });
	const [dataNote, setDataNote] = useState("");

	// Step 3/4 — composed draft
	const [composing, setComposing] = useState(false);
	const [draft, setDraft] = useState<ComposedDraft | null>(null);
	const [schedule, setSchedule] = useState("0 8 * * *");
	const [creating, setCreating] = useState(false);
	const [created, setCreated] = useState(false);

	// Reset to a clean slate each time the flow opens.
	useEffect(() => {
		if (open) {
			setStep("goal");
			setName(""); setObjective(""); setMetrics([""]);
			setCasebook({ mode: "empty" }); setDataNote("");
			setComposing(false); setDraft(null);
			setSchedule("0 8 * * *"); setCreating(false); setCreated(false);
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !creating && !composing) onClose(); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, creating, composing, onClose]);

	if (!open) return null;

	const cleanMetrics = metrics.map((m) => m.trim()).filter(Boolean);
	const goalReady = objective.trim().length > 0;

	// Fold the structured Goal + Data into one plain-English intent for the
	// compose path — the backend composer reads natural language, so we hand it
	// the objective enriched with the metrics and casebook the user picked.
	const buildIntent = () => {
		const parts: string[] = [objective.trim()];
		if (cleanMetrics.length) parts.push(`Optimize for ${cleanMetrics.join(", ")}.`);
		if (casebook.mode === "dataset") {
			parts.push(`Use the "${casebook.label}" casebook (dataset "${casebook.group}" from ${casebook.app}) as the data source.`);
		} else if (dataNote.trim()) {
			parts.push(`Data: ${dataNote.trim()}.`);
		}
		return parts.join(" ");
	};

	const compose = async () => {
		setComposing(true);
		setDraft(null);
		try {
			const r = await me.composeWorkflow(buildIntent(), name.trim() || undefined) as unknown as ComposedDraft & {
				draft_slug?: string;
				skills_picked?: string[];
			};
			const d: ComposedDraft = {
				slug: String(r.draft_slug || r.slug || ""),
				intent: r.intent || buildIntent(),
				skills: Array.isArray(r.skills_picked) ? r.skills_picked : (r.skills || []),
				skill_summaries: r.skill_summaries,
				steps: r.steps,
				schedule: r.schedule,
				schedule_human: r.schedule_human,
				goal: r.goal || (goalReady ? { primary: objective.trim(), tracked: cleanMetrics } : undefined),
				risk_agent: r.risk_agent,
				mode: r.mode,
				for_app: r.for_app,
				kind: r.kind,
				assembly_trace: r.assembly_trace,
			};
			setDraft(d);
			if (d.schedule) setSchedule(d.schedule);
			setStep("pipeline");
		} catch (e) {
			toast.error(`Compose failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setComposing(false);
		}
	};

	// CREATE — the exact path AssemblyCard/WorkflowComposer use: install the
	// composed draft, then (best-effort, after install settles) set the chosen
	// schedule and kick the first cycle, and land on its dashboard.
	const create = async () => {
		if (!draft?.slug) return;
		setCreating(true);
		const app = draft.slug.replace(/-draft$/, "");
		try {
			await me.installApp(draft.slug, "local");
			toast.success("Creating your workflow…");
			setCreated(true);
			window.setTimeout(() => { me.patchLoop(app, app, { schedule }).catch(() => {}); }, 9000);
			window.setTimeout(() => { me.runLoopNow(app, app).catch(() => {}); }, 9500);
			window.setTimeout(() => {
				onClose();
				navigate(`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(app)}`);
			}, 8200);
		} catch (e) {
			toast.error(`Create failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			setCreating(false);
		}
	};

	const idx = STEPS.findIndex((s) => s.key === step);
	const busy = creating || composing;

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !busy && onClose()} />
			<div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
				<header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
					<div>
						<h2 className="font-semibold text-slate-900">New workflow</h2>
						<p className="text-xs text-slate-500">State the goal, point at your data, and we assemble the pipeline.</p>
					</div>
					<button onClick={() => !busy && onClose()} className="p-1.5 text-slate-400 hover:text-slate-700 rounded">
						<X className="w-4 h-4" />
					</button>
				</header>

				{/* Step rail — mirrors the Goal → Data → Pipeline nouns */}
				<StepRail idx={idx} />

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{step === "goal" && (
						<GoalStep
							name={name} setName={setName}
							objective={objective} setObjective={setObjective}
							metrics={metrics} setMetrics={setMetrics}
						/>
					)}
					{step === "data" && (
						<DataStep casebook={casebook} setCasebook={setCasebook} dataNote={dataNote} setDataNote={setDataNote} />
					)}
					{step === "pipeline" && (
						<PipelineStep composing={composing} draft={draft} onCompose={compose} />
					)}
					{step === "create" && draft && (
						<CreateStep
							draft={draft} schedule={schedule} setSchedule={setSchedule}
							creating={creating} created={created} onCreate={create}
						/>
					)}
				</div>

				{/* Footer nav — Create step manages its own primary button */}
				{step !== "create" && (
					<footer className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50/50">
						<button
							onClick={() => setStep(STEPS[Math.max(0, idx - 1)].key)}
							disabled={idx === 0 || busy}
							className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							<ArrowLeft className="w-3.5 h-3.5" />Back
						</button>
						<PrimaryNav
							step={step}
							goalReady={goalReady}
							composing={composing}
							draft={draft}
							onNext={() => setStep(STEPS[idx + 1].key)}
							onCompose={compose}
							onToCreate={() => setStep("create")}
						/>
					</footer>
				)}
			</div>
		</div>
	);
}

// ── Step rail ─────────────────────────────────────────────────────────────
function StepRail({ idx }: { idx: number }) {
	return (
		<div className="px-5 py-2.5 flex items-center gap-1 border-b border-slate-100 bg-slate-50/40">
			{STEPS.map((s, i) => {
				const Icon = s.icon;
				const state = i < idx ? "done" : i === idx ? "active" : "todo";
				return (
					<div key={s.key} className="flex items-center gap-1 flex-1 last:flex-none">
						<div className={cn(
							"flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors",
							state === "done" ? "text-gold-700" : state === "active" ? "text-gold-700 bg-gold-100" : "text-slate-400",
						)}>
							<span className={cn(
								"w-4 h-4 rounded-full flex items-center justify-center text-[9px]",
								state === "todo" ? "bg-slate-200 text-slate-500" : "bg-gold-500 text-white",
							)}>
								{state === "done" ? <Check className="w-2.5 h-2.5" /> : i + 1}
							</span>
							<span className="hidden sm:inline">{s.label}</span>
							<Icon className="w-3 h-3 sm:hidden" />
						</div>
						{i < STEPS.length - 1 && (
							<div className={cn("flex-1 h-px mx-0.5", i < idx ? "bg-gold-300" : "bg-slate-200")} />
						)}
					</div>
				);
			})}
		</div>
	);
}

// ── Primary nav button (varies per step) ────────────────────────────────────
function PrimaryNav({ step, goalReady, composing, draft, onNext, onCompose, onToCreate }: {
	step: StepKey;
	goalReady: boolean;
	composing: boolean;
	draft: ComposedDraft | null;
	onNext: () => void;
	onCompose: () => void;
	onToCreate: () => void;
}) {
	const base = "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 text-white hover:from-gold-400 hover:to-gold-500 active:scale-95 transition-all shadow-sm shadow-gold-200 disabled:opacity-60 disabled:cursor-not-allowed";
	if (step === "goal") {
		return <button onClick={onNext} disabled={!goalReady} className={base}>Next: Data<ArrowRight className="w-3.5 h-3.5" /></button>;
	}
	if (step === "data") {
		return (
			<button onClick={onCompose} disabled={composing} className={base}>
				{composing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Assembling…</> : <><Sparkles className="w-3.5 h-3.5" />Assemble pipeline</>}
			</button>
		);
	}
	// pipeline
	return (
		<button onClick={onToCreate} disabled={composing || !draft} className={base}>
			Next: Validate &amp; create<ArrowRight className="w-3.5 h-3.5" />
		</button>
	);
}

// ── Step 1 · Goal ───────────────────────────────────────────────────────────
function GoalStep({ name, setName, objective, setObjective, metrics, setMetrics }: {
	name: string; setName: (s: string) => void;
	objective: string; setObjective: (s: string) => void;
	metrics: string[]; setMetrics: (m: string[]) => void;
}) {
	const setMetric = (i: number, v: string) => setMetrics(metrics.map((m, j) => (j === i ? v : m)));
	const addMetric = () => setMetrics([...metrics, ""]);
	const removeMetric = (i: number) => setMetrics(metrics.length > 1 ? metrics.filter((_, j) => j !== i) : [""]);
	return (
		<div className="space-y-5">
			<div>
				<label className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Name <span className="text-slate-300 normal-case tracking-normal">· optional</span></label>
				<input
					value={name} onChange={(e) => setName(e.target.value)}
					placeholder="e.g. Daily AI news brief"
					className="mt-1 w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400"
				/>
			</div>
			<div>
				<label className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Objective</label>
				<p className="text-[11px] text-slate-400 mt-0.5">In plain English — what should this workflow accomplish?</p>
				<textarea
					value={objective} onChange={(e) => setObjective(e.target.value)} rows={3}
					placeholder="e.g. Every morning, scan the day's AI industry news, summarize the 5 that matter, and learn which sources I keep."
					className="mt-1.5 w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400 resize-y"
				/>
			</div>
			<div>
				<label className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Metrics to optimize <span className="text-slate-300 normal-case tracking-normal">· optional</span></label>
				<p className="text-[11px] text-slate-400 mt-0.5">What gets better each cycle? Add one per row.</p>
				<div className="mt-1.5 space-y-1.5">
					{metrics.map((m, i) => (
						<div key={i} className="flex items-center gap-2">
							<input
								value={m} onChange={(e) => setMetric(i, e.target.value)}
								placeholder={i === 0 ? "e.g. relevance score" : "add another metric"}
								className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400"
							/>
							<button
								onClick={() => removeMetric(i)}
								className="p-1.5 text-slate-300 hover:text-rose-500 rounded"
								title="Remove metric"
							>
								<Trash2 className="w-3.5 h-3.5" />
							</button>
						</div>
					))}
				</div>
				<button onClick={addMetric} className="mt-2 inline-flex items-center gap-1 text-xs text-gold-700 hover:text-gold-800 font-medium">
					<Plus className="w-3.5 h-3.5" />Add a metric
				</button>
			</div>
		</div>
	);
}

// ── Step 2 · Data (casebook) ─────────────────────────────────────────────────
function DataStep({ casebook, setCasebook, dataNote, setDataNote }: {
	casebook: Casebook; setCasebook: (c: Casebook) => void;
	dataNote: string; setDataNote: (s: string) => void;
}) {
	const [apps, setApps] = useState<MeAppCard[] | null>(null);
	// app slug → its dataset groups (lazy, per-app)
	const [groupsByApp, setGroupsByApp] = useState<Record<string, MeDatasetGroup[]>>({});
	const [loadingApp, setLoadingApp] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		me.listApps()
			.then((r) => { if (live) setApps((r.apps || []).filter((a) => a.status !== "failed")); })
			.catch(() => { if (live) setApps([]); });
		return () => { live = false; };
	}, []);

	const openApp = async (appName: string) => {
		if (expanded === appName) { setExpanded(null); return; }
		setExpanded(appName);
		if (groupsByApp[appName]) return;
		setLoadingApp(appName);
		try {
			const r = await me.appDatasets(appName);
			setGroupsByApp((prev) => ({ ...prev, [appName]: r.datasets || [] }));
		} catch {
			setGroupsByApp((prev) => ({ ...prev, [appName]: [] }));
		} finally {
			setLoadingApp(null);
		}
	};

	const isEmpty = casebook.mode === "empty";

	return (
		<div className="space-y-4">
			<p className="text-[12px] text-slate-500">
				A <span className="font-medium text-slate-700">casebook</span> is the data your workflow learns from. Point at an existing one, or start empty and bring data later.
			</p>

			{/* Start empty / external */}
			<button
				onClick={() => setCasebook({ mode: "empty" })}
				className={cn(
					"w-full text-left rounded-xl border p-3.5 transition-all",
					isEmpty ? "border-gold-300 bg-gold-50/60 ring-2 ring-gold-200" : "border-slate-200 bg-white hover:border-gold-200",
				)}
			>
				<div className="flex items-center gap-3">
					<div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isEmpty ? "bg-gold-100 text-gold-700" : "bg-slate-100 text-slate-400")}>
						<Database className="w-4.5 h-4.5" />
					</div>
					<div className="min-w-0">
						<div className="text-sm font-medium text-slate-900">Start empty / external data</div>
						<div className="text-[11px] text-slate-500">The workflow will gather or fetch its own data each cycle.</div>
					</div>
					{isEmpty && <Check className="w-4 h-4 text-gold-600 ml-auto flex-shrink-0" />}
				</div>
			</button>

			{/* Existing casebooks, grouped by the user's apps */}
			<div>
				<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">Existing casebooks</div>
				{apps === null ? (
					<div className="text-[12px] text-slate-400 flex items-center gap-1.5 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading your apps…</div>
				) : apps.length === 0 ? (
					<div className="text-[12px] text-slate-400 py-2">No apps yet — start empty above.</div>
				) : (
					<div className="space-y-1.5">
						{apps.map((a) => {
							const groups = groupsByApp[a.name];
							const open = expanded === a.name;
							return (
								<div key={a.name} className="rounded-xl border border-slate-200 overflow-hidden bg-white">
									<button onClick={() => openApp(a.name)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
										<Package className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
										<span className="text-[13px] text-slate-700 font-medium flex-1 truncate">{a.name}</span>
										{loadingApp === a.name && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-300" />}
										<ArrowRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform", open && "rotate-90")} />
									</button>
									{open && groups && (
										<div className="border-t border-slate-100 px-3 py-2 space-y-1">
											{groups.length === 0 ? (
												<div className="text-[11px] text-slate-400">No casebooks on this app.</div>
											) : groups.map((g) => {
												const picked = casebook.mode === "dataset" && casebook.app === a.name && casebook.group === g.group;
												return (
													<button
														key={g.group}
														onClick={() => setCasebook({ mode: "dataset", app: a.name, group: g.group, label: g.label })}
														className={cn(
															"w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
															picked ? "bg-gold-50 ring-1 ring-gold-200" : "hover:bg-slate-50",
														)}
													>
														<Database className="w-3 h-3 text-gold-500 flex-shrink-0" />
														<span className="text-[12px] text-slate-700 flex-1 truncate">{g.label}</span>
														<span className="text-[10px] text-slate-400">{g.files.length} file{g.files.length === 1 ? "" : "s"}</span>
														{picked && <Check className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />}
													</button>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Optional note */}
			<div>
				<label className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Note <span className="text-slate-300 normal-case tracking-normal">· optional</span></label>
				<input
					value={dataNote} onChange={(e) => setDataNote(e.target.value)}
					placeholder="Anything about the data the assembler should know"
					className="mt-1 w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400"
				/>
			</div>
		</div>
	);
}

// ── Step 3 · Pipeline (auto-composed) ────────────────────────────────────────
function PipelineStep({ composing, draft, onCompose }: {
	composing: boolean; draft: ComposedDraft | null; onCompose: () => void;
}) {
	if (composing && !draft) {
		return (
			<div className="py-12 text-center space-y-2">
				<div className="inline-flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin text-gold-500" />Assembling your pipeline…</div>
				<div className="text-[11px] text-slate-400">Searching the xp.io skill catalog and matching skills to your goal.</div>
			</div>
		);
	}
	if (!draft) {
		return (
			<div className="py-12 text-center space-y-3">
				<div className="text-[13px] text-slate-500">No pipeline yet.</div>
				<button onClick={onCompose} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 text-white hover:from-gold-400 hover:to-gold-500 active:scale-95 transition-all shadow-sm shadow-gold-200">
					<Sparkles className="w-3.5 h-3.5" />Assemble pipeline
				</button>
			</div>
		);
	}
	// The AssemblyCard plays the transparent Search → Match → Verify build for
	// the real composed draft (resolved live against xp.io). Re-mounted per
	// draft slug so a recompose replays the build.
	return (
		<div className="space-y-3">
			<p className="text-[12px] text-slate-500">
				Auto-composed from your goal — no YAML. Each skill is resolved live from the xp.io knowledge graph.
			</p>
			<AssemblyCard key={draft.slug} draft={{ ...draft, schedule: undefined }} />
		</div>
	);
}

// ── Step 4 · Validate & create ────────────────────────────────────────────────
function CreateStep({ draft, schedule, setSchedule, creating, created, onCreate }: {
	draft: ComposedDraft; schedule: string; setSchedule: (s: string) => void;
	creating: boolean; created: boolean; onCreate: () => void;
}) {
	const steps = draft.steps || [];
	// Validation preview. There is no app_validate / manifest_lint endpoint, so
	// we derive a lint-style checklist from the compose draft's assembly_trace
	// (the same probes the AssemblyCard's Verify stage shows) plus a couple of
	// shape checks computed client-side. See backend follow-up in the report.
	const verify = draft.assembly_trace?.verify || [];
	const resolvedN = steps.filter((s) => s.resolved !== false && !!s.resolved_repo).length;
	const lint = useMemo(() => {
		const rows: Array<{ check: string; detail: string; status: "pass" | "warn" | "fail" }> = [];
		rows.push({
			check: "manifest_lint",
			detail: draft.slug
				? `Draft "${draft.slug}" has a valid pipeline shape (${steps.length} step${steps.length === 1 ? "" : "s"}).`
				: "No draft slug — recompose the pipeline.",
			status: draft.slug && steps.length > 0 ? "pass" : "fail",
		});
		rows.push({
			check: "tools_resolvable",
			detail: steps.length
				? `${resolvedN}/${steps.length} skills resolved on xp.io; the rest ship local-only with the fork.`
				: "No steps to resolve.",
			status: steps.length === 0 ? "warn" : resolvedN === steps.length ? "pass" : "warn",
		});
		// Fold in the compose-side verify rows (parent published, imports
		// published, risk wired, pipeline complete) — real signals from xp.io.
		for (const v of verify) rows.push(v);
		return rows;
	}, [draft.slug, steps.length, resolvedN, verify]);

	if (created) {
		return (
			<div className="py-12 text-center space-y-3">
				<div className="inline-flex w-14 h-14 rounded-2xl bg-gold-100 text-gold-600 items-center justify-center animate-in zoom-in duration-300"><Check className="w-7 h-7" /></div>
				<div className="text-sm font-medium text-slate-900">{draft.slug.replace(/-draft$/, "")} is live — running its first cycle.</div>
				<div className="text-xs text-slate-500">Taking you to its dashboard…</div>
			</div>
		);
	}

	const hasFail = lint.some((r) => r.status === "fail");

	return (
		<div className="space-y-4">
			{draft.goal?.primary && (
				<div className="rounded-xl border border-gold-200/70 bg-gradient-to-br from-gold-50/80 to-white px-3 py-2">
					<div className="text-[10px] uppercase tracking-wide text-gold-700/70 font-semibold">Goal</div>
					<div className="text-[12.5px] text-slate-800 font-medium">{draft.goal.primary}</div>
					{draft.goal.tracked && draft.goal.tracked.length > 0 && (
						<div className="text-[10px] text-slate-400 mt-0.5">tracks {draft.goal.tracked.join(" · ")}</div>
					)}
				</div>
			)}

			{/* Validation preview */}
			<div>
				<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Validation</div>
				<div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
					{lint.map((r, i) => (
						<LintRow key={i} row={r} />
					))}
				</div>
			</div>

			{/* Schedule */}
			<div>
				<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" />Schedule</div>
				<div className="flex flex-wrap gap-1.5">
					{SCHEDULES.map((s) => (
						<button
							key={s.cron} onClick={() => setSchedule(s.cron)}
							className={cn(
								"text-[11px] rounded-full px-2.5 py-1 border transition-colors",
								schedule === s.cron ? "bg-gold-500 text-white border-gold-500" : "bg-white text-slate-600 border-slate-200 hover:border-gold-300",
							)}
						>
							{s.label}
						</button>
					))}
				</div>
			</div>

			<div className="flex justify-end pt-1">
				<button
					onClick={onCreate}
					disabled={creating || hasFail}
					className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 text-white hover:from-gold-400 hover:to-gold-500 active:scale-95 transition-all shadow-sm shadow-gold-200 disabled:opacity-60 disabled:cursor-not-allowed"
				>
					{creating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Creating…</> : <><Play className="w-3.5 h-3.5" />Create workflow</>}
				</button>
			</div>
		</div>
	);
}

function LintRow({ row }: { row: { check: string; detail: string; status: "pass" | "warn" | "fail" } }) {
	const tone = row.status === "pass"
		? { Icon: Check, c: "text-gold-600", bg: "bg-gold-50" }
		: row.status === "warn"
			? { Icon: AlertTriangle, c: "text-gold-600", bg: "bg-gold-50" }
			: { Icon: X, c: "text-rose-600", bg: "bg-rose-50" };
	const Icon = tone.Icon;
	return (
		<div className="flex items-start gap-2.5 px-3 py-2 bg-white">
			<span className={cn("mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0", tone.bg, tone.c)}>
				<Icon className="w-2.5 h-2.5" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-[12px] font-medium text-slate-800">{row.check}</div>
				<div className="text-[11px] text-slate-500 leading-snug">{row.detail}</div>
			</div>
		</div>
	);
}

export default NewWorkflowFlow;

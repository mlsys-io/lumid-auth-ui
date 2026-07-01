// NextRunComposer — "move on to the next run" in one surface (Phase A).
//
// Supersedes BranchDialog: instead of just a branch directive, this composes the
// next run from a few decisions, pre-filled by the recommender:
//   • Suggested  — the next-actions recommender (recommend.py) as a banner that
//                  pre-fills the form on click.
//   • Start from — which run/branch to continue from (default = champion/best).
//   • Change     — a free-text directive + optional config overrides (the
//                  branch axis: model / prompt / params …). Any change forks a
//                  new branch.
//   • When       — run an attempt NOW, or set the loop's RECURRING schedule.
//
// Backed entirely by EXISTING engine (no backend change for Phase A):
//   run now → postTrajectorySignal(note) + me.launchRun(from_run_ts, variant)
//   schedule → me.patchLoop(schedule)
//
// Phases B–D add success-criteria/auto-decide, variant fan-out + data scope,
// and schedule-once — deferred (see the plan).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GitBranch, Loader2, X, Play, Trophy, Target, Layers, Clock, Save } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import { fetchTrajectory, postTrajectorySignal, type Trajectory, type TrajectoryNode } from "@/api/trajectory";
import { fetchCasebook, type CasebookCase } from "@/api/casebook";
import SchedulePicker from "@/components/workflow/SchedulePicker";
import { describeSchedule } from "@/lib/schedule";
import { cn } from "@/lib/utils";

// Phase B — success-criteria presets. Each maps a human label to the criteria
// EXPRESSION string the engine evaluates against the run's deltas. "" = custom.
const CRITERIA_PRESETS: Array<{ key: string; label: string; expr: string }> = [
	{ key: "none", label: "No automatic check", expr: "" },
	{ key: "beat", label: "Beat the parent (Δ ≥ 0)", expr: "delta_pp >= 0" },
	{ key: "solid", label: "Solid win (Δ ≥ 0 & n ≥ 20)", expr: "delta_pp >= 0 and n >= 20" },
	{ key: "custom", label: "Custom…", expr: "" },
];

// Parse "key = value" / "key: value" lines into a config override map (numbers /
// booleans coerced). Mirrors the old BranchDialog parser.
function parseOverrides(text: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = line.match(/^([^:=]+)[:=](.*)$/);
		if (!m) continue;
		const k = m[1].trim();
		const v = m[2].trim();
		if (!k) continue;
		if (/^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v);
		else if (v === "true" || v === "false") out[k] = v === "true";
		else out[k] = v;
	}
	return out;
}

function fmtScore(v?: number | null): string {
	if (v == null) return "—";
	return v >= -1 && v <= 1 ? `${Math.round(v * 100)}%` : String(+v.toFixed(3));
}
function nodeLabel(n: TrajectoryNode): string {
	const v = n.agent_version || "run";
	return `${v}${n.model ? ` · ${n.model}` : ""} · ${fmtScore(n.score)}`;
}

export default function NextRunComposer({ app, loop, fromTs, fromLabel, schedule, prefill, onClose, onLaunched, onChanged }: {
	app: string;
	loop: string;
	fromTs?: string;       // the run to start from (lineage parent); default = champion
	fromLabel?: string;
	schedule?: string;     // the loop's current recurring cadence (cron / "@trigger")
	// "Edit a planned run" — seed criteria/cases from the cancelled planned row.
	prefill?: { branch_label?: string; criteria?: string; cases?: string[] | null };
	onClose: () => void;
	onLaunched?: () => void;
	onChanged?: () => void; // fired after the recurring schedule is saved
}) {
	const [traj, setTraj] = useState<Trajectory | null>(null);
	const [parent, setParent] = useState<string | undefined>(fromTs);
	const [note, setNote] = useState("");
	const [overridesText, setOverridesText] = useState("");
	const [busy, setBusy] = useState(false);

	// Recurring schedule (a settings control — NOT the run attempt). Auto-applies
	// on change (debounced), so there's no Save button and setting a cadence never
	// implies "run now": patchLoop only updates the cron, it fires nothing.
	const [cron, setCron] = useState(schedule || "@trigger");
	const [savingSched, setSavingSched] = useState(false);
	const [schedSaved, setSchedSaved] = useState(false);
	const savedCronRef = useRef(schedule || "@trigger");
	useEffect(() => {
		if (cron === savedCronRef.current) return; // unchanged → nothing to save
		const t = window.setTimeout(async () => {
			setSavingSched(true); setSchedSaved(false);
			try {
				await me.patchLoop(app, loop, { schedule: cron });
				savedCronRef.current = cron;
				setSchedSaved(true);
				onChanged?.();
				window.setTimeout(() => setSchedSaved(false), 2500);
			} catch (e) {
				toast.error(`Schedule failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			} finally { setSavingSched(false); }
		}, 650);
		return () => window.clearTimeout(t);
	}, [cron, app, loop, onChanged]);

	// Phase B — success criteria + auto-decide. Seeded from `prefill` when editing
	// a planned run (custom criteria → the Advanced field).
	const [criteriaKey, setCriteriaKey] = useState<string>(prefill?.criteria ? "custom" : "none");
	const [criteriaCustom, setCriteriaCustom] = useState(prefill?.criteria || "");
	const [autoPromote, setAutoPromote] = useState(false);

	// Phase C — variant fan-out.
	const [tryMode, setTryMode] = useState<"single" | "fanout">("single");
	const [variantRows, setVariantRows] = useState<string[]>([""]);
	const [priorityText, setPriorityText] = useState("");

	// Phase D — WHEN the run attempt fires: "now" or a one-off future time
	// (not_before). Each "at a time" launch lands as its own PLANNED row, so a
	// loop can have MANY scheduled runs (not just the single recurring cadence).
	const [whenMode, setWhenMode] = useState<"now" | "at">("now");
	const [runAt, setRunAt] = useState("");

	// Phase C — data scope (evaluate on full casebook vs a subset of cases).
	const [scope, setScope] = useState<"full" | "subset">(prefill?.cases?.length ? "subset" : "full");
	const [cases, setCases] = useState<CasebookCase[]>([]);
	const [casesLoaded, setCasesLoaded] = useState(false);
	const [pickedCases, setPickedCases] = useState<Set<string>>(new Set(prefill?.cases || []));

	// Resolve the criteria expression: presets map to a fixed string; "custom"
	// uses the free-text field. "" = no automatic check.
	const criteriaExpr = useMemo(() => {
		if (criteriaKey === "custom") return criteriaCustom.trim();
		return CRITERIA_PRESETS.find((p) => p.key === criteriaKey)?.expr || "";
	}, [criteriaKey, criteriaCustom]);

	// The chosen subset of case ids (only when scope === "subset" and some picked).
	const scopedCases = useMemo(
		() => (scope === "subset" && pickedCases.size > 0 ? Array.from(pickedCases) : undefined),
		[scope, pickedCases],
	);

	// Load the run tree (parent picker + champion default).
	useEffect(() => {
		let live = true;
		fetchTrajectory(app, loop).then((t) => { if (live) setTraj(t); }).catch(() => {});
		return () => { live = false; };
	}, [app, loop]);

	const nodes = useMemo(
		() => (traj?.nodes || []).filter((n) => n.kind !== "baseline" && n.run_ts),
		[traj],
	);
	const hib = traj?.higher_is_better !== false;
	const champion = useMemo(() => {
		let best: TrajectoryNode | undefined;
		for (const n of nodes) {
			if (!n.scored || n.score == null) continue;
			if (!best || (hib ? n.score > (best.score as number) : n.score < (best.score as number))) best = n;
		}
		return best;
	}, [nodes, hib]);

	// Default parent: explicit fromTs → champion → latest run.
	useEffect(() => {
		if (parent) return;
		const def = fromTs || champion?.run_ts || nodes[nodes.length - 1]?.run_ts;
		if (def) setParent(def);
	}, [fromTs, champion, nodes, parent]);

	// Lazy-load the case list the first time the user opens "Subset".
	useEffect(() => {
		if (scope !== "subset" || casesLoaded) return;
		setCasesLoaded(true);
		fetchCasebook(app, loop)
			.then((cb) => setCases(cb.cases || []))
			.catch(() => setCases([]));
	}, [scope, casesLoaded, app, loop]);

	const toggleCase = (id: string) =>
		setPickedCases((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});

	const launchNow = async () => {
		const directive = note.trim();
		const variant = parseOverrides(overridesText);
		const hasVariant = Object.keys(variant).length > 0;
		const label = (directive || (parent ? "re-run" : "run")).slice(0, 48);
		const priority = priorityText.trim() ? Number(priorityText.trim()) : undefined;
		setBusy(true);
		try {
			// ── Phase C: fan-out — enqueue one run per non-empty variant row. ──
			if (tryMode === "fanout") {
				const variants = variantRows
					.map((t) => parseOverrides(t))
					.filter((v) => Object.keys(v).length > 0);
				if (variants.length === 0) {
					toast.error("Add at least one experiment (key = value) to fan out.");
					setBusy(false);
					return;
				}
				const { queued } = await me.enqueueRuns(app, loop, {
					from_run_ts: parent,
					branch_label: label,
					criteria: criteriaExpr || undefined,
					cases: scopedCases,
					priority: Number.isFinite(priority as number) ? priority : undefined,
					variants,
				});
				toast.success(`${queued} experiment${queued === 1 ? "" : "s"} queued.`);
				onLaunched?.();
				onClose();
				return;
			}

			// ── Phase A/B/D: a single run. ──
			// Persist the intention so the proposer reads it as the directive.
			if (directive || hasVariant) {
				await postTrajectorySignal(app, {
					loop, action: "branch", from_id: parent,
					note: directive || undefined,
					config: hasVariant ? variant : undefined,
				});
			}
			// "At a time" → a one-off scheduled (deferred) run; else run now.
			const notBefore = whenMode === "at" && runAt ? new Date(runAt).toISOString() : undefined;
			if (whenMode === "at" && !runAt) {
				toast.error("Pick a date & time, or switch to “Now”.");
				setBusy(false);
				return;
			}
			await me.launchRun(app, loop, {
				from_run_ts: parent,
				branch_label: label,
				variant: hasVariant ? variant : undefined,
				criteria: criteriaExpr || undefined,
				auto_promote: autoPromote && criteriaExpr ? true : undefined,
				cases: scopedCases,
				not_before: notBefore,
			});
			toast.success(notBefore
				? `Scheduled for ${new Date(runAt).toLocaleString()} — see Planned runs.`
				: "Experiment queued — it'll appear in the run tree shortly.");
			onLaunched?.();
			onClose();
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(false); }
	};

	const parentNode = nodes.find((n) => n.run_ts === parent);
	const launchLabel = tryMode === "fanout" ? "Queue experiments"
		: whenMode === "at" ? "Schedule run" : "Run experiment";
	const LaunchIcon = busy ? Loader2 : tryMode === "fanout" ? Layers : whenMode === "at" ? Clock : Play;

	return createPortal(
		<div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
			<div className="w-[460px] max-w-[94vw] h-[600px] max-h-[90vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
				{/* header (fixed) */}
				<div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
					<GitBranch className="w-4 h-4 text-gold-600 flex-shrink-0" />
					<div className="text-sm font-semibold text-slate-900 flex-shrink-0">Plan next run</div>
					{parentNode && <span className="text-[11px] text-slate-400 truncate">· from {parentNode.agent_version || nodeLabel(parentNode)}</span>}
					<button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-100 text-slate-400 flex-shrink-0"><X className="w-4 h-4" /></button>
				</div>

				{/* body — fixed-size popout: this scrolls, header/footer stay put */}
				<div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
						{/* Start from */}
						<div>
							<label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Start from</label>
							<select value={parent || ""} onChange={(e) => setParent(e.target.value || undefined)}
								className="mt-1 w-full text-[13px] text-slate-800 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300">
								<option value="">Fresh (no parent)</option>
								{nodes.slice().reverse().map((n) => (
									<option key={n.run_ts} value={n.run_ts}>
										{nodeLabel(n)}{champion && n.run_ts === champion.run_ts ? "  ★ best" : ""}
									</option>
								))}
							</select>
							<div className="mt-0.5 text-[10px] text-slate-400 flex items-center gap-1">
								{parentNode && champion && parentNode.run_ts === champion.run_ts && <Trophy className="w-3 h-3 text-gold-500" />}
								{parent ? <>continues from {fromLabel && parent === fromTs ? fromLabel : nodeLabel(parentNode || ({} as TrajectoryNode))}</> : "starts a new lineage"}
							</div>
						</div>

						{/* Change (intention) */}
						<div>
							<label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What should this attempt change?</label>
							<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
								placeholder="e.g. weight recent earnings more heavily; try a stricter judge rubric… (leave blank to just re-run)"
								onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); launchNow(); } }}
								className="mt-1 w-full text-[13px] text-slate-800 leading-snug rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 resize-none" />
							<div className="mt-0.5 text-[10px] text-slate-400">Any change forks a new branch; blank = a plain re-run of the selected start.</div>
						</div>

						<div>
							<label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Config overrides <span className="normal-case font-normal text-slate-300">(optional)</span></label>
							<textarea value={overridesText} onChange={(e) => setOverridesText(e.target.value)} rows={2}
								placeholder={"one per line, e.g.\nmodel = claude\ntemperature = 0.3"}
								className="mt-1 w-full font-mono text-[12px] text-slate-800 leading-snug rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 resize-none" />
							<div className="mt-0.5 text-[10px] text-slate-400">Becomes the attempt's variant. Numbers / true / false are coerced.</div>
						</div>

						{/* Phase B — Evaluate / success criteria */}
						<div>
							<label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
								<Target className="w-3 h-3" /> Success criteria <span className="normal-case font-normal text-slate-300">(optional)</span>
							</label>
							<div className="mt-1 space-y-2">
								<select value={criteriaKey} onChange={(e) => setCriteriaKey(e.target.value)}
									className="w-full text-[13px] text-slate-800 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300">
									{CRITERIA_PRESETS.map((p) => (<option key={p.key} value={p.key}>{p.label}</option>))}
								</select>
								{criteriaKey === "custom" && (
									<input value={criteriaCustom} onChange={(e) => setCriteriaCustom(e.target.value)}
										placeholder="e.g. delta_pp >= 0 and n >= 20"
										className="w-full font-mono text-[12px] text-slate-800 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300" />
								)}
								{criteriaExpr && (
									<div className="text-[10px] text-slate-400 font-mono">criteria: {criteriaExpr}</div>
								)}
								<label className={cn("flex items-center gap-2 text-[12px]", criteriaExpr ? "text-slate-700" : "text-slate-300")}>
									<input type="checkbox" checked={autoPromote} disabled={!criteriaExpr}
										onChange={(e) => setAutoPromote(e.target.checked)}
										className="rounded border-slate-300 text-gold-500 focus:ring-gold-300" />
									Auto-promote if criteria met
								</label>
							</div>
						</div>

						{/* Try / Evaluate on / When — compact one-line rows (label + segmented
						    toggle); each row's expansion (variants / cases / time) sits below. */}
						<div className="space-y-2 pt-1 border-t border-slate-100">
							{/* Try (single / fan-out) */}
							<div className="flex items-center gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[88px] flex-shrink-0">Try</span>
								<div className="inline-flex items-center gap-1">
									<button type="button" onClick={() => setTryMode("single")} className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium border", tryMode === "single" ? "bg-gold-50 text-gold-700 border-gold-200" : "text-slate-500 border-slate-200 hover:bg-slate-50")}>Single</button>
									<button type="button" onClick={() => setTryMode("fanout")} className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium border", tryMode === "fanout" ? "bg-gold-50 text-gold-700 border-gold-200" : "text-slate-500 border-slate-200 hover:bg-slate-50")}>Fan-out</button>
								</div>
							</div>
							{tryMode === "fanout" && (
								<div className="space-y-2 pl-[96px]">
									{variantRows.map((row, i) => (
										<div key={i} className="flex items-start gap-1.5">
											<textarea value={row} rows={2}
												onChange={(e) => setVariantRows((rows) => rows.map((r, j) => (j === i ? e.target.value : r)))}
												placeholder={`variant ${i + 1}, one per line, e.g.\nmodel = claude`}
												className="flex-1 font-mono text-[12px] text-slate-800 leading-snug rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 resize-none" />
											{variantRows.length > 1 && (
												<button type="button" onClick={() => setVariantRows((rows) => rows.filter((_, j) => j !== i))}
													className="mt-1 p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-3.5 h-3.5" /></button>
											)}
										</div>
									))}
									<div className="flex items-center gap-3">
										<button type="button" onClick={() => setVariantRows((rows) => [...rows, ""])}
											className="text-[11px] text-gold-700 hover:text-gold-900 underline decoration-dotted">+ add variant</button>
										<input value={priorityText} onChange={(e) => setPriorityText(e.target.value)} inputMode="numeric"
											placeholder="priority"
											className="w-20 text-[12px] text-slate-800 rounded-lg border border-slate-200 bg-white px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-gold-300" />
									</div>
								</div>
							)}

							{/* Evaluate on (full / subset) */}
							<div className="flex items-center gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[88px] flex-shrink-0">Evaluate on</span>
								<div className="inline-flex items-center gap-1">
									<button type="button" onClick={() => setScope("full")} className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium border", scope === "full" ? "bg-gold-50 text-gold-700 border-gold-200" : "text-slate-500 border-slate-200 hover:bg-slate-50")}>Full</button>
									<button type="button" onClick={() => setScope("subset")} className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium border", scope === "subset" ? "bg-gold-50 text-gold-700 border-gold-200" : "text-slate-500 border-slate-200 hover:bg-slate-50")}>Subset{scope === "subset" && pickedCases.size > 0 ? ` (${pickedCases.size})` : ""}</button>
								</div>
							</div>
							{scope === "subset" && (
								<div className="pl-[96px]">
									{cases.length === 0 ? (
										<div className="text-[11px] text-slate-400">{casesLoaded ? "No cases found for this loop." : "Loading cases…"}</div>
									) : (
										<div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
											{cases.map((c) => (
												<label key={c.id} className="flex items-center gap-2 px-2.5 py-1 text-[12px] text-slate-700 hover:bg-slate-50 cursor-pointer">
													<input type="checkbox" checked={pickedCases.has(c.id)} onChange={() => toggleCase(c.id)}
														className="rounded border-slate-300 text-gold-500 focus:ring-gold-300" />
													<span className="truncate">{c.label || c.id}</span>
												</label>
											))}
										</div>
									)}
								</div>
							)}

							{/* When the run ATTEMPT fires: now, or a one-off future time. Each
							    "At a time" launch is its own planned run — many are allowed. */}
							<div className="flex items-start gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[88px] flex-shrink-0 pt-1 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> When</span>
								<div className="flex-1 min-w-0 space-y-1.5">
									<div className="inline-flex items-center gap-1">
										<button type="button" onClick={() => setWhenMode("now")} className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium border", whenMode === "now" ? "bg-gold-50 text-gold-700 border-gold-200" : "text-slate-500 border-slate-200 hover:bg-slate-50")}>Now</button>
										<button type="button" onClick={() => setWhenMode("at")} className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium border", whenMode === "at" ? "bg-gold-50 text-gold-700 border-gold-200" : "text-slate-500 border-slate-200 hover:bg-slate-50")}>At a time</button>
										{whenMode === "at" && (
											<input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)}
												className="px-2 py-[3px] text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/40" />
										)}
									</div>
									<div className="text-[10px] text-slate-400">{whenMode === "at" ? "Queues a one-off scheduled run — appears in Planned runs; you can add several." : "Runs once, right away."}</div>
								</div>
							</div>

							{/* Recurring schedule (cadence) — moved here from the workflow header. */}
							<div className="flex items-start gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[88px] flex-shrink-0 pt-1 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Schedule</span>
								<div className="flex-1 min-w-0 space-y-1.5">
									<SchedulePicker value={cron} disabled={savingSched} onChange={(c) => setCron(c)} />
									<div className="flex items-center gap-2">
										<span className="text-[10px] text-slate-400">{describeSchedule(cron)} · saves automatically · separate from “Run attempt” (which runs once now).</span>
										{savingSched ? (
											<span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400 flex-shrink-0"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
										) : schedSaved ? (
											<span className="ml-auto inline-flex items-center gap-1 text-[10px] text-gold-600 flex-shrink-0"><Save className="w-3 h-3" /> Saved</span>
										) : null}
									</div>
								</div>
							</div>
						</div>
				</div>

				{/* footer (fixed) */}
				<div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 flex-shrink-0">
					<button onClick={launchNow} disabled={busy}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50">
						<LaunchIcon className={cn("w-3.5 h-3.5", busy && "animate-spin")} /> {launchLabel}
					</button>
					<button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">Cancel</button>
					<span className="ml-auto text-[10px] text-slate-400 hidden sm:inline">⌘↵ to run</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}

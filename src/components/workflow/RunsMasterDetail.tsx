// RunsMasterDetail — the Runs tab of the workflow page.
//
//   [ runs table (left) ] [ the selected run (right) ]
//
// Built because a reader could not get from an app to a run's steps (measured
// 2026-09-28 as a role=user reader): the run tree was a vertical v1…v22 chain in
// a narrow column, clicking a node showed nothing visible, the stage detail sat
// below the fold, and nothing below the workflow was in the URL. Here every row
// is a link to the run's own address, the run's steps are listed top-down on
// the right without scrolling, and the expanded step + its pane are in the URL
// (?step=<id>&pane=output|log) — see lib/run-routes.ts.
//
// Pure presentation: the host (WorkflowObservabilityPanel) owns the data calls
// (cycle list, cycle detail, trajectory) and the URL.

import { useContext, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext } from "@/hooks/useAuth";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, MoreHorizontal, RefreshCw, ScrollText, FileJson, Layers } from "lucide-react";
import type { MeCycleDetail, MeCycleListItem, MeCycleStep } from "@/api/me";
import AskAbout from "@/components/AskAbout";
import RunAnswerCard from "@/components/workflow/RunAnswerCard";
import { stepFailed, stepLabel, stepLine, humanMetric } from "@/lib/run-answer";
import StepInspectorPanel from "@/components/workflow/StepInspectorPanel";
import TrajectoryLogView from "@/components/workflow/TrajectoryLogView";
import RunChildren from "@/components/workflow/RunChildren";
import { RunCompareView } from "@/components/workflow/BranchTreeView";
import { cycleStatus, runStatus, runStatusTitle, RUN_STATUS_LABEL, RUN_STATUS_TONE, RUN_STATUSES, type RunStatus, type RunStatusInfo } from "@/lib/runStatus";
import { runPath, type RunPane } from "@/lib/run-routes";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";

// ── time ──────────────────────────────────────────────────────────────────
/** Cycle-dir id "20260928T075005Z" → Date (null when it is not one). */
export function runDate(ts?: string | null): Date | null {
	const m = String(ts || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
	if (!m) return null;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}
export function runLocalTime(ts?: string | null): string {
	const d = runDate(ts);
	return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : String(ts || "");
}
export function runAgo(ts?: string | null): string {
	const d = runDate(ts);
	if (!d) return "";
	const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
	if (s < 90) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}
export function fmtDur(s?: number | null): string {
	if (s == null || !Number.isFinite(s)) return "—";
	if (s < 1) return `${Math.round(s * 1000)}ms`;
	if (s < 90) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
	const m = Math.floor(s / 60), r = Math.round(s % 60);
	if (m < 60) return `${m}m ${r}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtNum(v: number): string {
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
}

// ── status chip ───────────────────────────────────────────────────────────
export function RunStatusChip({ info, className, compact }: { info: RunStatusInfo; className?: string; compact?: boolean }) {
	const t = TONES[RUN_STATUS_TONE[info.status]];
	if (compact) {
		return (
			<span title={runStatusTitle(info)} className={cn("inline-flex items-center gap-1 text-micro font-medium whitespace-nowrap", t.text, className)}>
				<span className={cn("w-1.5 h-1.5 rounded-full", t.dot, info.status === "running" && "running-pulse")} />
				{RUN_STATUS_LABEL[info.status]}
			</span>
		);
	}
	return (
		<span title={runStatusTitle(info)}
			className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-micro font-medium whitespace-nowrap", t.bg, t.text, t.border, className)}>
			<span className={cn("w-1.5 h-1.5 rounded-full", t.dot, info.status === "running" && "running-pulse")} />
			{RUN_STATUS_LABEL[info.status]}{info.recovered ? " · recovered" : ""}
		</span>
	);
}

// ── runs table ────────────────────────────────────────────────────────────
export type RunRow = MeCycleListItem & { trigger?: string };

export function RunsTable({
	app, loop, cycles, scores, metricName, scoresError, scoresLoading, selectedId, outcome, arm, sortAsc,
	onFilter, carryQuery,
}: {
	app: string; loop: string;
	cycles: RunRow[] | null;
	/** cycle-dir id → the run's metric value (trajectory score / key_metric). */
	scores: Record<string, number>;
	metricName?: string;
	/** Why the score map is unavailable — set when the trajectory fetch FAILED. */
	scoresError?: string | null;
	/** The score map is still in flight (trajectory not back yet). */
	scoresLoading?: boolean;
	selectedId: string | null;
	outcome: RunStatus | "";
	arm: string;
	sortAsc: boolean;
	onFilter: (patch: { outcome?: string | null; arm?: string | null; sort?: string | null }) => void;
	/** Query params every row link carries so the table keeps its filters. */
	carryQuery: Record<string, string | undefined>;
}) {
	const navigate = useNavigate();
	const arms = useMemo(() => [...new Set((cycles || []).map((c) => c.branch_label).filter(Boolean) as string[])].sort(), [cycles]);
	const hasTrigger = (cycles || []).some((c) => c.trigger);
	const rows = useMemo(() => {
		const list = (cycles || []).filter((c) =>
			(!outcome || cycleStatus(c).status === outcome) && (!arm || c.branch_label === arm));
		list.sort((a, b) => (sortAsc ? 1 : -1) * (a.ts || "").localeCompare(b.ts || ""));
		return list;
	}, [cycles, outcome, arm, sortAsc]);

	const metricOf = (c: RunRow): number | undefined => {
		if (scores[c.ts] != null) return scores[c.ts];
		const km = c.key_metric;
		if (typeof km === "number") return km;
		if (km && typeof km === "object" && typeof km.value === "number") return km.value;
		return undefined;
	};

	// The Metric cell used one label — `no metric` — for three different
	// situations, and only one of them means the run was not measured:
	//
	//   · the score map did not load  → the platform may well have a value
	//   · the score map has no entry  → the run genuinely was not scored
	//   · it loaded and has the value → render it
	//
	// Reporting the first as the second is what made a working core test read
	// as unmeasured. Each state now names itself, and every one carries the
	// declared metric name in its tooltip.
	const metricCell = (c: RunRow, mv: number | undefined) => {
		// The row's own record outranks the loop-level name: when the run
		// stored `primary_metric`, that name is the one it was measured on.
		const km = c.key_metric;
		const rowName = km && typeof km === "object" && typeof km.name === "string" ? km.name : undefined;
		const named = rowName || metricName;
		const namedHint = named ? ` (${named})` : "";
		if (mv != null) {
			return (
				<span className="text-ink-800 font-medium" title={named ? `${named}: ${fmtNum(mv)}` : undefined}>
					{fmtNum(mv)}
				</span>
			);
		}
		// A failed run has no score because it failed — "not scored" beside
		// "Failed" read as a second, unexplained problem. A dash, and the why
		// is on the run's own page.
		if (c.ok === false) return <span className="text-nano text-ink-600" title="Failed runs aren't scored — open the run for the reason">—</span>;
		if (scoresLoading) {
			return <span className="text-nano text-ink-600" title={`Reading the run tree for the declared metric${namedHint}…`}>…</span>;
		}
		if (scoresError) {
			return (
				<span className="text-nano text-ember-600" title={`Couldn't load the run tree — ${scoresError}. This does not mean the run went unmeasured; reload to retry.`}>
					unavailable
				</span>
			);
		}
		return (
			<span className="text-nano text-ink-600" title={named ? `This run recorded no ${named} value.` : "This run recorded no metric value."}>
				not scored
			</span>
		);
	};
	// The column says WHAT it measures: "Goodput (tok/s)", not "Metric".
	const metricHead = (() => {
		if (!metricName) return "Metric";
		const { label, unit } = humanMetric(metricName);
		return unit ? `${label} (${unit})` : label;
	})();

	return (
		<div className="flex flex-col min-h-0 h-full rounded-xl border border-ink-200 bg-card overflow-hidden">
			<div className="flex items-center gap-2 px-3 py-2 border-b border-ink-100 flex-wrap">
				<h3 className="text-caption font-semibold text-ink-800">Runs</h3>
				<span className="text-micro text-ink-600 tabular-nums">{cycles ? `${rows.length}${rows.length !== cycles.length ? ` of ${cycles.length}` : ""}` : ""}</span>
				<label className="ml-auto inline-flex items-center gap-1 text-micro text-ink-600">
					<span className="sr-only">Filter by outcome</span>
					<select value={outcome} onChange={(e) => onFilter({ outcome: e.target.value || null })}
						className="text-micro bg-card border border-ink-200 rounded-md px-1 py-0.5 text-ink-700">
						<option value="">All outcomes</option>
						{RUN_STATUSES.map((s) => <option key={s} value={s}>{RUN_STATUS_LABEL[s]}</option>)}
					</select>
				</label>
				{arms.length > 0 && (
					<label className="inline-flex items-center gap-1 text-micro text-ink-600">
						<span className="sr-only">Filter by experiment</span>
						<select value={arm} onChange={(e) => onFilter({ arm: e.target.value || null })}
							className="text-micro bg-card border border-ink-200 rounded-md px-1 py-0.5 text-ink-700 max-w-[120px]">
							<option value="">All experiments</option>
							{arms.map((a) => <option key={a} value={a}>{a}</option>)}
							{arm && !arms.includes(arm) && <option value={arm}>{arm}</option>}
						</select>
					</label>
				)}
			</div>
			<div className="flex-1 min-h-0 overflow-auto">
				{cycles === null ? (
					<div className="flex items-center gap-2 text-micro text-ink-600 p-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading runs…</div>
				) : rows.length === 0 ? (
					<div className="text-micro text-ink-600 p-3">
						{cycles.length === 0 ? "No runs yet — run the workflow and its runs appear here." : "No runs match these filters."}
					</div>
				) : (
					<table className="w-full text-micro">
						<thead className="sticky top-0 bg-ink-50 z-10">
							<tr className="text-left text-ink-600 border-b border-ink-100">
								<th className="px-2 py-1.5 font-medium">
									<button type="button" onClick={() => onFilter({ sort: sortAsc ? null : "asc" })}
										className="inline-flex items-center gap-0.5 hover:text-ink-800" title="Sort by time">
										When {sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
									</button>
								</th>
								<th className="px-1 py-1.5 font-medium">Outcome</th>
								<th className="px-1 py-1.5 font-medium text-right" title="Duration">Dur.</th>
								<th className="px-1 py-1.5 font-medium text-right max-w-[7rem] truncate" title={metricName ? `metric: ${metricName}` : undefined}>{metricHead}</th>
								<th className="px-1 py-1.5 font-medium">Experiment</th>
								{hasTrigger && <th className="px-1 py-1.5 font-medium">Trigger</th>}
							</tr>
						</thead>
						<tbody>
							{rows.map((c) => {
								const href = runPath(app, loop, c.ts, carryQuery);
								const sel = c.ts === selectedId;
								const mv = metricOf(c);
								return (
									<tr key={c.ts}
										onClick={(e) => { if ((e.target as HTMLElement).closest("a")) return; navigate(href); }}
										aria-selected={sel}
										className={cn("border-b border-ink-50 cursor-pointer transition-colors", sel ? "bg-gold-50/70" : "hover:bg-ink-50")}>
										<td className="px-2 py-1.5 whitespace-nowrap">
											<Link to={href} className={cn("block hover:underline", sel ? "text-ink-900 font-medium" : "text-ink-700")}
												aria-current={sel ? "page" : undefined}>
												{runLocalTime(c.ts)}
											</Link>
											<span className="block text-nano text-ink-600">{runAgo(c.ts)}</span>
										</td>
										<td className="px-1 py-1.5"><RunStatusChip info={cycleStatus(c)} compact /></td>
										<td className="px-1 py-1.5 text-right tabular-nums text-ink-600 whitespace-nowrap">{fmtDur(c.duration_s)}</td>
										<td className="px-1 py-1.5 text-right tabular-nums whitespace-nowrap">
											{metricCell(c, mv)}
										</td>
										<td className="px-1 py-1.5 text-ink-600 font-mono" title={c.branch_label || undefined}><span className="block truncate max-w-[64px]">{c.branch_label || ""}</span></td>
										{hasTrigger && <td className="px-1 py-1.5 text-ink-600">{c.trigger || ""}</td>}
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

// ── the selected run ──────────────────────────────────────────────────────
/** One line that says what a step did, from whatever the step recorded. */
export function stepSummary(st: MeCycleStep): string {
	if (st.error) return String(st.error).split("\n")[0].slice(0, 160);
	if (st.output_summary) return st.output_summary.slice(0, 160);
	const out = st.output;
	if (out && typeof out === "object") {
		const keys = Object.keys(out);
		if (keys.length) return `output: ${keys.slice(0, 5).join(" · ")}${keys.length > 5 ? ` +${keys.length - 5}` : ""}`;
	}
	return st.ok === false ? "failed — no error recorded" : "no output recorded";
}


export function RunDetail({
	app, loop, runId, detail, loading, listRow, cycles, step, pane, compare,
	onQuery, onRerun, menu, renderStages,
}: {
	app: string; loop: string;
	runId: string | null;
	detail: MeCycleDetail | null;
	loading: boolean;
	listRow?: RunRow | null;
	cycles: RunRow[];
	step: string | null;
	pane: RunPane;
	compare: string | null;
	/** Patch the URL query of the run page (null deletes a key). */
	onQuery: (patch: Record<string, string | null>) => void;
	onRerun: () => void;
	/** Opens RunContextMenu ("Change this run") at a screen point. */
	menu: (x: number, y: number) => void;
	/** The five-stage view of this run (StageDetail, owned by the host). */
	renderStages?: (runId: string) => React.ReactNode;
}) {
	const authRole = useContext(AuthContext)?.user?.role;
	const isAdminRole = authRole === 'admin' || authRole === 'super_admin';
	const [showStages, setShowStages] = useState(false);
	if (!runId) {
		return (
			<div className="rounded-xl border border-ink-200 bg-card p-4 text-caption text-ink-600">
				{cycles.length === 0 ? "This workflow has no runs yet." : "Pick a run on the left."}
			</div>
		);
	}
	const info = detail?.running || listRow?.running
		? runStatus("running")
		: cycleStatus({ ok: detail?.ok ?? listRow?.ok, running: false });
	const failed = info.status === "failed";
	const steps = detail?.steps || [];
	const duration = listRow?.duration_s ?? (typeof detail?.summary?.duration_s === "number" ? detail.summary.duration_s as number : undefined);
	// Which step is open. The URL wins (?step=<id>, or ?step=none after a
	// collapse); otherwise see defaultStep below.
	const stepIdOf = (st: MeCycleStep, i: number) => st.step_id || st.skill || `step ${i + 1}`;
	// The answer card now says what the run did / why it failed, so a lone
	// step no longer auto-opens its raw JSON; a FAILED step among several
	// still opens, since which one broke is the next question.
	const defaultStep = steps.length > 1
		? (() => { const i = steps.findIndex((x) => stepFailed(x)); return i >= 0 ? stepIdOf(steps[i], i) : null; })()
		: null;
	const openStep = step === "none" ? null : (step ?? defaultStep);

	return (
		<div className="rounded-xl border border-ink-200 bg-card flex flex-col min-w-0">
			{/* HEADER — outcome · time · duration · arm. */}
			<div className="px-3 pt-3 pb-2 border-b border-ink-100 space-y-2">
				<div className="flex items-center gap-2 flex-wrap">
					<RunStatusChip info={info} />
					<h2 className="text-body font-semibold text-ink-900">Run · {runLocalTime(runId)}</h2>
					<span className="text-micro text-ink-600">{runAgo(runId)}</span>
					<span className="text-micro text-ink-600 tabular-nums" title="duration">· {fmtDur(duration)}</span>
					{listRow?.branch_label && (
						<span className="text-micro font-mono text-ink-600 bg-ink-50 border border-ink-200 rounded px-1.5" title="the version this run tried">version {listRow.branch_label}</span>
					)}
					<span className="ml-auto text-nano font-mono text-ink-600" title="run id (cycle dir)">{runId}</span>
				</div>
				{/* ACTIONS — visible, not hidden in a node menu. State-changing
				    Promote / Discard stay behind RunContextMenu's two-step confirm. */}
				<div className="flex items-center gap-1.5 flex-wrap">
					<button type="button" onClick={onRerun}
						className="inline-flex items-center gap-1 px-2 py-1 text-micro rounded-lg border border-gold-300 bg-gold-50 text-gold-800 hover:bg-gold-100"
						title="Plan a new run starting from this one (nothing starts until you confirm)">
						<RefreshCw className="w-3 h-3" /> Re-run…
					</button>
					<AskAbout
						label="Ask about this run"
						prompt={failed
							? `Why did the ${loop} run of ${runLocalTime(runId)} fail, and how do I fix it?`
							: `Explain what the ${loop} run of ${runLocalTime(runId)} did and what it found.`}
						context={{ app, loop, cycle: { app, loop, ts: runId } }}
						className="py-1"
					/>
					<button type="button"
						onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); menu(r.left, r.bottom + 4); }}
						className="ml-auto inline-flex items-center px-1.5 py-1 text-micro rounded-lg border border-ink-200 bg-card text-ink-600 hover:bg-ink-50"
						aria-label="More: compare, promote, discard, branch"
						title="Compare with another run, promote, discard, branch — each confirmed">
						<MoreHorizontal className="w-3.5 h-3.5" />
					</button>
				</div>
				{/* THE ANSWER — did it work, what did it find, or why not; the raw
				    error one click away. Replaces the "Outcome: <snake_case>" strip
				    and the generic failure card. */}
				<RunAnswerCard app={app} loop={loop} runId={runId} detail={detail} listRow={listRow} cycles={cycles} durationS={duration} />
			</div>

			{/* BODY — compare, the run log, or the step timeline. */}
			{compare ? (
				<div className="p-2 h-[560px]">
					<RunCompareView app={app} loop={loop} tsA={runId} tsB={compare} onBack={() => onQuery({ compare: null })} />
				</div>
			) : pane === "log" && !openStep ? (
				<div className="p-2 h-[520px]">
					<TrajectoryLogView app={app} loop={loop} ts={runId} onBack={() => onQuery({ pane: null })} backLabel="Steps" />
				</div>
			) : (
				<div className="p-2">
					<div className="flex items-center gap-2 px-1 pb-1.5">
						<h3 className="text-micro uppercase tracking-wide font-semibold text-ink-600">Steps</h3>
						<span className="text-micro text-ink-600">{steps.length ? `${steps.length} recorded` : ""}</span>
						<button type="button" onClick={() => onQuery({ pane: "log", step: "none" })}
							className="ml-auto inline-flex items-center gap-1 text-micro text-ink-600 hover:text-ink-900">
							<ScrollText className="w-3 h-3" /> Run log
						</button>
					</div>
					{loading && !detail ? (
						<div className="flex items-center gap-2 text-micro text-ink-600 px-1 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the run…</div>
					) : steps.length === 0 ? (
						<div className="text-micro text-ink-600 px-1 py-1">
							{/* The scheduler's reason ("app not installed for this user") is
							    an operator detail: keep it in the tooltip, say it plainly. */}
							<span title={detail?.unavailable || undefined}>Step details aren't available for this run.</span> The <button type="button" className="underline" onClick={() => onQuery({ pane: "log", step: "none" })}>run log</button> has what it said.
						</div>
					) : (
						<ol className="space-y-1">
							{steps.map((st, i) => {
								const id = stepIdOf(st, i);
								const open = openStep === id;
								const sInfo = stepFailed(st) ? runStatus("failed") : runStatus("succeeded");
								const line = stepLine(st);
								return (
									<li key={`${id}-${i}`} className={cn("rounded-lg border", open ? "border-gold-300" : "border-ink-200")}>
										<button type="button" aria-expanded={open}
											onClick={() => onQuery(open ? { step: "none", pane: null } : { step: id, pane: "output" })}
											className="w-full text-left flex items-center gap-2 px-2 py-1.5 hover:bg-ink-50 rounded-lg">
											{open ? <ChevronDown className="w-3.5 h-3.5 text-ink-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-600 flex-shrink-0" />}
											<span className="text-nano text-ink-600 tabular-nums w-4 text-right flex-shrink-0">{i + 1}</span>
											<span className="text-caption font-medium text-ink-900 flex-shrink-0" title={id}>{stepLabel(st)}</span>
											<RunStatusChip info={sInfo} className="flex-shrink-0" />
											{st.duration_s != null && <span className="text-micro text-ink-600 tabular-nums flex-shrink-0">{fmtDur(st.duration_s)}</span>}
											<span className={cn("text-micro truncate min-w-0", stepFailed(st) ? "text-brick-700" : "text-ink-600")}>{line}</span>
										</button>
										{open && (
											<div className="px-2 pb-2 space-y-1.5">
												<div role="tablist" aria-label="Step pane" className="flex items-center gap-1">
													<button type="button" role="tab" aria-selected={pane !== "log"} onClick={() => onQuery({ pane: "output" })}
														className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-micro", pane !== "log" ? "bg-ink-800 text-white" : "text-ink-600 hover:bg-ink-100")}>
														<FileJson className="w-3 h-3" /> Output
													</button>
													<button type="button" role="tab" aria-selected={pane === "log"} onClick={() => onQuery({ pane: "log" })}
														className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-micro", pane === "log" ? "bg-ink-800 text-white" : "text-ink-600 hover:bg-ink-100")}>
														<ScrollText className="w-3 h-3" /> Log
													</button>
												</div>
												{pane === "log" ? (
													<div className="h-[420px]">
														<TrajectoryLogView app={app} loop={loop} ts={runId} onBack={() => onQuery({ pane: "output" })} backLabel="Output" />
													</div>
												) : (
													<StepInspectorPanel
														step={{ step_id: id, skill: st.skill && st.skill !== id ? st.skill : undefined, cycleStep: st }}
														app={app} loop={loop} ts={runId}
														defaultShowOutput closeLabel="Collapse step" embedded
														onClose={() => onQuery({ step: "none", pane: null })}
													/>
												)}
											</div>
										)}
									</li>
								);
							})}
						</ol>
					)}
					{/* The fleet jobs this run launched → their FlowMesh workflows.
					    Renders nothing when the run recorded none. */}
					<RunChildren jobs={detail?.compute_jobs} />
					{/* The five-stage view (observe → learn) of the same run — what
					    the run SENSED / PROPOSED / LEARNED, for runs whose substance
					    lives in the cycle summary rather than in step outputs. */}
					{renderStages && isAdminRole && <button type="button" onClick={() => setShowStages((v) => !v)}
						className="mt-2 inline-flex items-center gap-1 text-micro text-ink-600 hover:text-ink-800 px-1">
						<Layers className="w-3 h-3" /> {showStages ? "Hide" : "Show"} by stage (observe → learn)
					</button>}
					{showStages && renderStages && <div className="mt-1.5">{renderStages(runId)}</div>}
				</div>
			)}
		</div>
	);
}

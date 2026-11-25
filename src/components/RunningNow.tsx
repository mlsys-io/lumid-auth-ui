// RunningNow — THE running panel, the same on every Studio page that has the
// docked chat (app workspace, Data, Compute): Novix's live-work column, in
// Lumid's words. Top to bottom:
//
//   ⌄ Running                          [2]   (machines in the tooltip)
//   ┌ 21:09   17 min ago ┐ ┌ 21:12  3 min ago ┐
//   │ Backtest · Quant…  │ │ lumid-data job   │   ← tiles, 2 per row
//   │ backtesting…       │ │ Running…         │
//   │ ▮▮▮▮▮▯▯▯▯▯▯▯       │ │ ▮▮▯▯▯▯▯▯▯▯▯▯     │
//   └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘   ← dashed = free slots;
//                                                  the first says what starts next
//   ⌄ Done                             [12]
//   ▪ Backtest                                   (bordered rows; failed says so)
//
// Global: every app's runs (the current app's first), plus lum.id/data jobs.
// Sources: runs feed + SSE (useRunsFeed), data jobs (15 s poll), the app's
// queue on app pages (GET /me/apps/:app/queue), machines (GET /me/compute).
// A source that isn't there is left out, never faked.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { me } from "@/api/me";
import { WorkingDots, useLastRunSteps } from "@/components/activity/ActivityView";
import { appTitle } from "@/components/workflow/AppCard";
import { estimateSteps, type StepEstimate } from "@/lib/run-timeline";
import { runRowHref } from "@/lib/run-routes";
import { useCollapse } from "@/hooks/useCollapse";
import { useNowSec, useRunsFeed } from "@/components/activity/hooks";
import { fmtAgo, fmtDuration, fmtTypical, groupActivity, isOverdue, loopOfRun, progressOf, type RunningItem } from "@/lib/activity";
import { capacityRows, machinesLine, queueItems, versionLabel, type ComputeCapacity, type QueueRow } from "@/lib/compute";
import { runPath } from "@/lib/run-routes";
import { loopLabel } from "@/lib/workflow-names";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { dataJobs } from "@/api/dataJobs";
import { jobElapsedS, jobStatusLabel, type Job } from "@/lib/data-jobs";

const FEED_DAYS = 1;
const SHOW_DONE = 5;
const JOBS_POLL_MS = 15_000;
const ACTIVE_JOB = new Set(["planned", "submitted", "running"]);

function useActiveJobs(enabled: boolean): Job[] {
	const [jobs, setJobs] = useState<Job[]>([]);
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		const load = async () => {
			if (document.visibilityState === "hidden") return;
			try {
				const r = await dataJobs.jobs({ limit: 30 });
				if (live) setJobs((r.jobs ?? []).filter((j) => ACTIVE_JOB.has(j.status)));
			} catch {
				// Not reachable or not signed in for /data: show nothing rather than an
				// error in a corner of someone else's page.
				if (live) setJobs([]);
			}
		};
		load();
		const id = window.setInterval(load, JOBS_POLL_MS);
		return () => {
			live = false;
			window.clearInterval(id);
		};
	}, [enabled]);
	return jobs;
}

function JobTile({ job, now }: { job: Job; now: number }) {
	const elapsed = jobElapsedS(job, now);
	const running = job.status === "running";
	const where = [job.runtime, job.site ? `at ${job.site}` : ""].filter(Boolean).join(" ");
	const startedAt = job.started_at ? Date.parse(String(job.started_at)) / 1000 : now - elapsed;
	return (
		<Tile
			to={`/studio/data-warehouse?tab=jobs&job=${encodeURIComponent(job.job_id)}`}
			label={`Data job ${job.name || job.app}: ${jobStatusLabel(job.status)}, ${fmtDuration(elapsed)}`}
			startedAt={startedAt} now={now} live={running}
			title={<>{job.name || job.app || "Data job"}<span className="text-ink-600 font-normal"> · data job</span></>}
			action={<><span className={running ? "lumen-shine" : ""}>{jobStatusLabel(job.status)}{where ? ` ${where}` : ""}</span>{running && <WorkingDots />}</>}
			cells={<ProgressCells p={null} elapsed={elapsed} late={false} />}
		/>
	);
}

// ── Tiles ────────────────────────────────────────────────────────────────
// Novix's running tile: start time + how long ago, a two-line title, the
// current action in italics (shining while live), and a strip of cells.

const CELLS = 24;
const hhmm = (sec: number) => new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
function minsAgo(sec: number, now: number): string {
	const m = Math.max(0, Math.round((now - sec) / 60));
	return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

function Tile({ to, label, startedAt, now, live, title, action, cells, late }: {
	to: string; label: string; startedAt: number; now: number; live: boolean;
	title: React.ReactNode; action: React.ReactNode; cells: React.ReactNode; late?: boolean;
}) {
	return (
		<Link to={to} aria-label={label} data-tile="run"
			className={cn("group flex h-[92px] min-w-0 flex-col rounded-lg border bg-card px-2.5 pb-2 pt-1.5 shadow-e1 animate-lumen-rise transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-e2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
				late ? "border-ember-200" : "border-ink-200 hover:border-lagoon-300")}>
			<div className="flex items-center gap-1.5 font-mono text-nano tabular-nums text-ink-600">
				<span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", late ? "bg-ember-500" : "bg-lagoon-500", live && "animate-lumen-breathe")} aria-hidden />
				<span className="text-ink-800">{hhmm(startedAt)}</span>
				<span className="ml-auto truncate">{minsAgo(startedAt, now)}</span>
			</div>
			<div className="mt-0.5 line-clamp-2 text-caption font-medium leading-snug text-ink-900">{title}</div>
			<div className="mt-0.5 truncate text-micro italic text-ink-600">{action}</div>
			<div className="mt-auto">{cells}</div>
		</Link>
	);
}

/** How far through its usual time, as cells: done, the current one breathing, the rest waiting.
 *  Without a usual time, one cell per minute so far. */
function ProgressCells({ p, elapsed, late }: { p: number | null; elapsed: number; late: boolean }) {
	const done = p != null ? Math.min(CELLS - 1, Math.floor(p * CELLS)) : Math.min(CELLS - 1, Math.floor(elapsed / 60));
	const tip = p != null ? `About ${Math.round(Math.min(1, p) * 100)}% of its usual time` : "One cell per minute so far";
	return (
		<div className="grid grid-cols-12 gap-[2px]" title={tip} aria-hidden>
			{Array.from({ length: CELLS }, (_, i) => (
				<span key={i} className={cn("h-[5px] rounded-[1px]",
					i < done ? (late ? "bg-ember-200" : i % 3 === 1 ? "bg-lagoon-200" : "bg-lagoon-300")
						: i === done ? (late ? "bg-ember-500 animate-lumen-breathe" : "bg-lagoon-500 animate-lumen-breathe")
							: "bg-ink-100")} />
			))}
		</div>
	);
}

/** The steps the last run took, as cells (when we have them). */
function StepCells({ est }: { est: StepEstimate }) {
	const steps = est.steps.slice(0, CELLS);
	return (
		<div className="grid grid-cols-12 gap-[2px]" aria-hidden>
			{steps.map((st, i) => (
				<span key={i} title={`${st.stage ? st.stage + " · " : ""}${st.name}`}
					className={cn("h-[5px] rounded-[1px]", st.state === "done" ? "bg-lagoon-300" : st.state === "now" ? "bg-lagoon-500 animate-lumen-breathe" : "bg-ink-100")} />
			))}
		</div>
	);
}

function RunTile({ item, now, showApp }: { item: RunningItem; now: number; showApp: boolean }) {
	const { run, wf } = item;
	const startedAt = run.started_at || now;
	const elapsed = Math.max(0, now - startedAt);
	const p = progressOf(elapsed, wf.typicalS);
	const late = isOverdue(elapsed, wf.typicalS);
	const tpl = useLastRunSteps(wf);
	const est = tpl ? estimateSteps(tpl, elapsed, wf.loop) : null;
	const wfName = loopLabel(wf.name, wf.loop);
	const doing = est?.now && !est.beyond ? est.now.name : "Running";
	return (
		<Tile to={runRowHref(run.run_id)} startedAt={startedAt} now={now} live late={late}
			label={`${showApp ? appTitle(wf.app) + ", " : ""}${wfName} — running for ${fmtDuration(elapsed)}`}
			title={<>{wfName}{showApp && <span className="font-normal text-ink-600"> · {appTitle(wf.app)}</span>}</>}
			action={late
				? <span className="not-italic text-ember-700">Longer than usual{wf.typicalS ? ` (${fmtTypical(wf.typicalS)})` : ""}</span>
				: <><span className="lumen-shine">{doing}</span><WorkingDots /></>}
			cells={est ? <StepCells est={est} /> : <ProgressCells p={p} elapsed={elapsed} late={late} />}
		/>
	);
}

function Heading({ label, count, collapsed, onToggle, title }: { label: string; count: number; collapsed: boolean; onToggle: () => void; title?: string }) {
	return (
		<button type="button" onClick={onToggle} aria-expanded={!collapsed} title={title}
			className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-meta text-ink-600 transition-colors hover:text-ink-900">
			<ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", collapsed && "-rotate-90")} aria-hidden />
			<span>{label}</span>
			<span className="ml-auto min-w-[1.25rem] rounded bg-muted px-1 text-center font-mono text-nano tabular-nums text-ink-600">{count}</span>
		</button>
	);
}

function usePoll<T>(fn: () => Promise<T>, everyMs: number, key: string, enabled = true): T | null {
	const [data, setData] = useState<T | null>(null);
	useEffect(() => {
		if (!enabled) { setData(null); return; }
		let live = true;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tick = async () => {
			if (!document.hidden) { try { const d = await fn(); if (live) setData(d); } catch { /* left out */ } }
			if (live) timer = setTimeout(tick, everyMs);
		};
		tick();
		return () => { live = false; if (timer) clearTimeout(timer); };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, everyMs, enabled]);
	return data;
}

const appName = (a?: string) => (a || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function RunningNow({ app, runs = true, jobs = true }: { app?: string; runs?: boolean; jobs?: boolean }) {
	const feed = useRunsFeed(FEED_DAYS);
	// Every app's running runs, the current app's first.
	const running = useMemo(() => {
		if (!runs || !feed.runs) return [];
		const all = groupActivity(feed.runs, {}).running;
		return app ? [...all.filter((it) => it.run.app === app), ...all.filter((it) => it.run.app !== app)] : all;
	}, [runs, feed.runs, app]);
	const activeJobs = useActiveJobs(jobs);
	const queue = usePoll(() => me.appQueue(app!), 10_000, `q:${app}`, !!app);
	const cap = usePoll(() => me.computeSummary(), 30_000, "compute");
	const total = running.length + activeJobs.length;
	const now = useNowSec(total > 0);
	const allHref = "/studio/runs";
	const [runCollapsed, toggleRun] = useCollapse("studio-rail:running", false);
	const [doneCollapsed, toggleDone] = useCollapse("studio-rail:done", false);

	// Nothing loaded yet: render nothing, so the rail doesn't flash a state the
	// first answer immediately contradicts.
	if (runs && feed.runs === null && activeJobs.length === 0) return null;

	// Tiles only for what is running (≤4; more → a "+N" tile). An odd count
	// fills its last cell with the free slot; otherwise the slot is one slim line.
	const room = 4;
	const overflow = total > room;
	const fit = overflow ? room - 1 : room;
	const shownRuns = running.slice(0, fit);
	const shownJobs = activeJobs.slice(0, Math.max(0, fit - shownRuns.length));
	const more = total - shownRuns.length - shownJobs.length;
	const cells = shownRuns.length + shownJobs.length + (overflow ? 1 : 0);
	const slotInGrid = cells % 2 === 1;
	const next = queue ? queueItems(queue.rows as QueueRow[]).waiting : [];
	const finished = (feed.runs || []).filter((r) => r.state === "succeeded" || r.state === "failed")
		.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
	const done = finished.slice(0, SHOW_DONE);
	const machines = cap ? capacityRows(cap.capacity as ComputeCapacity[]) : [];
	const mLine = machinesLine(machines);
	const slotText = next[0]
		? <><span className="text-ink-600">Starts next{next.length > 1 ? ` (+${next.length - 1})` : ""}: </span><span className="font-medium text-ink-800">{loopLabel("", next[0].loop)}{next[0].version ? ` · ${versionLabel(next[0].version)}` : ""}</span></>
		: <span className="text-ink-600">{total ? "Nothing waiting — the next run starts here." : "Nothing running — runs start here."}</span>;

	return (
		<section aria-label="Running now" className="mb-3 space-y-1.5">
			<Heading label="Running" count={total} collapsed={runCollapsed} onToggle={toggleRun}
				title={mLine ? `Machines: ${mLine}` : undefined} />
			{!runCollapsed && cells > 0 && (
				<div className="grid grid-cols-2 gap-2">
					{shownRuns.map((it) => <RunTile key={it.run.run_id} item={it} now={now} showApp={!app || it.run.app !== app} />)}
					{shownJobs.map((j) => <JobTile key={j.job_id} job={j} now={now} />)}
					{overflow && (
						<Link to={allHref} className="flex h-[92px] flex-col items-center justify-center gap-1 rounded-lg border border-ink-200 bg-muted/40 text-caption text-ink-700 transition-colors hover:bg-muted">
							<span className="font-mono text-title tabular-nums text-ink-900">+{more}</span>
							<span className="inline-flex items-center gap-1">more running <ArrowRight className="h-3 w-3" /></span>
						</Link>
					)}
					{slotInGrid && (
						<div data-slot="next" className="flex h-[92px] flex-col justify-end rounded-lg border border-dashed border-ink-200 p-2.5 text-micro leading-snug">{slotText}</div>
					)}
				</div>
			)}
			{!runCollapsed && !slotInGrid && (
				<div data-slot="next" className="truncate rounded-lg border border-dashed border-ink-200 px-2.5 py-1.5 text-micro">{slotText}</div>
			)}
			{finished.length > 0 && (
				<>
					<div className="pt-1">
						<Heading label="Done" count={finished.length} collapsed={doneCollapsed} onToggle={toggleDone} title="Finished in the last day" />
					</div>
					{!doneCollapsed && (
						<ul className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-200 bg-card">
							{done.map((r) => {
								const ok = r.state === "succeeded";
								const loop = loopOfRun(r);
								const other = !app || r.app !== app;
								return (
									<li key={r.run_id}>
										<Link to={runPath(r.app || "", loop, r.run_id)}
											title={`${ok ? "Succeeded" : "Failed"}${r.duration_s ? ` · took ${fmtDuration(r.duration_s)}` : ""}`}
											className="flex h-8 min-w-0 items-center gap-2 px-2.5 text-caption transition-colors hover:bg-muted/50">
											<span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-[1px]", ok ? "bg-gold-400" : "bg-brick-500")} aria-hidden />
											<span className="min-w-0 truncate text-ink-800">
												{loopLabel("", loop)}{other && <span className="text-ink-600"> · {appName(r.app)}</span>}
											</span>
											{!ok && <span className="flex-shrink-0 text-micro text-brick-700">failed</span>}
											<span className="ml-auto flex-shrink-0 font-mono text-nano tabular-nums text-ink-600">{fmtAgo(r.started_at)}</span>
										</Link>
									</li>
								);
							})}
						</ul>
					)}
					{!doneCollapsed && finished.length > done.length && (
						<Link to={allHref} className="flex items-center justify-end gap-1 px-1 text-micro text-ink-600 hover:text-ink-900">
							All activity <ArrowRight className="h-3 w-3" />
						</Link>
					)}
				</>
			)}
		</section>
	);
}

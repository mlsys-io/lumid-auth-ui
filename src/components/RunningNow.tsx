// RunningNow — THE running panel, the same on every Studio page that has the
// docked chat (app workspace, Data, Compute): Novix's live-work column, in
// Lumid's words. Top to bottom:
//
//   ⌄ Running                          [2]   (machines in the tooltip)
//   ┌ 21:09   17 min ago ┐ ┌ 21:12  3 min ago ┐
//   │ Backtest · Quant…  │ │ lumid-data job   │   ← tiles, 2 per row
//   │ backtesting…       │ │ Running…         │
//   │ ■■■■■□□□□□□□□□     │ │ ■■□□□□□□□□□□□□   │   ← two rows of squares:
//   │ ■■■■□□□□□□□□□□     │ │ □□□□□□□□□□□□□□   │     progress, one per step
//   └────────────────────┘ └──────────────────┘
//   ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐   ← dashed boxes = free slots
//   └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘     (the first says what starts next)
// Only what is running or waiting — finished runs live in Activity (the user:
// "no need to show 'done' in the right top panel", 2026-11-25).
//
// Global: every app's runs (the current app's first), lum.id/data jobs, and
// Research Fleet jobs (GET /me/fleet/jobs) still queued or running — each
// unfinished one confirmed with its own status read (lib/fleet-view.ts).
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
import { fmtDuration, fmtTypical, groupActivity, isOverdue, progressOf, type RunningItem } from "@/lib/activity";
import { capacityRows, machinesLine, queueItems, versionLabel, type ComputeCapacity, type QueueRow } from "@/lib/compute";
import { loopLabel } from "@/lib/workflow-names";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { dataJobs } from "@/api/dataJobs";
import { jobElapsedS, jobStatusLabel, type Job } from "@/lib/data-jobs";
import { fleet, type FleetJob } from "@/api/fleet";
import { railAction, railFleetJobs, railToConfirm, type FleetFresh } from "@/lib/fleet-view";
import { useWorkflowColors } from "@/hooks/useWorkflowColors";

const FEED_DAYS = 1;
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

function useActiveFleetJobs(enabled: boolean): FleetJob[] {
	const [jobs, setJobs] = useState<FleetJob[]>([]);
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		const load = async () => {
			if (document.visibilityState === "hidden") return;
			try {
				const listed = (await fleet.list({ limit: 30 })).jobs ?? [];
				// The list's statuses are identity's cache and can sit at "queued" for
				// hours after a job finished (2026-11-28: eleven GPU sandbox jobs
				// "Waiting at Office" 2 h after they ran). Ask each unfinished job
				// itself — the read also writes the status back — and leave out an
				// old one nobody could confirm (lib/fleet-view.ts).
				const fresh = new Map<string, FleetFresh>();
				await Promise.all(railToConfirm(listed).map(async (id) => {
					try { const s = await fleet.status(id); fresh.set(id, { status: s.status, terminal: s.terminal }); } catch { /* unconfirmed */ }
				}));
				if (live) setJobs(railFleetJobs(listed, fresh, Date.now() / 1000));
			} catch { if (live) setJobs([]); }
		};
		load();
		const id = window.setInterval(load, JOBS_POLL_MS);
		return () => { live = false; window.clearInterval(id); };
	}, [enabled]);
	return jobs;
}

function FleetTile({ job, now }: { job: FleetJob; now: number }) {
	const started = job.created_at ? Date.parse(job.created_at) / 1000 : now;
	const elapsed = Math.max(0, now - started);
	const running = job.status === "running";
	const action = railAction(job);
	return (
		<Tile to="/studio/research-fleet/jobs" startedAt={started} now={now} live={running}
			label={`Research Fleet job ${job.name || job.id}: ${action}, ${fmtDuration(elapsed)}`}
			title={<>{job.name || job.labels?.experiment || job.id.slice(0, 12)}<span className="font-normal text-ink-600"> · fleet job</span></>}
			action={running ? <><span className="lumen-shine">{action}</span><WorkingDots /></> : <span>{action}</span>}
			cells={<ProgressCells p={null} elapsed={elapsed} late={false} />}
		/>
	);
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

// Novix's progress: two rows of small squares, one per step (or per share of
// the usual time), done ones in mixed shades so it reads as work, not a bar.
const CELLS = 28;
const DONE_SHADE = ["bg-lagoon-300", "bg-lagoon-200", "bg-lagoon-400", "bg-lagoon-200", "bg-lagoon-300", "bg-lagoon-400", "bg-lagoon-200"];
const shade = (i: number) => DONE_SHADE[(i * 3 + (i >> 2)) % DONE_SHADE.length];
const CELL_GRID = "grid grid-cols-[repeat(14,minmax(0,1fr))] gap-[2px]";
// Tile height, shared by run tiles, "+N more" and free slots (was 118px; the
// panel read tall — squeezed 2026-11-26). Cells are fixed-height bars, not
// squares, so a wide rail doesn't grow them.
const TILE_H = "h-[100px]";
const CELL = "h-1.5 rounded-[2px]";
const hhmm = (sec: number) => new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
function minsAgo(sec: number, now: number): string {
	const m = Math.max(0, Math.round((now - sec) / 60));
	return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

function Tile({ to, label, startedAt, now, live, title, action, cells, late, bar, app }: {
	to: string; label: string; startedAt: number; now: number; live: boolean;
	/** The app it belongs to, named on the tile's top line (2026-11-27: "running
	 *  jobs don't show which app"). */
	app?: string;
	title: React.ReactNode; action: React.ReactNode; cells: React.ReactNode; late?: boolean;
	/** The workflow's colour (as on its sidebar row and map branch). */
	bar?: string;
}) {
	return (
		<Link to={to} aria-label={label} data-tile="run"
			className={cn("group relative flex", TILE_H, "min-w-0 flex-col overflow-hidden rounded-lg border bg-card px-2.5 pb-2 pt-1.5 shadow-e1 animate-lumen-rise transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-e2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
				late ? "border-ember-200" : "border-ink-200 hover:border-lagoon-300")}>
			{bar && <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", bar)} />}
			<div className="flex items-center gap-1.5 font-mono text-nano tabular-nums text-ink-600">
				<span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", late ? "bg-ember-500" : "bg-lagoon-500", live && "animate-lumen-breathe")} aria-hidden />
				{app ? <span className="min-w-0 truncate font-sans font-medium text-ink-800" title={app}>{app}</span> : <span className="text-ink-800">{hhmm(startedAt)}</span>}
				<span className="ml-auto flex-shrink-0 truncate" title={`Started ${hhmm(startedAt)}`}>{minsAgo(startedAt, now)}</span>
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
		<div className={CELL_GRID} title={tip} aria-hidden>
			{Array.from({ length: CELLS }, (_, i) => (
				<span key={i} className={cn(CELL,
					i < done ? (late ? "bg-ember-200" : shade(i))
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
		<div className={CELL_GRID} aria-hidden>
			{steps.map((st, i) => (
				<span key={i} title={`${st.stage ? st.stage + " · " : ""}${st.name}`}
					className={cn(CELL, st.state === "done" ? shade(i) : st.state === "now" ? "bg-lagoon-500 animate-lumen-breathe" : "bg-ink-100")} />
			))}
		</div>
	);
}

function RunTile({ item, now }: { item: RunningItem; now: number; showApp?: boolean }) {
	const { run, wf } = item;
	const colorOf = useWorkflowColors();
	const startedAt = run.started_at || now;
	const elapsed = Math.max(0, now - startedAt);
	const p = progressOf(elapsed, wf.typicalS);
	const late = isOverdue(elapsed, wf.typicalS);
	const tpl = useLastRunSteps(wf);
	const est = tpl ? estimateSteps(tpl, elapsed, wf.loop) : null;
	const wfName = loopLabel(wf.name, wf.loop);
	const doing = est?.now && !est.beyond ? est.now.name : "Running";
	return (
		<Tile to={runRowHref(run.run_id)} startedAt={startedAt} now={now} live late={late} bar={colorOf(wf.app, wf.loop)?.bar}
			label={`${appTitle(wf.app)}, ${wfName} — running for ${fmtDuration(elapsed)}`}
			app={appTitle(wf.app)} title={wfName}
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


export default function RunningNow({ app, runs = true, jobs = true }: { app?: string; runs?: boolean; jobs?: boolean }) {
	const feed = useRunsFeed(FEED_DAYS);
	// Every app's running runs, the current app's first.
	const running = useMemo(() => {
		if (!runs || !feed.runs) return [];
		const all = groupActivity(feed.runs, {}).running;
		return app ? [...all.filter((it) => it.run.app === app), ...all.filter((it) => it.run.app !== app)] : all;
	}, [runs, feed.runs, app]);
	const activeJobs = useActiveJobs(jobs);
	const fleetJobs = useActiveFleetJobs(jobs);
	const queue = usePoll(() => me.appQueue(app!), 10_000, `q:${app}`, !!app);
	const cap = usePoll(() => me.computeSummary(), 30_000, "compute");
	const total = running.length + activeJobs.length + fleetJobs.length;
	const now = useNowSec(total > 0);
	const allHref = "/studio/runs";
	const [runCollapsed, toggleRun] = useCollapse("studio-rail:running", false);

	// Nothing loaded yet: render nothing, so the rail doesn't flash a state the
	// first answer immediately contradicts.
	if (runs && feed.runs === null && activeJobs.length === 0 && fleetJobs.length === 0) return null;
	// Nothing running: no panel at all — the chat takes the rail ("if none
	// running, hide the running panel totally", 2026-11-27). It comes back the
	// moment a run or job starts.
	if (total === 0) return null;

	// Novix's grid: one box per running job, free slots as dashed boxes — a
	// row of two while one or nothing runs, two rows of two once more do; more
	// than fit → a "+N" box.
	const room = total <= 1 ? 2 : 4;
	const overflow = total > room;
	const fit = overflow ? room - 1 : room;
	const shownRuns = running.slice(0, fit);
	const shownJobs = activeJobs.slice(0, Math.max(0, fit - shownRuns.length));
	const shownFleet = fleetJobs.slice(0, Math.max(0, fit - shownRuns.length - shownJobs.length));
	const shown = shownRuns.length + shownJobs.length + shownFleet.length;
	const more = total - shown;
	const freeSlots = Math.max(0, room - shown - (overflow ? 1 : 0));
	const next = queue ? queueItems(queue.rows as QueueRow[]).waiting : [];
	const machines = cap ? capacityRows(cap.capacity as ComputeCapacity[]) : [];
	const mLine = machinesLine(machines);
	const slotText = next[0]
		? <><span className="text-ink-600">Starts next{next.length > 1 ? ` (+${next.length - 1})` : ""}: </span><span className="font-medium text-ink-800">{loopLabel("", next[0].loop)}{next[0].version ? ` · ${versionLabel(next[0].version)}` : ""}</span></>
		: <span className="text-ink-600">Nothing waiting — the next run starts here.</span>;

	return (
		<section aria-label="Running now" className="mb-3 space-y-1.5">
			<Heading label="Running" count={total} collapsed={runCollapsed} onToggle={toggleRun}
				title={mLine ? `Machines: ${mLine}` : undefined} />
			{!runCollapsed && (
				<div className="grid grid-cols-2 gap-2">
					{shownRuns.map((it) => <RunTile key={it.run.run_id} item={it} now={now} showApp={!app || it.run.app !== app} />)}
					{shownJobs.map((j) => <JobTile key={j.job_id} job={j} now={now} />)}
					{shownFleet.map((j) => <FleetTile key={j.id} job={j} now={now} />)}
					{overflow && (
						<Link to={allHref} className={cn("flex flex-col items-center justify-center gap-1 rounded-lg border border-ink-200 bg-muted/40 text-caption text-ink-700 transition-colors hover:bg-muted", TILE_H)}>
							<span className="font-mono text-title tabular-nums text-ink-900">+{more}</span>
							<span className="inline-flex items-center gap-1">more running <ArrowRight className="h-3 w-3" /></span>
						</Link>
					)}
					{Array.from({ length: freeSlots }, (_, i) => (
						// The first free slot says what starts next (or that runs start here).
						<div key={`free${i}`} data-slot={i === 0 ? "next" : "free"}
							className={cn("flex flex-col justify-end rounded-lg border border-dashed border-ink-200 p-2.5 text-micro leading-snug", TILE_H)}>
							{i === 0 ? slotText : null}
						</div>
					))}
				</div>
			)}
		</section>
	);
}

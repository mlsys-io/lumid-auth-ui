// RunningNow — THE running panel, the same on every Studio page that has the
// docked chat (app workspace, Data, Compute): Novix's live-work column, in
// Lumid's words. Top to bottom:
//
//   RUNNING · 2                                   All activity →
//   [Quant Research · Backtest · backtesting… · 1m 20s ▓▓░]   ← cards
//   [Data job · lumid-data · Running · 40s]
//   ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
//   ╎ Starts next  Simulate · C8         ╎   ← the free slot (the app's queue)
//   └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
//   DONE  [● Backtest · succeeded · 3m ago]   (bordered rows)
//   GPUs 3 of 14 busy · CPUs 0 of 22 busy      (machines, one line)
//
// Global: every app's runs (the current app's first), plus lum.id/data jobs.
// Sources: runs feed + SSE (useRunsFeed), data jobs (15 s poll), the app's
// queue on app pages (GET /me/apps/:app/queue), machines (GET /me/compute).
// A source that isn't there is left out, never faked.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { me } from "@/api/me";
import { RunningCard } from "@/components/activity/ActivityView";
import { useNowSec, useRunsFeed } from "@/components/activity/hooks";
import { fmtAgo, fmtDuration, groupActivity, loopOfRun } from "@/lib/activity";
import { capacityLine, capacityRows, machinesLine, queueItems, versionLabel, type ComputeCapacity, type QueueRow } from "@/lib/compute";
import { runPath } from "@/lib/run-routes";
import { loopLabel } from "@/lib/workflow-names";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { dataJobs } from "@/api/dataJobs";
import { jobElapsedS, jobStatusLabel, type Job } from "@/lib/data-jobs";
import { StatusDot } from "@/components/ui/status-badge";

const FEED_DAYS = 1;
const SHOW = 3;
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

function JobRunningCard({ job, now }: { job: Job; now: number }) {
	const elapsed = jobElapsedS(job, now);
	const running = job.status === "running";
	const where = [job.runtime, job.site ? `at ${job.site}` : ""].filter(Boolean).join(" ");
	return (
		<Link
			to={`/studio/data-warehouse?tab=jobs&job=${encodeURIComponent(job.job_id)}`}
			className="block rounded-xl border border-lagoon-200 bg-card p-3 shadow-e1 animate-lumen-rise lumen-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
			aria-label={`Data job ${job.name || job.app}: ${jobStatusLabel(job.status)}, ${fmtDuration(elapsed)}`}
		>
			<div className="flex items-center gap-2 text-micro text-ink-600">
				<StatusDot tone="running" pulse={running} title={jobStatusLabel(job.status)} />
				<span>Data job{where ? ` · ${where}` : ""}</span>
				<span className="ml-auto font-mono tabular-nums text-ink-800">{fmtDuration(elapsed)}</span>
			</div>
			<div className="mt-1.5 min-w-0 truncate text-body font-medium text-ink-900">
				{job.app && job.name && job.name !== job.app && <span className="text-ink-600 font-normal">{job.app} · </span>}
				{job.name || job.app || "Job"}
			</div>
			<div className="mt-1 text-meta text-ink-600">
				<span className={running ? "lumen-shine font-medium" : "font-medium"}>{jobStatusLabel(job.status)}</span>
			</div>
		</Link>
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

	// Nothing loaded yet: render nothing, so the rail doesn't flash a state the
	// first answer immediately contradicts.
	if (runs && feed.runs === null && activeJobs.length === 0) return null;

	const shownRuns = running.slice(0, SHOW);
	const shownJobs = activeJobs.slice(0, Math.max(0, SHOW - shownRuns.length));
	const more = total - shownRuns.length - shownJobs.length;
	const next = queue ? queueItems(queue.rows as QueueRow[]).waiting : [];
	const done = (feed.runs || [])
		.filter((r) => r.state === "succeeded" || r.state === "failed")
		.sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
		.slice(0, 3);
	const machines = cap ? capacityRows(cap.capacity as ComputeCapacity[]) : [];
	const mLine = machinesLine(machines);

	return (
		<section aria-label="Running now" className="mb-3 space-y-2">
			<div className="flex items-center gap-2 px-1">
				<span className="eyebrow">Running</span>
				<span className="text-micro text-ink-600 tabular-nums">{total}</span>
				<Link to={allHref} className="ml-auto inline-flex items-center gap-1 text-micro text-ink-700 hover:underline">
					{more > 0 ? `${more} more` : "All activity"} <ArrowRight className="w-3 h-3" />
				</Link>
			</div>
			<div className="space-y-2 max-h-[34vh] overflow-y-auto">
				{shownRuns.map((it) => <RunningCard key={it.run.run_id} item={it} now={now} showApp={!app || it.run.app !== app} />)}
				{shownJobs.map((j) => <JobRunningCard key={j.job_id} job={j} now={now} />)}
				{/* The free slot: what takes the next machine, or that one is free. */}
				<div data-slot="next" className="rounded-lg border border-dashed border-ink-300 px-2.5 py-2 text-caption">
					{next[0] ? (
						<>
							<div className="text-micro text-ink-600">Starts next{next.length > 1 ? ` · ${next.length - 1} more waiting` : ""}</div>
							<div className="font-medium text-ink-900 truncate">{loopLabel("", next[0].loop)}{next[0].version ? ` · ${versionLabel(next[0].version)}` : ""}</div>
						</>
					) : (
						<div className="text-ink-600">{total ? "Nothing waiting — the next run starts here." : "Free — runs start here."}</div>
					)}
				</div>
			</div>
			{done.length > 0 && (
				<div>
					<div className="eyebrow px-1 mb-1">Done</div>
					<ul className="space-y-1">
						{done.map((r) => {
							const ok = r.state === "succeeded";
							const loop = loopOfRun(r);
							return (
								<li key={r.run_id}>
									<Link to={runPath(r.app || "", loop, r.run_id)}
										className="flex items-center gap-2 rounded-lg border border-ink-200 bg-card px-2.5 py-1.5 text-caption hover:border-ink-300 hover:bg-muted/50 transition-colors min-w-0">
										<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", ok ? TONES.ok.dot : TONES.failing.dot)} />
										<span className="truncate min-w-0">
											{(!app || r.app !== app) && <span className="text-ink-600">{appName(r.app)} · </span>}
											<span className="font-medium text-ink-900">{loopLabel("", loop)}</span>
										</span>
										<span className={cn("text-micro flex-shrink-0", ok ? "text-gold-700" : "text-brick-700")}>{ok ? "succeeded" : "failed"}</span>
										<span className="ml-auto text-micro text-ink-600 whitespace-nowrap">{fmtAgo(r.started_at)}</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			)}
			{mLine && (
				<div className="px-1 text-micro text-ink-600" title={machines.map((m) => `${m.label}: ${capacityLine(m)}`).join("\n")}>
					Machines: {mLine}
				</div>
			)}
		</section>
	);
}

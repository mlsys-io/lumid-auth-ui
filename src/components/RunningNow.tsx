// RunningNow — the top of the docked chat rail: what is running right now, so
// a person talking to the chat can see their work move without leaving the
// page (Novix keeps live work in the same column as the conversation).
//
// Two sources, merged:
//   • workflow runs — the Activity feed (useRunsFeed), shown with the SAME
//     RunningCard the Activity page uses, so a run looks identical everywhere;
//   • lum.id/data jobs — read from the jobs entrance directly, because the
//     runs feed only carries them once identity serves them there.
// Scope: `app` limits both to one app (the app workspace); `runs`/`jobs`
// pick the sources (the Data page shows jobs only).
//
// Idle is ONE sentence with a way to the full list — never a panel of zeros.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { RunningCard } from "@/components/activity/ActivityView";
import { useNowSec, useRunsFeed } from "@/components/activity/hooks";
import { fmtDuration, groupActivity } from "@/lib/activity";
import { dataJobs } from "@/api/dataJobs";
import { jobElapsedS, jobStatusLabel, type Job } from "@/lib/data-jobs";
import { StatusDot } from "@/components/ui/status-badge";

const FEED_DAYS = 1;
const SHOW = 3;
const JOBS_POLL_MS = 15_000;
const ACTIVE_JOB = new Set(["planned", "submitted", "running"]);

function useActiveJobs(enabled: boolean, app?: string): Job[] {
	const [jobs, setJobs] = useState<Job[]>([]);
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		const load = async () => {
			if (document.visibilityState === "hidden") return;
			try {
				const r = await dataJobs.jobs({ limit: 30, ...(app ? { app } : {}) });
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
	}, [enabled, app]);
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

export default function RunningNow({ app, runs = true, jobs = true }: { app?: string; runs?: boolean; jobs?: boolean }) {
	const feed = useRunsFeed(FEED_DAYS);
	const running = useMemo(
		() => (runs && feed.runs ? groupActivity(feed.runs, app ? { app } : {}).running : []),
		[runs, feed.runs, app],
	);
	const activeJobs = useActiveJobs(jobs, app);
	const total = running.length + activeJobs.length;
	const now = useNowSec(total > 0);
	const allHref = app ? `/studio/runs?app=${encodeURIComponent(app)}` : "/studio/runs";

	// Nothing loaded yet: render nothing, so the rail doesn't flash a sentence
	// that the first answer immediately contradicts.
	if (runs && feed.runs === null && activeJobs.length === 0) return null;

	if (total === 0) {
		return (
			<div className="mb-2 flex items-center gap-2 px-1 text-micro text-ink-600">
				<StatusDot tone="idle" title="Nothing running" />
				<span>Nothing running right now.</span>
				<Link to={allHref} className="ml-auto inline-flex items-center gap-1 text-ink-700 hover:underline">
					All activity <ArrowRight className="w-3 h-3" />
				</Link>
			</div>
		);
	}

	const shownRuns = running.slice(0, SHOW);
	const shownJobs = activeJobs.slice(0, Math.max(0, SHOW - shownRuns.length));
	const more = total - shownRuns.length - shownJobs.length;
	return (
		<section aria-label="Running now" className="mb-3">
			<div className="mb-1.5 flex items-center gap-2 px-1">
				<span className="eyebrow">Running now</span>
				<span className="text-micro text-ink-600 tabular-nums">{total}</span>
				<Link to={allHref} className="ml-auto inline-flex items-center gap-1 text-micro text-ink-700 hover:underline">
					{more > 0 ? `${more} more` : "All activity"} <ArrowRight className="w-3 h-3" />
				</Link>
			</div>
			<div className="space-y-2 max-h-[40vh] overflow-y-auto">
				{shownRuns.map((it) => <RunningCard key={it.run.run_id} item={it} now={now} showApp={!app} />)}
				{shownJobs.map((j) => <JobRunningCard key={j.job_id} job={j} now={now} />)}
			</div>
		</section>
	);
}

// RunChildren — the fleet work a run launched, under its steps.
//
// A run that dispatched to the compute fleet records each Lumilake job it ran
// (me_app_runs.compute_jobs, returned on the cycle detail). Without this the
// only way from a run to its fleet jobs was to already know the job id. One row
// per job: site, job id, arm, the job's status (read lazily, per row, through
// the owner-gated /me/compute/jobs route) and the FlowMesh workflow(s) it
// dispatched, each a link into Research Fleet → Jobs with that workflow open.
//
// Rendered only when the run recorded jobs — an empty "Children: none" on every
// run that never touched the fleet is clutter.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu, Loader2 } from "lucide-react";
import { me, type MeRunComputeJob } from "@/api/me";
import { fleetJobsPath, shortJobId } from "@/lib/fleet-provenance";
import { cn } from "@/lib/utils";

type JobState =
	| { kind: "loading" }
	| { kind: "ok"; status: string; workflows: Array<{ workflow_id: string; status?: string }> }
	| { kind: "err"; why: string };

function statusTone(s: string): string {
	if (s === "completed") return "text-emerald-700";
	if (s === "failed") return "text-rose-700";
	if (s === "cancelled") return "text-slate-500";
	return "text-sky-700";
}

function JobRow({ job }: { job: MeRunComputeJob }) {
	const [st, setSt] = useState<JobState>({ kind: "loading" });
	useEffect(() => {
		let live = true;
		setSt({ kind: "loading" });
		me.computeJob(job.site, job.job_id)
			.then((r) => { if (live) setSt({ kind: "ok", status: r.status || "unknown", workflows: Array.isArray(r.workflows) ? r.workflows : [] }); })
			.catch((e) => { if (live) setSt({ kind: "err", why: String((e as Error)?.message || e).slice(0, 160) }); });
		return () => { live = false; };
	}, [job.site, job.job_id]);

	return (
		<tr className="border-b border-slate-50 align-top">
			<td className="px-2 py-1.5 font-mono text-slate-600">{job.site}</td>
			{/* No Lumilake job page exists in the Studio, so the job is its id —
			    the full one in the title, for copying. */}
			<td className="px-1 py-1.5 font-mono text-slate-800" title={`Lumilake job ${job.job_id}`}>
				<span className="sr-only">Lumilake job </span>{shortJobId(job.job_id)}
			</td>
			<td className="px-1 py-1.5 font-mono text-slate-600" title={job.arm || undefined}>
				<span className="block truncate max-w-[96px]">{job.arm || ""}</span>
			</td>
			<td className="px-1 py-1.5 whitespace-nowrap">
				{st.kind === "loading" ? (
					<span className="inline-flex items-center gap-1 text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> reading…</span>
				) : st.kind === "err" ? (
					<span className="text-slate-400" title={st.why}>status unavailable</span>
				) : (
					<span className={cn("font-medium", statusTone(st.status))}>{st.status}</span>
				)}
			</td>
			<td className="px-1 py-1.5">
				{st.kind === "ok" && st.workflows.length > 0 ? (
					<span className="flex flex-wrap gap-x-2 gap-y-0.5">
						{st.workflows.map((w) => (
							<Link key={w.workflow_id} to={fleetJobsPath(job.site, w.workflow_id)}
								className="font-mono text-sky-700 hover:underline" title={`FlowMesh workflow ${w.workflow_id}${w.status ? ` · ${w.status}` : ""}`}>
								{shortJobId(w.workflow_id)}
							</Link>
						))}
					</span>
				) : st.kind === "loading" ? null : (
					<span className="text-slate-400">—</span>
				)}
			</td>
		</tr>
	);
}

export default function RunChildren({ jobs }: { jobs?: MeRunComputeJob[] | null }) {
	const list = (jobs || []).filter((j) => j && j.job_id && j.site);
	if (!list.length) return null;
	return (
		<section aria-label="Children" className="mt-3">
			<div className="flex items-center gap-2 px-1 pb-1.5">
				<h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 inline-flex items-center gap-1">
					<Cpu className="w-3 h-3" /> Children
				</h3>
				<span className="text-[11px] text-slate-400">{list.length} fleet job{list.length === 1 ? "" : "s"}</span>
			</div>
			<div className="rounded-lg border border-slate-200 overflow-x-auto">
				<table className="w-full text-[11px]">
					<thead className="bg-slate-50">
						<tr className="text-left text-slate-500 border-b border-slate-100">
							<th className="px-2 py-1 font-medium">Site</th>
							<th className="px-1 py-1 font-medium">Lumilake job</th>
							<th className="px-1 py-1 font-medium">Arm</th>
							<th className="px-1 py-1 font-medium">Status</th>
							<th className="px-1 py-1 font-medium">FlowMesh workflow</th>
						</tr>
					</thead>
					<tbody>
						{list.slice(0, 32).map((j) => <JobRow key={`${j.site}:${j.job_id}`} job={j} />)}
					</tbody>
				</table>
				{list.length > 32 && <p className="px-2 py-1 text-[11px] text-slate-500">Showing 32 of {list.length}.</p>}
			</div>
		</section>
	);
}

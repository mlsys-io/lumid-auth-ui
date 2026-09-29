// RunOnFleet — the editor's Run button for a compute graph.
//
// Before this the editor could only SAVE a FlowMesh or Lumilake document; to run
// it you copied the YAML into Research Fleet's submit dialog or a chat tool. Run
// here validates the document on the fleet first (a dry run, so a typo is a
// message rather than a failed job), then runs it as the signed-in user and
// follows the job's status until it ends. The job is the same one Research
// Fleet lists — one id, one status vocabulary (api/fleet.ts).

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { fleet, type FleetJob, type FleetStatus } from "@/api/fleet";

const POLL_MS = 4000;

const TONE: Record<FleetStatus, string> = {
	queued: "bg-slate-100 text-slate-600",
	running: "bg-indigo-50 text-indigo-700",
	succeeded: "bg-emerald-50 text-emerald-700",
	failed: "bg-rose-50 text-rose-700",
	canceled: "bg-slate-100 text-slate-500",
};

export default function RunOnFleet({
	yaml, format, disabled, className,
}: { yaml: string; format: "flowmesh" | "lumilake"; disabled?: boolean; className: string }) {
	const [phase, setPhase] = useState<"idle" | "validating" | "starting">("idle");
	const [job, setJob] = useState<FleetJob | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	const follow = (id: string) => {
		clearTimeout(timer.current);
		timer.current = setTimeout(async () => {
			try {
				const s = await fleet.status(id);
				setJob((j) => (j ? { ...j, status: s.status, terminal: s.terminal } : j));
				if (!s.terminal) follow(id);
			} catch {
				follow(id); // a missed poll is not a failed job
			}
		}, POLL_MS);
	};

	const run = async () => {
		setProblem(null);
		setJob(null);
		try {
			setPhase("validating");
			await fleet.validate({ workflow: yaml, format });
			setPhase("starting");
			const started = await fleet.run({ workflow: yaml, format });
			setJob(started);
			if (!started.terminal) follow(started.id);
		} catch (e) {
			setProblem((e as Error)?.message || "could not run");
		} finally {
			setPhase("idle");
		}
	};

	const cancel = async () => {
		if (!job) return;
		try {
			await fleet.cancel(job.id);
		} catch (e) {
			setProblem((e as Error)?.message || "could not cancel");
		}
	};

	const busy = phase !== "idle";
	const live = job && !job.terminal;
	return (
		<div className="flex items-center gap-1.5">
			<button
				type="button"
				className={className}
				disabled={disabled || busy || !!live}
				onClick={() => void run()}
				title="Validate, then run this graph on Research Fleet"
			>
				{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
				{phase === "validating" ? "Validating…" : phase === "starting" ? "Starting…" : "Run"}
			</button>
			{live && (
				<button type="button" className={className} onClick={() => void cancel()} title="Cancel this run">
					<Square size={12} /> Cancel
				</button>
			)}
			{job && (
				<a
					href="/studio/research-fleet/jobs"
					className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${TONE[job.status]}`}
					title={`${job.id} — open in Research Fleet`}
				>
					{job.status} · {job.id}
				</a>
			)}
			{problem && (
				<span className="max-w-[28rem] truncate text-[10px] text-rose-600" title={problem}>
					{problem}
				</span>
			)}
		</div>
	);
}

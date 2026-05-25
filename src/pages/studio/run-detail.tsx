// /studio/runs/:run_id — Airflow-style run drill-down (W1).
//
// Layout:
//   Header     — workflow · state · timing · cost (W4 fills cost in)
//   DAG        — RunDagCanvas, click a step → side panel with logs + error
//   Timeline   — strip beneath the DAG showing per-step start/end bars
//   Actions    — Re-run · Mark succeeded · Mark failed (Airflow idiom)
//
// Source-of-truth differs per kind: scheduled runs read cycle_dir
// artifacts (step_log.json, summary.json, step_errors.json); visual
// runs read the n8n execution payload.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, ArrowLeft, Play, Check, X } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError, type MeRunDetail } from "@/api/me";
import RunDagCanvas from "@/components/RunDagCanvas";

interface StepLogEntry {
	id?: string;
	name?: string;
	skill?: string;
	ok?: boolean;
	skipped?: boolean;
	duration_s?: number;
	error?: string;
	stdout?: string;
	stderr?: string;
	[k: string]: unknown;
}

export default function StudioRunDetail() {
	const { run_id = "" } = useParams<{ run_id: string }>();
	const [detail, setDetail] = useState<MeRunDetail | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [selectedStep, setSelectedStep] = useState<StepLogEntry | null>(null);

	const load = async () => {
		try {
			const r = await me.runDetail(run_id);
			setDetail(r);
		} catch (e) {
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, [run_id]);

	if (err) return <div className="space-y-4"><BackLink /><div className="text-rose-700 text-sm">{err}</div></div>;
	if (!detail) return <div className="space-y-4"><BackLink /><div className="text-sm text-slate-500 italic">Loading…</div></div>;

	const steps = normalizeSteps(detail.steps);
	const summary = detail.summary as Record<string, any> | null;
	const stepErrors = detail.step_errors as Record<string, any> | any[] | null;

	return (
		<div className="space-y-4">
			<BackLink />

			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-semibold flex items-center gap-2">
						<Activity className="w-5 h-5 text-emerald-600" />
						{detail.app && detail.loop ? `${detail.app} / ${detail.loop}` : run_id}
					</h1>
					<p className="text-sm text-slate-500 mt-0.5 font-mono">
						run · {run_id}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<RunActions detail={detail} onChanged={load} />
				</div>
			</header>

			{summary && (
				<div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-6 text-sm">
					<MetaItem label="state">
						{summary.ok === false || (Array.isArray(stepErrors) && stepErrors.length > 0)
							? <span className="text-rose-700 font-medium">failed</span>
							: summary.ok === true
								? <span className="text-emerald-700 font-medium">succeeded</span>
								: <span className="text-slate-600">{String(summary.state || "—")}</span>
						}
					</MetaItem>
					{typeof summary.duration_s === "number" && (
						<MetaItem label="duration">{summary.duration_s.toFixed(1)}s</MetaItem>
					)}
					{typeof summary.steps === "number" && (
						<MetaItem label="steps">{summary.steps}</MetaItem>
					)}
					{typeof summary.errors === "number" && (
						<MetaItem label="errors">{summary.errors}</MetaItem>
					)}
				</div>
			)}

			{/* DAG canvas */}
			<RunDagCanvas steps={steps} onStepClick={setSelectedStep} />

			{/* Step inspector — opens when the user clicks a node */}
			{selectedStep && (
				<StepInspector step={selectedStep} onClose={() => setSelectedStep(null)} />
			)}

			{/* Step errors panel — surfaced even without an explicit click
			    because failed runs benefit from the at-a-glance summary */}
			{Array.isArray(stepErrors) && stepErrors.length > 0 && (
				<section className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
					<h3 className="font-medium text-rose-900 text-sm mb-2">Step errors</h3>
					<ul className="space-y-1.5 text-xs">
						{(stepErrors as any[]).map((e, i) => (
							<li key={i} className="font-mono text-rose-800 bg-white rounded px-2 py-1.5 border border-rose-100">
								<strong>{e.step || e.id || `step ${i + 1}`}:</strong> {String(e.error || e.message || JSON.stringify(e))}
							</li>
						))}
					</ul>
				</section>
			)}

			{/* Cycle dir hint for the user */}
			{detail.cycle_dir && (
				<p className="text-[11px] text-slate-400 font-mono">{detail.cycle_dir}</p>
			)}
		</div>
	);
}

function BackLink() {
	return (
		<Link to="/studio/runs" className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 gap-1">
			<ArrowLeft className="w-3.5 h-3.5" />
			Runs
		</Link>
	);
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
			<div className="text-sm">{children}</div>
		</div>
	);
}

function RunActions({ detail, onChanged }: { detail: MeRunDetail; onChanged: () => void }) {
	// W1: re-run only for scheduled. Mark succeeded/failed land when the
	// scheduler grows the synthetic-journal entry shape (W2+).
	const canRerun = detail.kind === "scheduled" && detail.app && detail.loop;
	const handleRerun = async () => {
		if (!canRerun) return;
		try {
			await me.runLoopNow(detail.app!, detail.loop!);
			toast.success("Re-run queued");
			setTimeout(onChanged, 1500);
		} catch (e) {
			toast.error(e instanceof MeApiError ? e.message : String(e));
		}
	};
	return (
		<>
			<button
				onClick={handleRerun}
				disabled={!canRerun}
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors"
				title={canRerun ? "Re-run this workflow now" : "Re-run is only available for scheduled workflows"}
			>
				<Play className="w-3.5 h-3.5" /> Re-run
			</button>
			<button
				disabled
				title="Manual state overrides land in W2"
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
			>
				<Check className="w-3.5 h-3.5" /> Mark succeeded
			</button>
			<button
				disabled
				title="Manual state overrides land in W2"
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
			>
				<X className="w-3.5 h-3.5" /> Mark failed
			</button>
		</>
	);
}

function StepInspector({ step, onClose }: { step: StepLogEntry; onClose: () => void }) {
	const state = step.skipped ? "skipped" : step.ok === false ? "failed" : step.ok === true ? "succeeded" : "—";
	return (
		<div className="rounded-xl border border-slate-200 bg-white">
			<div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
				<div className="text-sm font-semibold">
					{step.id || step.name || step.skill || "step"}
					<span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">{state}</span>
				</div>
				<button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xs">close</button>
			</div>
			<div className="p-4 space-y-3 text-xs">
				{step.duration_s !== undefined && (
					<KeyValue k="duration" v={`${step.duration_s.toFixed(2)}s`} />
				)}
				{step.skill && <KeyValue k="skill" v={step.skill} />}
				{step.error && (
					<div className="font-mono text-[11px] bg-rose-50 text-rose-800 border border-rose-200 rounded p-2 whitespace-pre-wrap">
						{step.error}
					</div>
				)}
				{step.stdout && (
					<Collapsible label="stdout">
						<pre className="font-mono text-[11px] bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">{step.stdout}</pre>
					</Collapsible>
				)}
				{step.stderr && (
					<Collapsible label="stderr">
						<pre className="font-mono text-[11px] bg-slate-900 text-amber-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">{step.stderr}</pre>
					</Collapsible>
				)}
				<details>
					<summary className="text-slate-500 cursor-pointer">raw step record</summary>
					<pre className="mt-2 font-mono text-[10px] bg-slate-50 text-slate-700 rounded p-2 overflow-x-auto">{JSON.stringify(step, null, 2)}</pre>
				</details>
			</div>
		</div>
	);
}

function KeyValue({ k, v }: { k: string; v: string }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-slate-500 font-mono">{k}</span>
			<span className="text-slate-800">{v}</span>
		</div>
	);
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<details>
			<summary className="text-slate-500 cursor-pointer">{label}</summary>
			<div className="mt-1.5">{children}</div>
		</details>
	);
}

// normalizeSteps — the aggregator passes whatever the cycle dir's
// step_log.json contains. Tolerate empty / null / wrong-shape.
function normalizeSteps(raw: unknown): StepLogEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((x): x is StepLogEntry => x !== null && typeof x === "object");
}

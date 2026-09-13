// PromoteToExperiment — turn a plain workflow into an experiment, in place.
//
// This is the affordance that did not exist anywhere in the product. There was
// no create/edit path for an experiment at all: no /me write endpoint, no chat
// tool, nothing in any surface. The old empty state said, literally, "declare
// one under `experiments:` in the app's config" — i.e. go and hand-edit YAML,
// then app_push, then propagate to every tenant. That is the sequence that let
// quant-research ship `real_tape_rate` against rows that only ever carried
// `real_tape`: n=0 across 19 real runs, invisible, for months.
//
// It sits on the WORKFLOW that would own the experiment, because that is where
// the question is asked — you are looking at a loop's runs and want to know
// whether a change helped. A separate page would be the metric tier torn off
// again, which is the mistake the 2026-09-04 two-tab review correctly rejected.
//
// The two required fields are the whole point and are not negotiable here:
//
//   metric — a loop with no metric is a WORKFLOW, and that is a legitimate
//            thing to be. Naming one is what promotes it.
//   scope  — a dataset or an explicit case list. Without it min_samples counts
//            over an undefined population, which mbb-consultant's own spec
//            records as "19 early results measured over whatever cases happened
//            to be asked, which no threshold can interpret."
//
// The server enforces both again; this form just refuses to send an obviously
// incomplete definition so the round trip is not wasted.

import { useState } from "react";
import { Loader2, FlaskConical } from "lucide-react";
import { me, waitForIntent } from "@/api/me";

export default function PromoteToExperiment(
	{ app, loop, onCreated }: { app: string; loop: string; onCreated?: () => void },
) {
	const [open, setOpen] = useState(false);
	const [id, setId] = useState("");
	const [metric, setMetric] = useState("");
	const [scopeKind, setScopeKind] = useState<"dataset" | "cases">("dataset");
	const [scope, setScope] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	const ready = id.trim() !== "" && metric.trim() !== "" && scope.trim() !== "";

	async function submit() {
		if (!ready) return;
		setBusy(true); setErr(null);
		try {
			const body = {
				id: id.trim(), loop,
				metric: { name: metric.trim(), higher_is_better: true },
				...(scopeKind === "dataset"
					? { dataset_id: scope.trim() }
					: { cases: scope.split(",").map((c) => c.trim()).filter(Boolean) }),
			};
			const r = await me.upsertExperiment(app, body);
			// 202 + an intent: the scheduler applies it, so report what the
			// RUNNER did rather than claiming success on the queue accepting it.
			const res = await waitForIntent(r.intent_id, { timeoutMs: 90_000 });
			const out = (res.result || {}) as Record<string, unknown>;
			if (out.ok === false) { setErr(String(out.error || "could not define the experiment")); return; }
			const warns = (out.warnings as string[]) || [];
			setDone(warns.length ? warns.join(" · ") : "defined");
			onCreated?.();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-3 py-2.5 flex items-center justify-between gap-3">
				<div className="text-[11px] text-slate-500 leading-relaxed">
					This workflow has no metric, so it is not an experiment — it runs, and
					its output is above. Give it a metric and a case scope to start
					measuring whether a change helps.
				</div>
				<button type="button" onClick={() => setOpen(true)}
					className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
					<FlaskConical className="w-3.5 h-3.5" /> Make it an experiment
				</button>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
			<div className="text-[11px] uppercase tracking-wide font-semibold text-slate-600">
				Define an experiment on {loop}
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<label className="text-[11px] text-slate-600 space-y-1">
					<span>Name</span>
					<input value={id} onChange={(e) => setId(e.target.value)}
						placeholder="judge_panel_parity"
						className="w-full rounded-md border border-slate-300 px-2 py-1 text-[12px]" />
				</label>
				<label className="text-[11px] text-slate-600 space-y-1">
					<span>Metric — must be a key this loop emits</span>
					<input value={metric} onChange={(e) => setMetric(e.target.value)}
						placeholder="avg_question_score"
						className="w-full rounded-md border border-slate-300 px-2 py-1 text-[12px]" />
				</label>
			</div>
			<div className="space-y-1">
				<div className="flex items-center gap-3 text-[11px] text-slate-600">
					<span>Scope</span>
					{(["dataset", "cases"] as const).map((k) => (
						<label key={k} className="inline-flex items-center gap-1 cursor-pointer">
							<input type="radio" checked={scopeKind === k} onChange={() => setScopeKind(k)} />
							<span>{k === "dataset" ? "a dataset" : "specific cases"}</span>
						</label>
					))}
				</div>
				<input value={scope} onChange={(e) => setScope(e.target.value)}
					placeholder={scopeKind === "dataset" ? "cases_v1" : "Case_002, Case_019"}
					className="w-full rounded-md border border-slate-300 px-2 py-1 text-[12px]" />
				<div className="text-[10px] text-slate-400">
					Required: a threshold counted over an undefined population cannot be interpreted.
				</div>
			</div>
			{err && <div className="text-[11px] text-rose-600">{err}</div>}
			{done && <div className="text-[11px] text-emerald-700">{done}</div>}
			<div className="flex items-center gap-2">
				<button type="button" disabled={!ready || busy} onClick={submit}
					className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40">
					{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Define
				</button>
				<button type="button" onClick={() => setOpen(false)}
					className="text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
			</div>
		</div>
	);
}

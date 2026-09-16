// NewExperiment — create an experiment from the Experiments surface.
//
// The write endpoint and a form for it already existed. PromoteToExperiment
// (me.upsertExperiment) has shipped since the two-tab review — but its ONLY
// mount point is the Workflows surface, and only on a loop that feeds no
// experiment yet. So from the Experiments tab there was no create control at
// all: the empty state told people to hand-edit `experiments:` in the app
// config, which is the sequence that let quant-research ship `real_tape_rate`
// against rows that only ever carried `real_tape`.
//
// A user testing mbb-consultant on 2026-09-15 reported it as "希望可以 fork 一个
// 新环境, 但是尝试 3 次失败了, 没有增加实验环境的按钮" — no button to add an
// experiment. (Fork DID exist, behind a bare "⋯" on each card, and was also
// broken by a backend bug until 2026-09-16. Two causes, one symptom.)
//
// This is the same form and the same endpoint, mounted where the list is. The
// difference from PromoteToExperiment is the loop: on a workflow page the loop
// is the page, here it has to be chosen, because an experiment MUST name the
// loop it attaches to — the server refuses one that does not.

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { me, waitForIntent, type MeWorkflowRow } from "@/api/me";

export default function NewExperiment(
	{ app, onCreated }: { app: string; onCreated?: () => void },
) {
	const [open, setOpen] = useState(false);
	const [loops, setLoops] = useState<{ slug: string; name: string }[] | null>(null);
	const [loop, setLoop] = useState("");
	const [id, setId] = useState("");
	const [metric, setMetric] = useState("");
	const [scopeKind, setScopeKind] = useState<"dataset" | "cases">("dataset");
	const [scope, setScope] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	// The app's own loops, for the picker. Only fetched once the form opens —
	// the surface renders this control on every experiments view.
	useEffect(() => {
		if (!open || loops !== null) return;
		let live = true;
		me.listWorkflows("scheduled")
			.then((r) => {
				if (!live) return;
				const mine = (r.workflows || [])
					.filter((w: MeWorkflowRow) => w.app === app)
					.map((w: MeWorkflowRow) => ({
						slug: w.slug, name: w.name || w.slug.split(":")[1] || w.slug,
					}));
				setLoops(mine);
				if (mine.length === 1) setLoop(loopOf(mine[0].slug));
			})
			.catch(() => { if (live) setLoops([]); });
		return () => { live = false; };
	}, [open, app, loops]);

	// /me/workflows keys rows by "<app>:<loop>"; the spec wants the bare loop.
	function loopOf(slug: string) {
		const i = slug.indexOf(":");
		return i >= 0 ? slug.slice(i + 1) : slug;
	}

	const ready = id.trim() !== "" && loop !== "" && metric.trim() !== "" && scope.trim() !== "";

	async function submit() {
		if (!ready) return;
		setBusy(true); setErr(null);
		try {
			const r = await me.upsertExperiment(app, {
				id: id.trim(),
				loop,
				metric: { name: metric.trim(), higher_is_better: true },
				...(scopeKind === "dataset"
					? { dataset_id: scope.trim() }
					: { cases: scope.split(",").map((c) => c.trim()).filter(Boolean) }),
			});
			// 202 + an intent: the scheduler applies it. Report what the RUNNER
			// did, not that the queue accepted it — a queue acknowledgement read
			// as success is what kept users re-issuing a define that had in fact
			// already landed.
			const res = await waitForIntent(r.intent_id, { timeoutMs: 90_000 });
			const out = (res.result || {}) as Record<string, unknown>;
			if (out.ok === false) {
				setErr(String(out.error || "the scheduler refused it"));
				return;
			}
			// Warnings are the model-abstention guard: a seat that resolves
			// nowhere does not error, it abstains, and the panel shrinks
			// silently. Say them rather than showing a bare tick.
			const warns = (out.warnings as string[]) || [];
			setDone(warns.length ? `created — ${warns.join(" · ")}` : `created ${id.trim()}`);
			setId(""); setMetric(""); setScope("");
			onCreated?.();
			window.setTimeout(() => { setDone(null); setOpen(false); }, 2500);
		} catch (e: any) {
			setErr(e?.message || "could not create the experiment");
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white
					px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
			>
				<Plus className="h-3.5 w-3.5" /> New experiment
			</button>
		);
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
			<div className="text-[12px] font-medium text-slate-700">New experiment</div>

			<input
				value={id} onChange={(e) => setId(e.target.value)}
				placeholder="id — e.g. judge_panel_parity_test"
				className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
			/>

			<select
				value={loop} onChange={(e) => setLoop(e.target.value)}
				className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
			>
				<option value="">
					{loops === null ? "loading workflows…" : "workflow it attaches to…"}
				</option>
				{(loops || []).map((w) => (
					<option key={w.slug} value={loopOf(w.slug)}>{w.name}</option>
				))}
			</select>

			{/* Both required, and the reasons are not interchangeable. */}
			<input
				value={metric} onChange={(e) => setMetric(e.target.value)}
				placeholder="metric — a loop with no metric is a workflow, not an experiment"
				className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
			/>

			<div className="flex gap-1.5">
				<select
					value={scopeKind} onChange={(e) => setScopeKind(e.target.value as "dataset" | "cases")}
					className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
				>
					<option value="dataset">dataset</option>
					<option value="cases">cases</option>
				</select>
				<input
					value={scope} onChange={(e) => setScope(e.target.value)}
					placeholder={scopeKind === "dataset" ? "cases_v1" : "Case_001, Case_002"}
					className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
				/>
			</div>
			<div className="text-[10.5px] text-slate-500">
				Scope is required: min_samples counted over an undefined population cannot be
				interpreted. Success criteria are optional — leave them off to just collect
				results and look for patterns. Add arms after creating.
			</div>

			{err && <div className="text-[11px] text-rose-600">{err}</div>}
			{done && <div className="text-[11px] text-emerald-700">{done}</div>}

			<div className="flex gap-1.5">
				<button
					disabled={!ready || busy} onClick={submit}
					className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5
						text-[12px] font-medium text-white disabled:opacity-40"
				>
					{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create
				</button>
				<button
					onClick={() => { setOpen(false); setErr(null); }}
					className="rounded-lg px-2.5 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

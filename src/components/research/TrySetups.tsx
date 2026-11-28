// TrySetups — "Try setups" from a workflow's panel: an experiment on that
// workflow, one setup (version) per value of one input. It defines the
// experiment and nothing else — the runs start when the reader presses "Run
// the N untried versions" in the experiment's panel (manual dispatch).

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { me } from "@/api/me";
import type { AppSpec, SpecWorkflow } from "@/lib/app-spec";
import { humanMetric } from "@/lib/run-answer";
import { wfLabel } from "@/components/research/WorkflowPanel";
import { Button } from "@/components/ui/button";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** The form alone: the workflow panel shows it in place (its "New experiment"
 *  view, with Back), so a panel action never stacks a popup on the panel. */
export function TrySetupsBody({ app, wf, spec, onCreated }: {
	app: string; wf: SpecWorkflow; spec: AppSpec; onCreated: (experimentId: string) => void;
}) {
	const inputs = Object.keys(wf.inputs);
	const metrics = useMemo(() => {
		const out = wf.feedback.flatMap((f) => f.metrics.map((m) => ({ name: m.name, better: m.better })));
		if (!out.length && wf.primary) out.push({ name: wf.primary, better: "higher" });
		return out;
	}, [wf]);
	const [question, setQuestion] = useState("");
	const [input, setInput] = useState(inputs[0] ?? "");
	const [values, setValues] = useState("");
	const [metric, setMetric] = useState(metrics[0]?.name ?? "");
	const [busy, setBusy] = useState(false);
	const data = wf.data[0] || spec.data[0] || "";
	const vals = values.split(",").map((v) => v.trim()).filter(Boolean);
	const better = metrics.find((m) => m.name === metric)?.better ?? "higher";
	const ready = !!input && vals.length >= 2 && !!metric && !!data;
	const create = async () => {
		setBusy(true);
		const id = slug(`${wf.id}_${input}_${Date.now().toString(36).slice(-4)}`);
		try {
			await me.upsertExperiment(app, {
				id, loop: wf.id, kind: "arms",
				description: question.trim() || `Which ${input} works best for ${wfLabel(wf)}?`,
				metric: { name: metric, higher_is_better: better !== "lower" },
				dataset_id: data,
				arms: vals.map((v) => ({ id: slug(`${input}_${v}`) || v, [input]: v, description: `${input} = ${v}` })),
			} as Parameters<typeof me.upsertExperiment>[1]);
			window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["experiments"] } }));
			toast.success(`${vals.length} setups ready`, { description: "Nothing has run yet — press “Run the untried versions” when you're ready." });
			onCreated(id);
		} catch (e) {
			toast.error("Couldn't set up the experiment", { description: String((e as Error).message || e) });
		} finally { setBusy(false); }
	};
	return (
		<div className="space-y-3">
			<p className="text-caption text-ink-700">Same workflow, different settings: one setup per value. They're compared on one metric.</p>
			<label className="block space-y-1 text-caption">
				<span className="text-ink-700">The question (optional)</span>
				<input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Which ${input || "setting"} works best?`} className="h-8 w-full rounded-md border border-ink-200 bg-card px-2 text-caption" />
			</label>
			<div className="grid grid-cols-2 gap-2">
				<label className="block space-y-1 text-caption">
					<span className="text-ink-700">Vary</span>
					{inputs.length ? (
						<select value={input} onChange={(e) => setInput(e.target.value)} className="h-8 w-full rounded-md border border-ink-200 bg-card px-1.5 text-caption">
							{inputs.map((k) => <option key={k} value={k}>{k}</option>)}
						</select>
					) : (
						<input value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder="an input name" className="h-8 w-full rounded-md border border-ink-200 bg-card px-2 font-mono text-micro" />
					)}
				</label>
				<label className="block space-y-1 text-caption">
					<span className="text-ink-700">Judged on</span>
					{metrics.length ? (
						<select value={metric} onChange={(e) => setMetric(e.target.value)} className="h-8 w-full rounded-md border border-ink-200 bg-card px-1.5 text-caption">
							{metrics.map((m) => <option key={m.name} value={m.name}>{humanMetric(m.name).label} ({m.better} is better)</option>)}
						</select>
					) : (
						<input value={metric} onChange={(e) => setMetric(e.target.value.trim())} placeholder="a metric name" className="h-8 w-full rounded-md border border-ink-200 bg-card px-2 font-mono text-micro" />
					)}
				</label>
			</div>
			<label className="block space-y-1 text-caption">
				<span className="text-ink-700">Values, separated by commas</span>
				<input value={values} onChange={(e) => setValues(e.target.value)} placeholder="e.g. 8, 16, 32" aria-label="Values" className="h-8 w-full rounded-md border border-ink-200 bg-card px-2 font-mono text-micro" />
			</label>
			{!data && <p className="text-caption text-ember-700">This workflow names no data to run on — add it in its definition first.</p>}
			<div className="flex items-center gap-2 pt-1">
				<span className="text-micro text-ink-600">{vals.length ? `${vals.length} setups on ${data || "—"}` : "Two values or more"}</span>
				<Button size="sm" className="ml-auto" onClick={create} disabled={!ready || busy}>{busy ? "Setting up…" : "Set up the experiment"}</Button>
			</div>
		</div>
	);
}

// A portal: the panel that opens this sheet animates with a transform,
// which made it the containing block of this fixed overlay — the sheet was
// clipped inside the panel (round 10, 2026-11-28).
/** The popup form, for a caller with no panel to show it in. */
export default function TrySetups({ app, wf, spec, onClose, onCreated }: {
	app: string; wf: SpecWorkflow; spec: AppSpec; onClose: () => void; onCreated: (experimentId: string) => void;
}) {
	return createPortal((
		<div role="dialog" aria-label="Try setups" className="fixed inset-0 z-[7000] flex items-center justify-center bg-ink-900/30 p-4" onClick={onClose}>
			<div className="w-full max-w-md space-y-3 rounded-xl border border-ink-200 bg-card p-4 shadow-e3 map-panel-in" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center gap-2">
					<div>
						<div className="eyebrow text-plum-700">Try setups</div>
						<div className="text-title font-semibold text-ink-900">{wfLabel(wf)}</div>
					</div>
					<button type="button" onClick={onClose} aria-label="Close" className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100"><X className="h-4 w-4" /></button>
				</div>
				<TrySetupsBody app={app} wf={wf} spec={spec} onCreated={onCreated} />
			</div>
		</div>
	), document.body);
}

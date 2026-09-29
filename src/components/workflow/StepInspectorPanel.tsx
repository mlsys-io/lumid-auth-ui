// StepInspectorPanel — n8n's "click a node, see its data" panel.
// Renders the selected canvas step's run data: status, duration,
// output summary + full output JSON, error, and the prompt audit
// (sha + instructions preview). "Ask about this step" hands the exact
// step to the chat rail with structured grounding.

import { useState } from "react";
import { X, ChevronDown, ChevronRight, Clock, Fingerprint } from "lucide-react";
import type { CanvasStepRef } from "@/components/workflow/WorkflowCanvas";
import AskAbout from "@/components/AskAbout";
import { StatusBadge } from "@/components/ui/status-badge";

export default function StepInspectorPanel({
	step, app, loop, ts, onClose, defaultShowOutput = false, closeLabel, embedded = false,
}: {
	step: CanvasStepRef;
	app: string;
	loop: string;
	/** Selected run's timestamp (overlay source); empty when none. */
	ts?: string;
	onClose: () => void;
	/** Open the full output on mount — the run page's expanded step is there
	 *  precisely to show it, so hiding it behind a second click defeats it. */
	defaultShowOutput?: boolean;
	/** Accessible label for the close control (the run page uses "Collapse step"). */
	closeLabel?: string;
	/** Inside a step row that already shows the step's name and status: drop
	 *  the duplicate title/status and the nested card chrome (the run page
	 *  showed "engine_command · Succeeded" twice, one above the other). */
	embedded?: boolean;
}) {
	const [showOutput, setShowOutput] = useState(defaultShowOutput);
	const cs = step.cycleStep;
	const failed = cs?.ok === false;

	return (
		<div className={embedded ? "space-y-2.5" : "rounded-xl border border-slate-200 bg-white p-3 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150"}>
			<div className="flex items-center gap-2">
				{!embedded && <span className="text-[13px] font-semibold text-slate-900 truncate">{step.step_id}</span>}
				{!embedded && step.skill && <span className="text-[10.5px] text-slate-500 font-mono truncate">{step.skill}</span>}
				{embedded ? null : cs ? (
					<StatusBadge tone={failed ? "failing" : "ok"} label={failed ? "Failed" : "Succeeded"} />
				) : step.declared ? (
					<StatusBadge tone="idle" label="Declared (Pattern B — no per-step trace)" />
				) : (
					<StatusBadge tone="idle" label="No run selected" />
				)}
				<div className="ml-auto flex items-center gap-1.5">
					<AskAbout
						prompt={failed
							? `Why did the "${step.step_id}" step fail in this run, and how do I fix it?`
							: `Explain what the "${step.step_id}" step did in this run.`}
						context={{ app, loop, ...(ts ? { cycle: { app, loop, ts } } : {}) }}
						label="Ask about this step"
					/>
					<button onClick={onClose} aria-label={closeLabel || "Close"} title={closeLabel || "Close"} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
						<X className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>

			{cs?.duration_s !== undefined && (
				<div className="flex items-center gap-1 text-[11px] text-slate-500">
					<Clock className="w-3 h-3" /> {cs.duration_s.toFixed(2)}s
				</div>
			)}

			{cs?.error && (
				<pre className="text-[10.5px] font-mono text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2 whitespace-pre-wrap break-all max-h-36 overflow-auto">
					{cs.error}
				</pre>
			)}

			{cs?.output_summary && (
				<p className="text-[11.5px] text-slate-700 leading-relaxed">{cs.output_summary}</p>
			)}

			{cs?.output && (
				<div>
					<button
						onClick={() => setShowOutput((v) => !v)}
						className="inline-flex items-center gap-0.5 text-[10.5px] text-slate-500 hover:text-slate-800 transition-colors"
					>
						{showOutput ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
						full output
					</button>
					{showOutput && (
						<pre className="mt-1 text-[10px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 whitespace-pre-wrap break-all max-h-64 overflow-auto">
							{JSON.stringify(cs.output, null, 2)}
						</pre>
					)}
				</div>
			)}

			{cs?.prompt_sha && (
				<div className="flex items-start gap-1.5 text-[10.5px] text-slate-500 border-t border-slate-100 pt-2">
					<Fingerprint className="w-3 h-3 mt-0.5 flex-shrink-0" />
					<div className="min-w-0">
						<span className="font-mono">{cs.prompt_sha.slice(0, 12)}</span>
						{cs.prompt_preview && (
							<p className="text-slate-400 mt-0.5 line-clamp-3">{cs.prompt_preview}</p>
						)}
					</div>
				</div>
			)}

			{!cs && !step.declared && (
				<p className="text-[11px] text-slate-400 italic">
					Select a run (click a dot in the runs strip) to overlay its per-step data here.
				</p>
			)}
			{step.declared && (
				<p className="text-[11px] text-slate-400 italic">
					This skill is declared by the engine but runs inside the command — per-step traces aren't recorded for Pattern B.
				</p>
			)}
		</div>
	);
}

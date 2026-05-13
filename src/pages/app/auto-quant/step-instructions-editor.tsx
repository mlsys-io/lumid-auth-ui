// step-instructions-editor.tsx — reusable per-step instructions editor.
//
// Mirrors the dashboard inbox UI (CycleSummaryStepInstructions) but is
// designed to be embedded inline in the cycle-history row or any other
// context that has a loop + step list.

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendStepInstructions } from "./api";

export interface StepEditorStep {
	step_id: string;
	skill?: string;
	stage?: string;
	current_instructions?: string;
}

interface StepInstructionsEditorProps {
	app?: string;
	loop: string;
	messageId?: string;
	steps: StepEditorStep[];
	onSaved?: () => void;
}

export function StepInstructionsEditor({
	app = "auto-quant",
	loop,
	messageId,
	steps,
	onSaved,
}: StepInstructionsEditorProps) {
	const [values, setValues] = useState<Record<string, string>>({});
	const [persist, setPersist] = useState<Record<string, boolean>>({});
	const [submitting, setSubmitting] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const anyFilled = Object.values(values).some((v) => v.trim().length > 0);

	const submit = async () => {
		const entries = steps.filter((s) => values[s.step_id]?.trim());
		if (entries.length === 0) return;
		setSubmitting(true);
		try {
			await Promise.all(
				entries.map((s) =>
					sendStepInstructions(messageId || `${loop}-manual`, {
						step_id: s.step_id,
						instructions: values[s.step_id].trim(),
						scope: persist[s.step_id] ? "persist" : "next_cycle",
						loop,
						app,
					}),
				),
			);
			setValues({});
			setPersist({});
			toast.success(`${entries.length} instruction${entries.length === 1 ? "" : "s"} queued.`);
			onSaved?.();
		} catch (e) {
			toast.error(`Failed: ${String(e)}`);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="space-y-2">
			{steps.map((step) => {
				const isOpen = expanded.has(step.step_id);
				return (
					<div key={step.step_id} className="rounded border border-gray-100">
						<button
							type="button"
							className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-left hover:bg-gray-50 transition-colors"
							onClick={() =>
								setExpanded((prev) => {
									const n = new Set(prev);
									if (n.has(step.step_id)) n.delete(step.step_id); else n.add(step.step_id);
									return n;
								})
							}
						>
							<span className="text-gray-400">{isOpen ? "▾" : "▸"}</span>
							<code className="text-indigo-700 font-semibold">{step.step_id}</code>
							{step.skill && <span className="text-gray-400">/ {step.skill}</span>}
							{step.stage && (
								<span className="px-1 rounded bg-gray-100 text-gray-500 text-[10px]">{step.stage}</span>
							)}
							{!isOpen && step.current_instructions && (
								<span className="ml-auto text-[10px] text-blue-600 truncate max-w-[160px]">
									{step.current_instructions}
								</span>
							)}
							{!isOpen && values[step.step_id]?.trim() && (
								<span className="ml-auto text-[10px] text-indigo-500">draft…</span>
							)}
						</button>
						{isOpen && (
							<div className="px-2.5 pb-2.5">
								{step.current_instructions && (
									<div className="text-[10px] text-blue-700 border-l-2 border-blue-200 pl-1.5 mb-1.5 italic">
										Current: {step.current_instructions}
									</div>
								)}
								<textarea
									value={values[step.step_id] || ""}
									onChange={(e) =>
										setValues((prev) => ({ ...prev, [step.step_id]: e.target.value }))
									}
									placeholder={`Nudge this step (e.g. "be more conservative")`}
									className="w-full text-xs rounded border border-gray-200 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
									rows={2}
									disabled={submitting}
								/>
								<label className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground cursor-pointer">
									<input
										type="checkbox"
										checked={persist[step.step_id] || false}
										onChange={(e) =>
											setPersist((prev) => ({ ...prev, [step.step_id]: e.target.checked }))
										}
										disabled={submitting}
										className="w-3 h-3"
									/>
									Apply forever (writes to xpcloud.yaml)
								</label>
							</div>
						)}
					</div>
				);
			})}
			{anyFilled && (
				<Button
					size="sm"
					disabled={submitting}
					onClick={submit}
					className="h-7 px-3 text-xs mt-1"
				>
					{submitting ? "Sending…" : "Send replies"}
				</Button>
			)}
		</div>
	);
}

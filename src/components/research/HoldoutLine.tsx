// HoldoutLine — "Held-out data: read only at Robustness · 1 of 40 versions
// have read it · 47 trials so far", and a warning when a version re-read it or
// the spec lets a non-final step read it. Generic; logic in lib/holdout.ts.
// Renders nothing for a workflow with no holdout step.

import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import type { MeExperimentRow } from "@/api/me";
import { holdoutState, holdoutStepsFromText, holdoutWords } from "@/lib/holdout";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";

export default function HoldoutLine({ specText, workflow, steps, rows, label }: {
	specText: string;
	workflow: string;
	steps: string[];
	rows: MeExperimentRow[] | null;
	label?: (v: string) => string;
}) {
	const words = useMemo(() => {
		const hs = holdoutStepsFromText(specText)[workflow] ?? [];
		if (!hs.length) return null;
		return holdoutWords(holdoutState({ steps, holdoutSteps: hs, rows: rows ?? [] }), label);
	}, [specText, workflow, steps, rows, label]);
	if (!words || (!words.text && !words.warn)) return null;
	const warn = TONES.attention;
	return (
		<div className="space-y-0.5" data-testid="holdout-line">
			{words.text && (
				<p className="flex items-center gap-1.5 text-micro text-ink-700">
					<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden /> {words.text}
				</p>
			)}
			{words.warn && (
				<p className={cn("flex items-start gap-1.5 text-micro", warn.text)} role="note">
					<warn.Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", warn.icon)} aria-hidden /> {words.warn}
				</p>
			)}
		</div>
	);
}

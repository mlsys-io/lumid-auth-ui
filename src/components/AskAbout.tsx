// AskAbout — the "ask about this" affordance. Observability surfaces
// mount it next to a run / step / experiment / memory; clicking hands
// the chat rail a prefilled prompt PLUS the structured ViewingContext
// override, so the agent grounds "this" without the user restating it.

import { MessagesSquare } from "lucide-react";
import type { ViewingContext } from "@/components/StudioContext";
import { cn } from "@/lib/utils";

export default function AskAbout({
	prompt, context, label = "Ask about this", autosend = true, className,
}: {
	/** The chat prompt to dispatch. */
	prompt: string;
	/** Structured grounding (app/loop/cycle/selection) for this turn. */
	context?: Partial<ViewingContext>;
	label?: string;
	/** false = prefill the input instead of sending. */
	autosend?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				window.dispatchEvent(new CustomEvent("studio:ask", {
					detail: { prompt, autosend, context },
				}));
			}}
			className={cn(
				"inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border border-gold-200/70 bg-gold-50/60 text-gold-700 hover:bg-gold-100 transition-colors",
				className,
			)}
			title={prompt}
		>
			<MessagesSquare className="w-3 h-3" />
			{label}
		</button>
	);
}

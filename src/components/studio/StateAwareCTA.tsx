// StateAwareCTA — full-width primary button whose label + style adapt to an
// install/action lifecycle state. From the pre-migration marketplace card,
// where the CTA dominates the card bottom (vs. a tiny header button).

import { Plus, Check, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CTAState = "idle" | "installing" | "installed" | "failed";

export function StateAwareCTA({
	state,
	onAction,
	idleLabel = "Add to my account",
	doneLabel = "Added · Open",
	className,
}: {
	state: CTAState;
	onAction: () => void;
	idleLabel?: string;
	doneLabel?: string;
	className?: string;
}) {
	const base = "lumen-press w-full inline-flex items-center justify-center gap-1.5 px-3 h-9 text-meta font-medium rounded-lg transition-colors duration-120";
	switch (state) {
		case "installed":
			return (
				<button onClick={onAction} className={cn(base, "border border-gold-300 bg-gold-50 text-gold-700 hover:bg-gold-100", className)}>
					<Check className="w-3.5 h-3.5" /> {doneLabel} <ArrowRight className="w-3.5 h-3.5" />
				</button>
			);
		case "installing":
			return (
				<button disabled className={cn(base, "border border-ink-200 bg-ink-50 text-ink-600 cursor-wait", className)}>
					<Loader2 className="w-3.5 h-3.5 animate-spin" /> Setting up…
				</button>
			);
		case "failed":
			return (
				<button onClick={onAction} className={cn(base, "border border-brick-300 bg-brick-50 text-brick-700 hover:bg-brick-100", className)}>
					<AlertCircle className="w-3.5 h-3.5" /> Couldn't add · Retry
				</button>
			);
		default:
			return (
				// Lumen: a QUIET paper button. On a grid this CTA repeats on every
				// card, and nine heavy gold gradients were the loudest thing on the
				// page. The bronze outline is saved for the state that matters:
				// "Added · Open".
				<button onClick={onAction} className={cn(base, "border border-border bg-card text-ink-900 shadow-e1 hover:border-ink-300 hover:bg-ink-50", className)}>
					<Plus className="w-3.5 h-3.5" /> {idleLabel}
				</button>
			);
	}
}

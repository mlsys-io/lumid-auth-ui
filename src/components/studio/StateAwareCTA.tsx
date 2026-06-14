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
	const base = "w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition";
	switch (state) {
		case "installed":
			return (
				<button onClick={onAction} className={cn(base, "border border-gold-300 bg-gold-50 text-gold-700 hover:bg-gold-100", className)}>
					<Check className="w-3.5 h-3.5" /> {doneLabel} <ArrowRight className="w-3.5 h-3.5" />
				</button>
			);
		case "installing":
			return (
				<button disabled className={cn(base, "border border-slate-200 bg-slate-50 text-slate-500 cursor-wait", className)}>
					<Loader2 className="w-3.5 h-3.5 animate-spin" /> Setting up…
				</button>
			);
		case "failed":
			return (
				<button onClick={onAction} className={cn(base, "border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100", className)}>
					<AlertCircle className="w-3.5 h-3.5" /> Couldn't add · Retry
				</button>
			);
		default:
			return (
				<button onClick={onAction} className={cn(base, "bg-gradient-to-br from-gold-500 to-gold-600 text-white shadow-sm shadow-gold-100 hover:shadow-md hover:from-gold-600 hover:to-gold-700", className)}>
					<Plus className="w-3.5 h-3.5" /> {idleLabel}
				</button>
			);
	}
}

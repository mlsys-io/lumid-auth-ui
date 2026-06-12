// FailureCard — the actionable replacement for the raw mono error
// strip. Triage classifies the error (lib/failure-triage); the card
// shows a human label + one-sentence explanation + a CTA (navigate to
// a connect page, or hand the diagnosis to the chat rail). The raw
// error stays available behind a collapsible for debugging.

import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, ChevronDown, ChevronRight, MessagesSquare } from "lucide-react";
import { triageFailure } from "@/lib/failure-triage";
import type { ViewingContext } from "@/components/StudioContext";
import { cn } from "@/lib/utils";

export default function FailureCard({
	error, app, loop, compact = false, className,
}: {
	error: string;
	app?: string;
	loop?: string;
	/** Tight one-line variant for rails/lists. */
	compact?: boolean;
	className?: string;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const t = triageFailure(error, app, loop);

	const fireAsk = (ask: string) => {
		const context: Partial<ViewingContext> = app ? { app, loop } : {};
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: { prompt: ask, autosend: true, context },
		}));
	};

	const cta = t.cta && (
		t.cta.to ? (
			<Link
				to={t.cta.to}
				className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex-shrink-0"
			>
				{t.cta.label}
				<ArrowRight className="w-3 h-3" />
			</Link>
		) : (
			<button
				onClick={() => t.cta?.ask && fireAsk(t.cta.ask)}
				className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex-shrink-0"
			>
				<MessagesSquare className="w-3 h-3" />
				{t.cta.label}
			</button>
		)
	);

	if (compact) {
		return (
			<div className={cn("flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-1.5", className)}>
				<AlertCircle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
				<span className="text-[11px] font-medium text-rose-800 truncate flex-1" title={t.explanation}>
					{t.label}
				</span>
				{cta}
			</div>
		);
	}

	return (
		<div className={cn("rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5 space-y-1.5", className)}>
			<div className="flex items-center gap-2">
				<AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
				<span className="text-xs font-semibold text-rose-800 flex-1">{t.label}</span>
				{cta}
			</div>
			<p className="text-[11px] text-rose-700/90 leading-relaxed pl-6">{t.explanation}</p>
			<button
				onClick={() => setShowRaw((v) => !v)}
				className="inline-flex items-center gap-0.5 pl-6 text-[10px] text-rose-500 hover:text-rose-700 transition-colors"
			>
				{showRaw ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
				raw error
			</button>
			{showRaw && (
				<pre className="ml-6 text-[10px] font-mono text-rose-800 bg-rose-100/60 rounded-lg px-2 py-1.5 whitespace-pre-wrap break-all max-h-32 overflow-auto">
					{error}
				</pre>
			)}
		</div>
	);
}

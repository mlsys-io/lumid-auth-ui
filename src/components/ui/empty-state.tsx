// EmptyState — teaching empty states (fresh-user principle: an empty
// surface explains what will appear here and offers the next action,
// instead of rendering a blank box).
//
// The action either navigates (`to`) or hands the user to the chat rail
// (`ask` dispatches a studio:ask event — chat is the action surface).

import { Link } from "react-router-dom";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
	icon: Icon, title, body, actionLabel, to, ask, className,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	title: string;
	/** One or two sentences of teaching copy — what shows up here and why. */
	body?: string;
	actionLabel?: string;
	/** Navigate on action. */
	to?: string;
	/** Or: prompt the chat rail on action (studio:ask, autosend). */
	ask?: string;
	className?: string;
}) {
	const action = actionLabel && (to || ask);
	const inner = (
		<>
			{actionLabel}
			<ArrowRight className="w-3 h-3" />
		</>
	);
	return (
		<div className={cn(
			"rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-5 py-6 text-center",
			className,
		)}>
			{Icon && (
				<div className="mx-auto w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-400 flex items-center justify-center mb-2.5">
					<Icon className="w-4 h-4" />
				</div>
			)}
			<div className="text-[13px] font-medium text-slate-700">{title}</div>
			{body && <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">{body}</p>}
			{action && (
				<div className="mt-3">
					{to ? (
						<Link
							to={to}
							className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 hover:text-emerald-800 transition-colors"
						>
							{inner}
						</Link>
					) : (
						<button
							onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: ask, autosend: true } }))}
							className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 hover:text-emerald-800 transition-colors"
						>
							<MessagesSquare className="w-3 h-3" />
							{inner}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

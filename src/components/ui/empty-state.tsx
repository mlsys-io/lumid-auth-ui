// EmptyState — teaching empty states (fresh-user principle: an empty
// surface explains what will appear here and offers the next action,
// instead of rendering a blank box).
//
// Lumen v2: optionally leads with a Strands illustration (`art`, from
// src/components/illustrations) that draws itself in; falls back to a lucide
// `icon` in a soft tile. The action either navigates (`to`) or hands the user
// to the chat rail (`ask` dispatches a studio:ask event — chat is the action
// surface).

import { Link } from "react-router-dom";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
	icon: Icon, art, title, body, actionLabel, to, ask, onAction, size = "md", framed = true, className,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	/** A Strands scene (preferred over `icon`). */
	art?: React.ReactNode;
	title: string;
	/** One or two sentences of teaching copy — what shows up here and why. */
	body?: React.ReactNode;
	actionLabel?: string;
	/** Navigate on action. */
	to?: string;
	/** Or: prompt the chat rail on action (studio:ask; pre-fills the composer). */
	ask?: string;
	/** Or: run a handler. */
	onAction?: () => void;
	size?: "sm" | "md";
	/** Dashed paper frame (default) or bare, for use inside an existing card. */
	framed?: boolean;
	className?: string;
}) {
	const action = actionLabel && (to || ask || onAction);
	const btn =
		"lumen-press inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 h-8 text-meta font-medium text-ink-800 shadow-e1 transition-colors duration-120 hover:border-ink-300 hover:bg-ink-50";
	const inner = (
		<>
			{actionLabel}
			<ArrowRight className="w-3.5 h-3.5 text-ink-500" />
		</>
	);
	return (
		<div
			className={cn(
				"animate-lumen-rise text-center",
				framed && "rounded-xl border border-dashed border-ink-200 bg-ink-50/50",
				size === "md" ? "px-6 py-10" : "px-5 py-6",
				className,
			)}
		>
			{art ? (
				<div className={cn("mx-auto text-ink-300", size === "md" ? "mb-4 w-40" : "mb-3 w-28")}>{art}</div>
			) : (
				Icon && (
					<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-ink-500 shadow-e1">
						<Icon className="w-[18px] h-[18px]" />
					</div>
				)
			)}
			<div className={cn("font-medium text-ink-900", size === "md" ? "text-title" : "text-body")}>{title}</div>
			{body && (
				<p className={cn("mx-auto mt-1.5 max-w-md text-ink-600 text-pretty", size === "md" ? "text-body" : "text-meta")}>
					{body}
				</p>
			)}
			{action && (
				<div className="mt-4">
					{to ? (
						<Link to={to} className={btn}>
							{inner}
						</Link>
					) : ask ? (
						<button
							type="button"
							onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: ask } }))}
							className={btn}
						>
							<MessagesSquare className="w-3.5 h-3.5 text-ink-500" />
							{inner}
						</button>
					) : (
						<button type="button" onClick={onAction} className={btn}>
							{inner}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

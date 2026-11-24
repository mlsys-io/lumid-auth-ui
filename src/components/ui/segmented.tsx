// Segmented — a compact single-choice control for FILTERS (state, kind,
// window). Use underline tabs (PageHeader `tabs`) for navigation between
// views, and this for narrowing what one view shows. The active thumb slides
// (CSS transform) rather than snapping.

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
	value: T;
	label: React.ReactNode;
	/** Optional count, rendered as a quiet tabular number. */
	count?: number;
	title?: string;
}

export function Segmented<T extends string>({
	options, value, onChange, size = "md", className, "aria-label": ariaLabel,
}: {
	options: SegmentedOption<T>[];
	value: T;
	onChange: (v: T) => void;
	size?: "sm" | "md";
	className?: string;
	"aria-label"?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
	useLayoutEffect(() => {
		const root = ref.current;
		const el = root?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
		if (!root || !el) return setThumb(null);
		setThumb({ x: el.offsetLeft, w: el.offsetWidth });
	}, [value, options.length]);
	return (
		<div
			ref={ref}
			role="radiogroup"
			aria-label={ariaLabel}
			className={cn(
				"relative inline-flex items-center rounded-lg bg-ink-100/80 p-[3px]",
				size === "sm" ? "h-8" : "h-9",
				className,
			)}
		>
			{thumb && (
				<span
					aria-hidden
					className="absolute top-[3px] bottom-[3px] left-0 rounded-md border border-border/70 bg-card shadow-e1 transition-[transform,width] duration-240 ease-lumen"
					style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
				/>
			)}
			{options.map((o) => {
				const on = o.value === value;
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={on}
						data-value={o.value}
						title={o.title}
						onClick={() => onChange(o.value)}
						className={cn(
							"relative z-[1] inline-flex h-full items-center gap-1.5 rounded-md px-3 font-medium outline-none transition-colors duration-180",
							size === "sm" ? "text-caption" : "text-meta",
							on ? "text-foreground" : "text-ink-600 hover:text-ink-900",
						)}
					>
						{o.label}
						{o.count != null && (
							<span className={cn("tabular-nums font-normal", on ? "text-ink-700" : "text-ink-600")}>{o.count}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

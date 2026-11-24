// DataTable — the one dense-table look for Studio (Lumen): hairline rows,
// sticky header, tabular numbers, a quiet hover. Structural only — callers
// own their columns and cells — so the ~2.9k-line /code page and the admin
// tables can adopt it without changing their data code.

import { cn } from "@/lib/utils";

export function DataTable({ className, children, ...props }: React.ComponentProps<"table">) {
	return (
		<div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card shadow-e1">
			<table className={cn("w-full border-collapse text-meta tabular-nums", className)} {...props}>
				{children}
			</table>
		</div>
	);
}

export function DTHead({ className, ...props }: React.ComponentProps<"thead">) {
	return <thead className={cn("sticky top-0 z-[1] bg-ink-50/95 backdrop-blur-[2px]", className)} {...props} />;
}

export function DTh({ className, align, ...props }: React.ComponentProps<"th"> & { align?: "left" | "right" | "center" }) {
	return (
		<th
			className={cn(
				"h-9 border-b border-border px-3 text-micro font-medium uppercase tracking-[0.06em] text-ink-600 whitespace-nowrap",
				align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
				className,
			)}
			{...props}
		/>
	);
}

export function DTr({ className, ...props }: React.ComponentProps<"tr">) {
	return <tr className={cn("border-b border-border/70 last:border-0 transition-colors duration-120 hover:bg-ink-50/70", className)} {...props} />;
}

export function DTd({ className, align, ...props }: React.ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
	return (
		<td
			className={cn(
				"px-3 py-2 align-middle text-ink-800",
				align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
				className,
			)}
			{...props}
		/>
	);
}

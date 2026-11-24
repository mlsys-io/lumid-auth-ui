// GradientIcon — the per-app avatar on install + prompt surfaces.
//
// Lumen (2026-11): the name is kept so callers don't churn, but the six
// hash-picked COOL gradients (lagoon, plum, "gold→lagoon"…) with two white
// initials are gone — they were most of the "why is the Library blue?" drift.
// It now renders the app's StrandAvatar: the same deterministic strand glyph
// the app wears in the sidebar, its Recent threads and its workspace header.
// With an explicit `icon`, it draws that glyph on a warm ink tile instead.

import { StrandAvatar } from "@/components/illustrations/StrandAvatar";
import { cn } from "@/lib/utils";

const PX = { sm: 32, md: 40, lg: 48 } as const;

/** @deprecated kept for API compatibility; Lumen avatars are not gradients. */
export function gradientTint(_name: string): string {
	return "from-ink-100 to-ink-100";
}

export function GradientIcon({
	name,
	icon: Icon,
	size = "md",
	className,
}: {
	name: string;
	icon?: React.ComponentType<{ className?: string }>;
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	if (!Icon) return <StrandAvatar slug={name} size={PX[size]} className={className} title={name} />;
	const glyph = size === "lg" ? "w-5 h-5" : size === "sm" ? "w-4 h-4" : "w-[18px] h-[18px]";
	return (
		<div
			className={cn("shrink-0 rounded-lg grid place-items-center bg-ink-100 text-ink-700 ring-1 ring-inset ring-ink-200", className)}
			style={{ width: PX[size], height: PX[size] }}
		>
			<Icon className={glyph} />
		</div>
	);
}

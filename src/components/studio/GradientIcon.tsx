// GradientIcon — hash-tinted gradient avatar (deterministic per name).
// Lifted from the pre-migration app-revamp marketplace card so install +
// prompt surfaces share one visual language. Six-palette rotation keyed by
// a stable hash of the name, so the same app always gets the same tint with
// no server-side color config.

import { cn } from "@/lib/utils";

// Cohesive cool/jewel palette anchored on the emerald brand — deterministic
// per-app variety without clashing candy tones (no hot pink / fuchsia / amber).
const PALETTE = [
	"from-emerald-500 to-teal-600",
	"from-teal-500 to-cyan-600",
	"from-sky-500 to-blue-600",
	"from-cyan-500 to-sky-600",
	"from-indigo-500 to-blue-600",
	"from-violet-500 to-indigo-600",
];

export function gradientTint(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return PALETTE[Math.abs(hash) % PALETTE.length];
}

// label defaults to the first two chars of the name (uppercased). Pass an
// `icon` to render a lucide glyph instead of initials.
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
	const dims = size === "lg" ? "w-12 h-12 text-base" : size === "sm" ? "w-8 h-8 text-[11px]" : "w-10 h-10 text-sm";
	const glyph = size === "lg" ? "w-5 h-5" : size === "sm" ? "w-4 h-4" : "w-[18px] h-[18px]";
	return (
		<div className={cn(
			"shrink-0 rounded-lg bg-gradient-to-br grid place-items-center text-white font-semibold shadow-inner",
			dims, gradientTint(name), className,
		)}>
			{Icon ? <Icon className={glyph} /> : name.slice(0, 2).toUpperCase()}
		</div>
	);
}

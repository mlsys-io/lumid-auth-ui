// StatusBadge — the one way to render a health/status chip.
// Takes either a loops-health `status` string or an explicit tone.

import { ACTIONABLE, TONES, TONE_LABEL, statusTone, type ToneKey } from "@/lib/tones";
import { cn } from "@/lib/utils";

export function StatusBadge({
	status, tone, label, pulse = false, className,
}: {
	/** Backend loops-health status (never|ok|failing|stale|manual). */
	status?: string;
	/** Explicit tone override; wins over `status`. */
	tone?: ToneKey;
	/** Custom label; defaults to the tone's human label. */
	label?: string;
	/** Animate the dot (running states). */
	pulse?: boolean;
	className?: string;
}) {
	const key: ToneKey = tone ?? statusTone(status);
	const t = TONES[key];
	// Failing / attention carry a glyph so the state never rests on colour
	// alone (ember vs brick is the hardest pair for protan/deutan readers).
	const glyph = ACTIONABLE.has(key);
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 px-2 py-0.5 text-micro font-medium rounded-full border",
				t.bg, t.text, t.border, (pulse || key === "running") && "lumen-sweep", className,
			)}
		>
			{glyph ? (
				<t.Icon className={cn("w-3 h-3 -ml-0.5", t.icon)} aria-hidden />
			) : (
				<span className="relative inline-flex">
					<span className={cn("w-1.5 h-1.5 rounded-full", t.dot, pulse && "animate-lumen-breathe")} />
				</span>
			)}
			{label ?? TONE_LABEL[key]}
		</span>
	);
}

/** Bare status dot for dense lists (workflow rows, sidebar). */
export function StatusDot({
	status, tone, pulse = false, className, title,
}: {
	status?: string;
	tone?: ToneKey;
	pulse?: boolean;
	className?: string;
	title?: string;
}) {
	const key: ToneKey = tone ?? statusTone(status);
	const t = TONES[key];
	return (
		<span className={cn("relative inline-flex flex-shrink-0", className)} title={title ?? TONE_LABEL[key]}>
			<span className={cn("w-2 h-2 rounded-full", t.dot, pulse && "running-pulse")} />
		</span>
	);
}

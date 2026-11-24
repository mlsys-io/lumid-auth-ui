// Strands — the Studio illustration family.
//
// Rules (lumid_ui/CLAUDE.md § Design system):
//  - 160x120 canvas, 1.5px round-capped strokes, no fills except small nodes.
//  - Strokes are currentColor (set text-ink-300 on the parent) plus ONE bronze
//    highlight strand per scene — the same metallic bronze as the StrandMark.
//  - Every stroke draws itself in on mount (pathLength=100 + .strand-draw,
//    staggered by --i); nodes pop in after their strand; the whole scene then
//    drifts very slightly. Static under prefers-reduced-motion.
//  - Each scene is a picture of what WILL be here, not a sad face: an orbit
//    waiting for a run, a tray waiting for drafts, dots waiting to be learned.

import { cn } from "@/lib/utils";
import * as palette from "@/styles/palette";

const BRONZE = palette.gold["500"];

function Scene({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
	return (
		<svg
			viewBox="0 0 160 120"
			className={cn("strand-draw block h-auto w-full", className)}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
		>
			<g className="strand-drift">{children}</g>
		</svg>
	);
}

/** A drawn strand. `hl` = the one bronze highlight per scene. */
function P({ d, i = 0, hl, dash }: { d: string; i?: number; hl?: boolean; dash?: boolean }) {
	if (dash)
		return <path d={d} strokeDasharray="2 5" opacity={0.7} data-pop="" style={{ ["--i" as string]: i }} />;
	return (
		<path
			d={d}
			pathLength={100}
			data-draw=""
			stroke={hl ? BRONZE : undefined}
			strokeWidth={hl ? 1.75 : undefined}
			style={{ ["--i" as string]: i }}
		/>
	);
}

/** A node that pops in after its strand. */
function N({ cx, cy, r = 3, i = 0, hl, ring }: { cx: number; cy: number; r?: number; i?: number; hl?: boolean; ring?: boolean }) {
	return (
		<circle
			cx={cx}
			cy={cy}
			r={r}
			data-pop=""
			fill={ring ? palette.surface.card : hl ? BRONZE : "currentColor"}
			stroke={ring ? (hl ? BRONZE : "currentColor") : "none"}
			style={{ ["--i" as string]: i }}
		/>
	);
}

/** Runs: an orbit with a resting node — "nothing has run in this window yet". */
export function EmptyRuns({ className }: { className?: string }) {
	return (
		<Scene className={className} label="An orbit waiting for a run">
			<P i={0} d="M28 62 C 28 40, 132 40, 132 62 C 132 84, 28 84, 28 62 Z" />
			<P i={1} d="M44 62 C 44 48, 116 48, 116 62 C 116 76, 44 76, 44 62 Z" />
			<P i={2} hl d="M14 62 C 14 30, 146 30, 146 62 C 146 94, 14 94, 14 62" />
			<N i={4} cx={80} cy={62} r={4.5} ring />
			<N i={6} cx={146} cy={62} r={3.5} hl />
			<P dash i={7} d="M80 22 L 80 34" />
			<P dash i={8} d="M80 90 L 80 102" />
		</Scene>
	);
}

/** Inbox / drafts: strands settling into a tray — "all caught up". */
export function EmptyInbox({ className }: { className?: string }) {
	return (
		<Scene className={className} label="Strands settling into a tray">
			<P i={0} d="M30 70 L 42 96 L 118 96 L 130 70" />
			<P i={1} d="M30 70 L 58 70 C 62 70, 63 80, 70 80 L 90 80 C 97 80, 98 70, 102 70 L 130 70" />
			<P i={2} d="M56 18 C 56 36, 70 40, 70 60" />
			<P i={3} hl d="M80 12 C 80 34, 80 44, 80 62" />
			<P i={4} d="M104 18 C 104 36, 90 40, 90 60" />
			<N i={7} cx={80} cy={66} r={3.5} hl />
		</Scene>
	);
}

/** Knowledge: scattered points gathered by strands into a small graph. */
export function EmptyKnowledge({ className }: { className?: string }) {
	return (
		<Scene className={className} label="Scattered points gathering into a graph">
			<N i={0} cx={22} cy={30} r={2.5} />
			<N i={1} cx={30} cy={84} r={2.5} />
			<N i={2} cx={16} cy={58} r={2.5} />
			<N i={3} cx={44} cy={46} r={2.5} />
			<P i={2} d="M22 30 C 60 30, 70 46, 104 52" />
			<P i={3} hl d="M16 58 C 50 58, 70 60, 104 60" />
			<P i={4} d="M30 84 C 64 84, 74 70, 104 68" />
			<P i={5} d="M112 60 L 140 38 M 112 60 L 142 82 M 140 38 L 142 82" />
			<N i={7} cx={108} cy={60} r={6} ring hl />
			<N i={8} cx={140} cy={38} r={4} ring />
			<N i={9} cx={142} cy={82} r={4} ring />
		</Scene>
	);
}

/** No matches: a strand passing through a lens. */
export function NoMatches({ className }: { className?: string }) {
	return (
		<Scene className={className} label="A strand passing through a lens">
			<P i={0} d="M10 44 C 40 44, 50 54, 72 54 C 94 54, 104 40, 150 40" />
			<P i={1} hl d="M10 62 C 40 62, 52 62, 72 62 C 92 62, 110 70, 150 70" />
			<P i={2} d="M10 80 C 40 80, 50 70, 72 70 C 94 70, 104 92, 150 92" />
			<P i={3} d="M72 32 a 28 28 0 1 1 -0.1 0 Z" />
			<P i={5} d="M92 82 L 108 100" />
		</Scene>
	);
}

/** Error: a bundle of strands that frays — "something broke on the way". */
export function ErrorFrayed({ className }: { className?: string }) {
	return (
		<Scene className={className} label="A bundle of strands fraying apart">
			<P i={0} d="M10 50 C 40 50, 60 52, 78 52 C 96 52, 108 34, 140 26" />
			<P i={1} d="M10 58 C 40 58, 60 58, 80 58 C 100 58, 116 50, 146 50" />
			<P i={2} d="M10 66 C 40 66, 60 64, 80 64 C 100 64, 114 78, 144 82" />
			<P i={3} hl d="M10 74 C 40 74, 56 72, 70 72" />
			<P i={4} hl d="M88 80 C 100 84, 108 96, 126 104" />
			<P dash i={6} d="M72 73 L 86 79" />
		</Scene>
	);
}

/** Data warehouse: strands flowing through stacked discs — "pick a table". */
export function PickATable({ className }: { className?: string }) {
	return (
		<Scene className={className} label="Strands flowing through stacked data discs">
			<P i={0} d="M58 30 C 58 22, 102 22, 102 30 C 102 38, 58 38, 58 30 Z" />
			<P i={1} d="M58 30 L 58 90 C 58 98, 102 98, 102 90 L 102 30" />
			<P i={2} d="M58 50 C 58 58, 102 58, 102 50" />
			<P i={3} d="M58 70 C 58 78, 102 78, 102 70" />
			<P i={4} d="M8 46 C 30 46, 40 52, 58 52" />
			<P i={5} hl d="M102 62 C 122 62, 130 54, 152 54" />
			<P i={6} d="M8 76 C 30 76, 40 72, 58 72" />
			<N i={9} cx={152} cy={54} r={3.5} hl />
		</Scene>
	);
}

/** Studies / experiments: one strand diverging into parallel branches. */
export function EmptyStudies({ className }: { className?: string }) {
	return (
		<Scene className={className} label="One strand diverging into parallel branches">
			<P i={0} d="M12 60 C 40 60, 52 60, 64 60" />
			<P i={1} d="M64 60 C 84 60, 90 32, 140 32" />
			<P i={2} hl d="M64 60 C 90 60, 110 60, 140 60" />
			<P i={3} d="M64 60 C 84 60, 90 88, 140 88" />
			<N i={5} cx={64} cy={60} r={3.5} />
			<N i={6} cx={140} cy={32} r={4} ring />
			<N i={7} cx={140} cy={60} r={4} ring hl />
			<N i={8} cx={140} cy={88} r={4} ring />
		</Scene>
	);
}

/** Apps welcome: a strand branching into tiles — "install your first app". */
export function WelcomeApps({ className }: { className?: string }) {
	return (
		<Scene className={className} label="A strand branching into app tiles">
			<P i={0} d="M10 62 C 30 62, 40 62, 52 62" />
			<P i={1} d="M52 62 C 66 62, 70 34, 88 34" />
			<P i={2} hl d="M52 62 C 70 62, 76 62, 88 62" />
			<P i={3} d="M52 62 C 66 62, 70 90, 88 90" />
			<P i={4} d="M90 24 h 20 a 6 6 0 0 1 6 6 v 8 a 6 6 0 0 1 -6 6 h -20 a 6 6 0 0 1 -6 -6 v -8 a 6 6 0 0 1 6 -6 Z" />
			<P i={5} hl d="M90 52 h 20 a 6 6 0 0 1 6 6 v 8 a 6 6 0 0 1 -6 6 h -20 a 6 6 0 0 1 -6 -6 v -8 a 6 6 0 0 1 6 -6 Z" />
			<P i={6} d="M90 80 h 20 a 6 6 0 0 1 6 6 v 8 a 6 6 0 0 1 -6 6 h -20 a 6 6 0 0 1 -6 -6 v -8 a 6 6 0 0 1 6 -6 Z" />
			<P dash i={8} d="M124 62 L 148 62" />
		</Scene>
	);
}

/** Not found: a strand that wanders off the page and stops. */
export function NotFound({ className }: { className?: string }) {
	return (
		<Scene className={className} label="A strand that wanders off and stops">
			<P i={0} d="M12 84 C 36 84, 40 40, 64 40 C 86 40, 84 76, 104 76" />
			<P i={1} hl d="M12 92 C 40 92, 46 50, 66 50 C 84 50, 86 84, 108 84" />
			<P dash i={4} d="M112 82 C 124 78, 130 68, 136 56" />
			<N i={6} cx={140} cy={48} r={4} ring />
		</Scene>
	);
}

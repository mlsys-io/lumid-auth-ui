// StrandMark — the Lumid spiral, redrawn as SVG.
//
// The raster /auth/spiral.png is a ribbon of parallel bronze strands twisting
// through an S. Here each strand is the same S-curve translated along the
// ribbon's normal, stroked with a metallic bronze gradient — so the mark is
// crisp at any size and, unlike a PNG, can MOVE:
//
//   state="idle"      static (default)
//   state="draw"      the strands draw themselves in, staggered (hero, first paint)
//   state="thinking"  a short bright glint runs along each strand (streaming)
//
// Motion is pure CSS (globals.css .strand-draw / .strand-think) so the shell
// can use it without pulling framer-motion into the eager chunk; it is static
// under prefers-reduced-motion.

import { useId } from "react";
import { cn } from "@/lib/utils";
import * as palette from "@/styles/palette";

const G = palette.gold;

// One Z-ribbon turn (top-left -> right bulge -> diagonal -> bottom-right, as in
// the PNG), in a 40x56 box. Strand i is this path translated by i * STEP.
const S = "M5 5 C 23 2.5, 32.5 10.5, 28.5 20.5 C 24.5 30.5, 6.5 28.5, 4.5 39 C 2.5 49.5, 17 55.5, 31 52.5";
const STEP = { x: 1.15, y: 1.55 };
const STRANDS = 6;

export type StrandMarkState = "idle" | "draw" | "thinking";

export function StrandMark({
	size = 28,
	state = "idle",
	className,
	title,
}: {
	/** Rendered height in px; width follows the 48:64 aspect. */
	size?: number;
	state?: StrandMarkState;
	className?: string;
	/** Accessible name; omit when decorative (next to the wordmark). */
	title?: string;
}) {
	const gid = useId().replace(/:/g, "");
	const strands = Array.from({ length: STRANDS }, (_, i) => i);
	return (
		<svg
			viewBox="0 0 48 64"
			height={size}
			width={(size * 48) / 64}
			role={title ? "img" : undefined}
			aria-hidden={title ? undefined : true}
			aria-label={title}
			className={cn(
				"shrink-0 overflow-visible",
				state === "draw" && "strand-draw",
				state === "thinking" && "strand-think",
				className,
			)}
		>
			<defs>
				{/* Metallic bronze: light at the top-right catch, deep at the turns. */}
				<linearGradient id={`${gid}-b`} x1="0.15" y1="0" x2="0.8" y2="1">
					<stop offset="0" stopColor={G["300"]} />
					<stop offset="0.35" stopColor={G["500"]} />
					<stop offset="0.6" stopColor={G["700"]} />
					<stop offset="0.82" stopColor={G["500"]} />
					<stop offset="1" stopColor={G["600"]} />
				</linearGradient>
			</defs>
			<g transform="translate(2.5 2)" fill="none" strokeLinecap="round">
				{strands.map((i) => (
					<path
						key={i}
						d={S}
						transform={`translate(${(i * STEP.x).toFixed(2)} ${(i * STEP.y).toFixed(2)})`}
						stroke={`url(#${gid}-b)`}
						strokeWidth={1.35}
						pathLength={100}
						data-draw=""
						style={{ ["--i" as string]: i }}
					/>
				))}
				{state === "thinking" &&
					strands.map((i) => (
						<path
							key={`g${i}`}
							d={S}
							transform={`translate(${(i * STEP.x).toFixed(2)} ${(i * STEP.y).toFixed(2)})`}
							stroke={G["50"]}
							strokeWidth={1.6}
							pathLength={100}
							data-glint=""
							style={{ ["--i" as string]: i }}
						/>
					))}
			</g>
		</svg>
	);
}

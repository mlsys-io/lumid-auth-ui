// StrandAvatar — a generative glyph per app, in the spiral's strand language.
//
// Replaces GradientIcon's six hash-picked COOL gradients (sky, cyan, indigo,
// violet…), which were most of the "why is the Library blue?" drift. Identity
// is carried by SHAPE (one of six strand figures, its strand count and its
// rotation, all seeded from the slug); tint comes from a deliberately small
// warm set so a grid of apps still reads as one family.
//
// Deterministic: the same slug always yields the same glyph, on every page.

import { cn } from "@/lib/utils";
import * as palette from "@/styles/palette";

type Tint = { bg: string; ring: string; stroke: string; hi: string };
const TINTS: Tint[] = [
	{ bg: palette.gold["50"], ring: palette.gold["200"], stroke: palette.gold["600"], hi: palette.gold["400"] },
	{ bg: palette.ember["50"], ring: palette.ember["200"], stroke: palette.ember["600"], hi: palette.ember["400"] },
	{ bg: palette.lagoon["50"], ring: palette.lagoon["200"], stroke: palette.lagoon["600"], hi: palette.lagoon["400"] },
	{ bg: palette.plum["50"], ring: palette.plum["200"], stroke: palette.plum["600"], hi: palette.plum["400"] },
	{ bg: palette.ink["100"], ring: palette.ink["200"], stroke: palette.ink["700"], hi: palette.ink["500"] },
];

// Six figures on a 24x24 canvas; `k` (0..n-1) offsets each strand.
const FIGURES: Array<(k: number, n: number) => string> = [
	// wave
	(k) => `M3 ${9 + k * 2.2} C 8 ${4 + k * 2.2}, 16 ${14 + k * 2.2}, 21 ${9 + k * 2.2}`,
	// arc fan
	(k) => `M4 20 Q ${12} ${2 + k * 3.2}, 20 20`,
	// Z ribbon (the mark's own figure)
	(k) => `M${7 + k * 0.9} ${4 + k * 1.2} C 17 3, 19 9, 15 12 C 11 15, 5 14, 6 18 C 7 21, 13 22, ${18 + k * 0.9} ${20 + k * 1.2}`,
	// loop
	(k) => {
		const r = 3.2 + k * 1.6;
		return `M${12 - r} 12 a ${r} ${r} 0 1 1 ${r * 2} 0 a ${r} ${r} 0 1 1 ${-r * 2} 0`;
	},
	// converge (strands gathering to a point)
	(k, n) => `M3 ${5 + (k * 14) / Math.max(1, n - 1)} C 10 ${5 + (k * 14) / Math.max(1, n - 1)}, 13 12, 21 12`,
	// diverge (one strand splitting into arms)
	(k, n) => `M3 12 C 11 12, 14 ${5 + (k * 14) / Math.max(1, n - 1)}, 21 ${5 + (k * 14) / Math.max(1, n - 1)}`,
];

/** FNV-1a — tiny, stable across runs and browsers. */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function strandSeed(slug: string) {
	const h = hash(slug || "?");
	return {
		tint: TINTS[h % TINTS.length],
		figure: (h >>> 3) % FIGURES.length,
		strands: 3 + ((h >>> 7) % 3), // 3..5
		rotate: [0, 90, 180, 270][(h >>> 10) % 4],
	};
}

export function StrandAvatar({
	slug,
	size = 32,
	className,
	title,
}: {
	slug: string;
	size?: number;
	className?: string;
	title?: string;
}) {
	const { tint, figure, strands, rotate } = strandSeed(slug);
	const f = FIGURES[figure];
	// Radius tracks size: a 40px card avatar is a soft 10px tile. At rail sizes
	// (<= 20px) a tinted tile shrinks to a coloured dot that fights the paper,
	// so small glyphs drop the tile and draw bare, slightly heavier strands.
	const radius = Math.max(4, Math.round(size * 0.26));
	const bare = size <= 20;
	return (
		<span
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				background: bare ? undefined : tint.bg,
				boxShadow: bare ? undefined : `inset 0 0 0 1px ${tint.ring}`,
			}}
			title={title}
			aria-hidden={title ? undefined : true}
			data-palette-ok=""
		>
			<svg viewBox="0 0 24 24" width={size * (bare ? 1 : 0.72)} height={size * (bare ? 1 : 0.72)} fill="none" strokeLinecap="round">
				<g transform={`rotate(${rotate} 12 12)`}>
					{Array.from({ length: strands }, (_, k) => (
						<path
							key={k}
							d={f(k, strands)}
							stroke={k === Math.floor(strands / 2) ? tint.stroke : tint.hi}
							strokeWidth={bare ? 1.9 : 1.35}
							opacity={k === Math.floor(strands / 2) ? 1 : 0.85}
						/>
					))}
				</g>
			</svg>
		</span>
	);
}

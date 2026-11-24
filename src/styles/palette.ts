// Lumen palette — typed view over palette.json, the ONE source of truth for
// Studio colour scales (JSON so Node 20 scripts and the Tailwind config read the
// same file without a TS loader).
//
// Imported by tailwind.config.ts (utilities), src/dev/DesignGallery.tsx (the
// swatch sheet), scripts/check-contrast.mjs (asserts every text pairing meets
// WCAG AA on paper AND on muted) and e2e/studio-visual.mjs (allowlist for the
// off-palette audit). Change a value here and all four see it.
//
// Rules (lumid_ui/CLAUDE.md § Design system):
//   ink      warm neutral; replaces slate/gray/zinc. TEXT uses 600+ (>=4.5:1 on
//            paper and muted). 500 is icons / >=18px text only.
//   gold     the brand bronze. Brand, selection, focus — and "ok/succeeded"
//            (a deliberate decision, commit cdaece6: healthy is gold, not green).
//   ember    attention (burnt orange, ~22deg — visibly off bronze's ~40deg).
//   brick    failing (deep red, ~2deg).
//   lagoon   running / info (muted teal, ~191deg).
//   plum     knowledge.
// Status text always uses the 700 step; status never relies on colour alone
// (tones.ts pairs every status with an icon).

// Categorical chart series (palette.json "chart") — validated with the dataviz
// skill's validate_palette.js on both card (#FFFEFB) and paper (#FAF7F1): every
// adjacent pair passes CVD (worst deutan dE 12.9) and normal-vision floors, all
// >= 3:1 vs surface. Slots 1-3 (teal, bronze-yellow, rose) also pass ALL-pairs,
// so scatter / small multiples cap at three series. Assign in order, never
// cycle; a 9th series folds into "Other". DATA colours only: never text/status.

import p from "./palette.json";

type Scale = Record<"50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900", string>;

export const ink = p.ink as Scale & { "950": string };
export const gold = p.gold as Scale;
export const ember = p.ember as Scale;
export const brick = p.brick as Scale;
export const lagoon = p.lagoon as Scale;
export const plum = p.plum as Scale;
/** Categorical chart series, validated (see header). Assign in order, never cycle. */
export const chart = p.chart as readonly string[];
export const surface = p.surface;

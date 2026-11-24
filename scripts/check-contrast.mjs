// check-contrast.mjs — every Lumen TEXT pairing meets WCAG AA.
//
//   node scripts/check-contrast.mjs        (npm run check:contrast)
//
// Asserts the pairs the design system promises (lumid_ui/CLAUDE.md § Design
// system): body/meta text on paper, card, muted and sidebar; status text (700
// step) on its own 50/100 tint and on paper. Exits 1 on any failure so the
// palette can't drift below the floor in a later "just warm it up a touch".

import { readFileSync } from "node:fs";
const { ink, gold, ember, brick, lagoon, plum, surface } = JSON.parse(readFileSync(new URL("../src/styles/palette.json", import.meta.url), "utf8"));

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
	const [r, g, b] = rgb(h).map((c) => {
		c /= 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

const grounds = Object.entries(surface).filter(([k]) => k !== "border");
const checks = [];
// Text inks on every ground.
for (const step of [600, 700, 800, 900]) for (const [g, gv] of grounds) checks.push([`ink-${step} on ${g}`, ink[step], gv, 4.5]);
// ink-500 is for icons and >=18px text: 3:1.
for (const [g, gv] of grounds) checks.push([`ink-500 (large/icon) on ${g}`, ink[500], gv, 3]);
// Status text (700) on paper, card, and its own tints.
for (const [name, s] of Object.entries({ gold, ember, brick, lagoon, plum })) {
	for (const [g, gv] of grounds) checks.push([`${name}-700 on ${g}`, s[700], gv, 4.5]);
	for (const t of [50, 100]) checks.push([`${name}-700 on ${name}-${t}`, s[700], s[t], 4.5]);
	// Dots / icons (500/600) on paper must be visible: 3:1.
	checks.push([`${name}-600 (icon) on background`, s[600], surface.background, 3]);
}
// Filled controls: paper/white text on their fill.
checks.push(["background on ink-900 (primary button)", surface.background, ink[900], 4.5]);
checks.push(["white on gold-700 (accent button)", "#FFFFFF", gold[700], 4.5]);
checks.push(["white on brick-600 (destructive button)", "#FFFFFF", brick[600], 4.5]);
checks.push(["white on lagoon-600 (info fill)", "#FFFFFF", lagoon[600], 4.5]);
// Small gold TEXT must be 700 (gold-600 is 3.9:1 on paper).
checks.push(["gold-700 on card", gold[700], surface.card, 4.5]);

let fail = 0;
for (const [label, fg, bg, min] of checks) {
	const r = ratio(fg, bg);
	if (r < min) {
		fail++;
		console.log(`FAIL ${label}: ${r.toFixed(2)} < ${min}`);
	}
}
console.log(`contrast: ${checks.length - fail}/${checks.length} pairs pass`);
process.exit(fail ? 1 : 0);

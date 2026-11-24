// check-studio-palette.mjs — no NEW off-system styling reaches the Studio.
//
//   node scripts/check-studio-palette.mjs            # check (CI)
//   node scripts/check-studio-palette.mjs --update   # re-freeze the baseline
//   node scripts/check-studio-palette.mjs --report   # per-file counts, worst first
//
// Counts, per file in the derived Studio scope (scripts/studio-scope.mjs):
//   cool   raw Tailwind palette classes from families Lumen replaced
//          (slate/gray/zinc/neutral/stone -> ink, indigo/violet/… -> plum,
//          sky/blue/cyan -> lagoon, rose/red -> brick, amber/yellow/orange ->
//          ember, emerald/green/teal/lime -> gold). Use the Lumen scales.
//   px     arbitrary font sizes `text-[13px]` — use the type scale
//          (text-nano … text-h1, tailwind.config.ts).
//   hex    hex colour literals in code — use a token, or src/styles/palette.json.
// A line containing `palette-ok` is exempt (data colours: chart series, a
// third-party theme). Same ratchet as check-glossary.mjs: a file may keep or
// lower its counts; a rise fails. Lower the baseline (--update) in the same
// change that cleans a file, so the cleanup can't be silently undone.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { studioScope } from "./studio-scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts/palette-baseline.json");

const FAMILIES = "slate|gray|zinc|neutral|stone|indigo|violet|purple|fuchsia|pink|sky|blue|cyan|teal|emerald|green|lime|rose|red|amber|yellow|orange";
const COOL = new RegExp(
	`(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|divide|outline|shadow|placeholder|decoration|accent|caret)-(?:${FAMILIES})-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`,
	"g",
);
const PX = /(?<![\w-])(?:[a-z-]+:)*text-\[\d+(?:\.\d+)?px\]/g;
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;

export function count(src) {
	const c = { cool: 0, px: 0, hex: 0 };
	for (const line of src.split("\n")) {
		if (line.includes("palette-ok")) continue;
		const t = line.trim();
		if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
		c.cool += (line.match(COOL) || []).length;
		c.px += (line.match(PX) || []).length;
		c.hex += (line.match(HEX) || []).length;
	}
	return c;
}

const files = await studioScope();
const now = {};
for (const f of files) {
	const c = count(await readFile(join(root, f), "utf8"));
	if (c.cool || c.px || c.hex) now[f] = c;
}
const total = (o) => Object.values(o).reduce((a, c) => ({ cool: a.cool + c.cool, px: a.px + c.px, hex: a.hex + c.hex }), { cool: 0, px: 0, hex: 0 });

if (process.argv.includes("--report")) {
	const rows = Object.entries(now).sort((a, b) => b[1].cool + b[1].px + b[1].hex - (a[1].cool + a[1].px + a[1].hex));
	for (const [f, c] of rows) console.log(`${String(c.cool).padStart(4)} cool ${String(c.px).padStart(4)} px ${String(c.hex).padStart(3)} hex  ${f}`);
	const t = total(now);
	console.log(`\n${files.length} files in scope · cool=${t.cool} px=${t.px} hex=${t.hex}`);
	process.exit(0);
}

if (process.argv.includes("--update")) {
	const sorted = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
	await writeFile(baselinePath, JSON.stringify(sorted, null, "\t") + "\n");
	const t = total(now);
	console.log(`palette baseline: cool=${t.cool} px=${t.px} hex=${t.hex} in ${Object.keys(sorted).length} files`);
	process.exit(0);
}

let base = {};
try {
	base = JSON.parse(await readFile(baselinePath, "utf8"));
} catch {
	console.error("check-studio-palette: no scripts/palette-baseline.json. Create it with --update.");
	process.exit(1);
}
const rises = [];
const drops = [];
for (const f of new Set([...Object.keys(now), ...Object.keys(base)])) {
	const n = now[f] || { cool: 0, px: 0, hex: 0 };
	const b = base[f] || { cool: 0, px: 0, hex: 0 };
	for (const k of ["cool", "px", "hex"]) {
		if (n[k] > b[k]) rises.push(`  ${f}: ${k} ${b[k]} -> ${n[k]}`);
		else if (n[k] < b[k]) drops.push(`  ${f}: ${k} ${b[k]} -> ${n[k]}`);
	}
}
const t = total(now);
if (rises.length) {
	console.error(`check-studio-palette: NEW off-system styling in the Studio:\n${rises.join("\n")}`);
	console.error("Use the Lumen scales (ink/gold/ember/brick/lagoon/plum), the type scale (text-nano…text-h1),");
	console.error("or tokens. Data colours may carry a `palette-ok` comment on the same line.");
	process.exit(1);
}
if (drops.length) {
	console.error(`check-studio-palette: counts DROPPED — lock the cleanup in:\n${drops.join("\n")}`);
	console.error("  node scripts/check-studio-palette.mjs --update   (then commit scripts/palette-baseline.json)");
	process.exit(1);
}
console.log(`check-studio-palette: ok (cool=${t.cool} px=${t.px} hex=${t.hex} grandfathered across ${Object.keys(now).length} files)`);

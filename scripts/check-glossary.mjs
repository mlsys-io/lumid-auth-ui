// check-glossary.mjs — no retired word reaches the screen in a NEW string.
//
//   node scripts/check-glossary.mjs            # check (CI)
//   node scripts/check-glossary.mjs --update   # re-freeze the baseline
//
// src/lib/glossary.ts lists the retired user-facing words (cycle → run,
// loop → workflow, variant/attempt/arm → experiment, knowledge agent → memory,
// …). This scans what a user can read — JSX text, and the title / label /
// placeholder / aria-label / description attributes — in every src/**/*.tsx.
//
// It is a RATCHET, not a gate on today's code: the hits that predate the
// glossary are frozen per file in scripts/glossary-baseline.json. A file may
// only keep or lower its count; a new hit anywhere fails with the string and
// the word to use instead. Lower the baseline (--update) in the same change
// that removes hits, so the freeze tracks the cleanup.
//
// Identifiers and payload fields are deliberately NOT scanned: `variant_id`,
// `cycle_ts`, `loop` in a route are backend names with their own deprecation
// window. Only prose is.

import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts/glossary-baseline.json");
const update = process.argv.includes("--update");

// Load RETIRED_TERMS from the TS source (same esbuild trick as check-catalog).
const dir = await mkdtemp(join(root, ".wf-test-"));
let RETIRED_TERMS;
try {
	const outfile = join(dir, "glossary.mjs");
	await build({
		entryPoints: [join(root, "src/lib/glossary.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		logLevel: "warning",
	});
	({ RETIRED_TERMS } = await import(pathToFileURL(outfile).href));
} finally {
	await rm(dir, { recursive: true, force: true });
}

// Longest first so "knowledge agents" wins over nothing shorter matching inside it.
const terms = Object.keys(RETIRED_TERMS).sort((a, b) => b.length - a.length);
const termRe = new RegExp(`\\b(${terms.map((t) => t.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

// User-visible prose: JSX text between tags, and prose-bearing attributes.
const jsxTextRe = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
const attrRe = /\b(?:title|label|placeholder|aria-label|description)=(?:"([^"]*)"|'([^']*)'|\{`([^`$]*)`\})/g;

async function* walk(d) {
	for (const e of await readdir(d, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "__fixtures__") continue;
		const p = join(d, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) yield p;
	}
}

function hitsIn(src) {
	const hits = [];
	const scan = (text) => {
		for (const m of text.matchAll(termRe)) hits.push({ word: m[1].toLowerCase().replace(/\s+/g, " "), text: text.trim() });
	};
	for (const m of src.matchAll(jsxTextRe)) scan(m[1]);
	for (const m of src.matchAll(attrRe)) scan(m[1] ?? m[2] ?? m[3] ?? "");
	return hits;
}

const counts = {};
const detail = {};
for await (const file of walk(join(root, "src"))) {
	const hits = hitsIn(await readFile(file, "utf8"));
	if (!hits.length) continue;
	const rel = relative(root, file);
	counts[rel] = hits.length;
	detail[rel] = hits;
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (update) {
	const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
	await writeFile(baselinePath, JSON.stringify(sorted, null, "\t") + "\n");
	console.log(`glossary baseline: ${total} grandfathered hits in ${Object.keys(counts).length} files`);
	process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
let failed = false;
for (const [file, n] of Object.entries(counts)) {
	const allowed = baseline[file] ?? 0;
	if (n <= allowed) continue;
	failed = true;
	console.error(`✗ ${file}: ${n} retired word(s) on screen, baseline allows ${allowed}`);
	for (const h of detail[file]) console.error(`    "${h.word}" → "${RETIRED_TERMS[h.word] ?? "?"}"   in: ${h.text.slice(0, 100)}`);
}
if (failed) {
	console.error("\nUse the canonical word (src/lib/glossary.ts). If you REMOVED hits, run with --update to lower the baseline.");
	process.exit(1);
}
const stale = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n).length;
console.log(`glossary ok: ${total} grandfathered hits (baseline ${baseTotal})${stale ? `; ${stale} file(s) below baseline — run --update to ratchet down` : ""}`);

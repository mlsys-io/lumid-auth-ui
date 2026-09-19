// tsc-guard — let the existing type errors stay, but stop new ones.
//
// CI ran `npx tsc --noEmit || true` for months. That is not a type check; it
// is a type check with the result thrown away, and it is why a baseline of 98
// errors could accumulate without anyone deciding to accept them.
//
// Fixing all 98 is a separate piece of work in files this session never
// touched (matrix.tsx, submit-workflow.tsx, sonner.tsx, env.tsx and friends).
// Blocking on that would mean shipping nothing until it is done, so instead:
//
//   - more errors than the baseline  -> FAIL, and print only the new ones
//   - fewer                          -> FAIL too, asking you to lower the
//                                       baseline, so the ratchet only turns
//                                       one way and a cleanup cannot silently
//                                       be undone by the next regression
//   - equal                          -> pass
//
// Run: node scripts/tsc-guard.mjs [--update]

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE_FILE = new URL("../.tsc-baseline", import.meta.url);

function currentErrors() {
	let out = "";
	try {
		out = execSync("npx tsc --noEmit", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		// tsc exits non-zero when there are errors; that is the normal path here.
		out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
	}
	return out.split("\n").filter((l) => /error TS\d+:/.test(l));
}

const errors = currentErrors();
const count = errors.length;

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE_FILE, `${count}\n`);
	console.log(`tsc-guard: baseline written as ${count}`);
	process.exit(0);
}

let baseline;
try {
	baseline = Number(readFileSync(BASELINE_FILE, "utf8").trim());
} catch {
	console.error("tsc-guard: no .tsc-baseline file. Create one with `node scripts/tsc-guard.mjs --update`.");
	process.exit(1);
}

if (!Number.isFinite(baseline)) {
	console.error("tsc-guard: .tsc-baseline is not a number.");
	process.exit(1);
}

if (count === baseline) {
	console.log(`tsc-guard: ${count} errors, matching the baseline. No new type errors.`);
	process.exit(0);
}

if (count < baseline) {
	console.log(`tsc-guard: ${count} errors, DOWN from ${baseline}. Nice.`);
	console.log("Lower the baseline so it cannot drift back up:");
	console.log("  node scripts/tsc-guard.mjs --update   (then commit .tsc-baseline)");
	process.exit(1);
}

// More than the baseline. Print what is likely new: the errors in files that
// carry more errors than a plain baseline count can attribute, plus a tail of
// the raw list so the actual message is in the log rather than just a number.
console.error(`tsc-guard: ${count} type errors, baseline is ${baseline}. ${count - baseline} new.`);
console.error("");
const byFile = new Map();
for (const line of errors) {
	const file = line.split("(")[0];
	byFile.set(file, (byFile.get(file) ?? 0) + 1);
}
console.error("errors per file (highest first):");
for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
	console.error(`  ${String(n).padStart(3)}  ${file}`);
}
console.error("");
console.error("last 15 error lines:");
for (const line of errors.slice(-15)) console.error(`  ${line}`);
process.exit(1);

// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { specVersion, updateWords } from "./app-update";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("reads the spec's version", () => {
	eq(specVersion("name: x\nversion: 0.4.0\n"), "0.4.0");
	eq(specVersion("version: '1.2.3' # pinned"), "1.2.3");
	eq(specVersion("name: x"), "");
});

check("says what the update did", () => {
	eq(updateWords({ sha: "a", yaml: "version: 0.3.11" }, { sha: "b", yaml: "version: 0.4.0" }, false), { text: "Updated to v0.4.0 (was v0.3.11) — your edits were kept", changed: true });
	eq(updateWords({ sha: "a", yaml: "version: 0.4.0" }, { sha: "a", yaml: "version: 0.4.0" }, true).changed, false);
	eq(updateWords({ sha: "a", yaml: "version: 0.4.0" }, { sha: "a", yaml: "version: 0.4.0" }, false).text, "You already have the latest version (v0.4.0)");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ app-update: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

// Which session-bearer audience each data-lake instance gets. Run by
// scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { audienceFor } from "./dataLake";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("lum.id/data gets its own audience", () => eq(audienceFor("/data"), "lumid-data"));
check("a lum.id/data sub-path too", () => eq(audienceFor("/data/jobs/v1"), "lumid-data"));
check("findata keeps the default bearer", () => eq(audienceFor("/findata"), undefined));
check("data apps keep the default bearer", () => eq(audienceFor("/dataapp-proxy"), undefined));
check("lumid.trade keeps the default bearer", () => eq(audienceFor("https://lumid.trade"), undefined));

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;

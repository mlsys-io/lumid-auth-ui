// Which session-bearer audience each data-lake instance gets. Run by
// scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { audienceFor, instanceById, jobRefFor } from "./dataLake";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("lum.id/data gets its own audience", () => eq(audienceFor("/data"), "lumid-data"));
check("a lum.id/data sub-path too", () => eq(audienceFor("/data/jobs/v1"), "lumid-data"));
check("the NUS hub gets the lumid-data audience", () => eq(audienceFor("/data-nus"), "lumid-data"));
check("a NUS hub sub-path too", () => eq(audienceFor("/data-nus/catalog/schemas"), "lumid-data"));
check("a look-alike prefix does not", () => eq(audienceFor("/data-nusx"), undefined));
check("findata keeps the default bearer", () => eq(audienceFor("/findata"), undefined));
check("data apps keep the default bearer", () => eq(audienceFor("/dataapp-proxy"), undefined));
check("lumid.trade keeps the default bearer", () => eq(audienceFor("https://lumid.trade"), undefined));
check("a Lumid Data table has a job name", () => eq(jobRefFor(instanceById("lumid-data")!, "ukb_demo", "phenotype"), "lumid-data://ukb_demo.phenotype"));
check("FinData has none until jobs can read it", () => eq(jobRefFor(instanceById("findata")!, "market", "ohlc_1d"), null));
check("every instance says where it lives", () => {
	for (const id of ["findata", "lumid-data", "lqt-data"]) if (!instanceById(id)?.where) throw new Error(`${id} has no 'where'`);
});

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

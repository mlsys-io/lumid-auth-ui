// Which session-bearer audience each data-lake instance gets. Run by
// scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { audienceFor, catalogLine, instanceById, jobRefFor, shownCatalog, type InstanceCatalog } from "./dataLake";

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


const CAT: InstanceCatalog[] = [
  { instance: instanceById("findata")!, schemas: [{ schema: "market", tables: 10 }, { schema: "news", tables: 3 }] },
  { instance: instanceById("lumid-data")!, schemas: [{ schema: "ukb_demo", tables: 1 }] },
  { instance: instanceById("lqt-data")!, schemas: [], error: "HTTP 403" },
];
check("a source a reader cannot reach is not shown to them", () => eq(shownCatalog(CAT, false).map((c) => c.instance.id).join(","), "findata,lumid-data"));
check("admins still see it, marked offline", () => eq(shownCatalog(CAT, true).length, 3));
check("the catalog line counts what the reader sees", () => eq(catalogLine(CAT, false), "2 instances · 3 schemas · 14 tables · read-only"));
check("admins get the up/total count", () => eq(catalogLine(CAT, true), "2/3 instances · 3 schemas · 14 tables · read-only"));

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

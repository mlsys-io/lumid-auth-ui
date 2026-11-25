// Words for where a run goes. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { DEFAULT_RUN_SITE, RUN_SITES, isRunSite, runSiteNote } from "./run-site";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

check("sites are home, office, nus; home by default", () => {
	eq(RUN_SITES.map((s) => s.id), ["home", "office", "nus"]);
	eq(DEFAULT_RUN_SITE, "home");
});
check("only known sites pass", () => {
	eq([isRunSite("home"), isRunSite("office"), isRunSite("nus"), isRunSite("vast"), isRunSite(""), isRunSite(null)], [true, true, true, false, false, false]);
});
check("each site says what it means for data", () => {
	eq(runSiteNote("home").includes("local network"), true);
	eq(runSiteNote("office").includes("pick Home for big ones"), true);
	eq(runSiteNote("nus").includes("NUS Data"), true);
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

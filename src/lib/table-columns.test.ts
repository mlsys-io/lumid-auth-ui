// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { sampleColumns } from "./table-columns";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

check("every column, identifiers and titles first", () => {
	const row: Record<string, unknown> = { abstract: 1, authors: 2, categories: 3, title: 4, paper_id: 5, first_version_date: 6 };
	for (let i = 0; i < 30; i++) row[`zz_extra_${i}`] = i;
	const cols = sampleColumns([row]);
	eq(cols.length, 36, "no cap");
	eq(cols.slice(0, 4), ["paper_id", "title", "first_version_date", "abstract"]);
});
check("columns from later rows count too; junk rows are skipped", () => {
	eq(sampleColumns([{ b: 1 }, null as unknown as Record<string, unknown>, { a: 2, date: 3 }]), ["date", "a", "b"]);
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

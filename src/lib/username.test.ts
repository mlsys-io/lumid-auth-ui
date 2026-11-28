// Username rules and notes. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { portNote, renameNote, usernameProblem } from "./username";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}
check("valid names pass", () => { eq(usernameProblem("zhengyuan"), null); eq(usernameProblem("good_name-1"), null); });
check("each rule says what is wrong", () => {
	eq(usernameProblem(""), "Type a name");
	eq(usernameProblem("Minhao"), "Use lowercase letters");
	eq(usernameProblem("1abc"), "Start with a letter");
	eq(usernameProblem("a b"), "Only letters, digits, - and _");
	eq(usernameProblem("a"), "2–32 characters");
});
check("rename note names both, and says the old one keeps working", () => {
	const n = renameNote("njcuvngncjb", "minhao");
	eq(n.startsWith("njcuvngncjb becomes minhao everywhere"), true);
	eq(n.includes("keeps working as a link"), true);
	eq(renameNote(null, "minhao"), "You will be minhao on every cluster.");
});
check("port note warns it is public", () => eq(portNote("lum.id:31501", 8888).includes("Anyone with the address can connect"), true));

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

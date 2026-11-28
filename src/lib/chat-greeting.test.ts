// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { chatGreeting } from "./chat-greeting";
import { COMPUTE_KEY, DATA_KEY, LIBRARY_KEY } from "./chat-scopes";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

check("an app's chat greets by name, offers 2–3 asks and says approving spends", () => {
	const g = chatGreeting("mlsys-research", "MLSys Research");
	eq(g.line, "Ask MLSys Research about its workflows, experiments and runs.");
	ok(g.examples.length >= 2 && g.examples.length <= 3, "2–3 examples");
	ok(g.examples[0].includes("MLSys Research"), "grounded in the app");
	ok(!!g.spendNote && /spend compute/.test(g.spendNote) && /approve/.test(g.spendNote), "spend note");
});

check("virtual scopes get their own asks", () => {
	ok(chatGreeting(DATA_KEY, "")!.examples[0].includes("tables"), "data");
	ok(chatGreeting(COMPUTE_KEY, "")!.examples[0].includes("machines"), "compute");
	eq(chatGreeting(LIBRARY_KEY, "").spendNote, null);
	eq(chatGreeting("x", " ").line, "Ask this app about its workflows, experiments and runs.");
});

check("no example reads like a command that runs something by itself", () => {
	for (const s of ["mlsys-research", DATA_KEY, COMPUTE_KEY, LIBRARY_KEY]) {
		for (const ex of chatGreeting(s, "App").examples) ok(!/^(run|start|install|delete)\b/i.test(ex), ex);
	}
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ chat-greeting: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

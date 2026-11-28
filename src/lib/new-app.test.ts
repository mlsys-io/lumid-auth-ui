// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { appNameFrom, newAppProblems, publishedWords, publishPlanWords, APP_NAME_RE } from "./new-app";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

check("an id comes from the title, valid for the scheduler, and avoids ones taken", () => {
	eq(appNameFrom("Trace Lab: batch sizes"), "trace-lab-batch-sizes");
	eq(appNameFrom("Café Études"), "cafe-etudes");
	eq(appNameFrom("9.2 serving"), "app-9-2-serving");
	eq(appNameFrom("AI"), "ai-app");
	eq(appNameFrom("  "), "");
	eq(appNameFrom("Trace Lab", ["trace-lab", "trace-lab-2"]), "trace-lab-3");
	for (const t of ["Trace Lab: batch sizes", "9.2 serving", "AI", "x".repeat(200)]) ok(APP_NAME_RE.test(appNameFrom(t)), `valid: ${t}`);
});

check("problems say what to fix", () => {
	eq(newAppProblems({ title: "Trace Lab", name: "trace-lab", summary: "" }), []);
	ok(newAppProblems({ title: "", name: "trace-lab", summary: "" })[0].includes("title"), "title");
	ok(newAppProblems({ title: "T", name: "Trace Lab", summary: "" })[0].includes("lowercase"), "bad id");
	ok(newAppProblems({ title: "T", name: "trace-", summary: "" })[0].includes("not ending"), "trailing hyphen");
	ok(newAppProblems({ title: "T", name: "mlsys-research", summary: "" }, ["mlsys-research"])[0].includes("already have"), "taken");
	ok(newAppProblems({ title: "T", name: "trace-lab", summary: "x".repeat(501) })[0].includes("500"), "summary");
});

check("the plan says who will see it before publishing", () => {
	ok(publishPlanWords("public", true).startsWith("This publishes it for the first time. Anyone can find it in the Marketplace"), "public first");
	ok(publishPlanWords("private", false).includes("Only you can see it"), "private");
	ok(publishPlanWords("private", false).includes("Get updates"), "update");
});

check("the result reads in one sentence, with its link, or why it didn't", () => {
	eq(publishedWords({ ok: true, data: { slug: "sub/trace-lab", visibility: "public" } }, "public"),
		{ ok: true, text: "Published. It's in the Marketplace.", url: "https://xp.io/sub/trace-lab" });
	eq(publishedWords({ ok: true, data: { ok: true, action: "pushed", slug: "sub/trace-lab" } }, "private").text, "Published. It's private to you.");
	eq(publishedWords({ ok: true, data: { slug: "s/a", version: "0.1.1" } }, "").text, "Published v0.1.1.");
	eq(publishedWords({ ok: false, error: "spec invalid" }, "public"), { ok: false, text: "It didn't publish: spec invalid" });
	eq(publishedWords({ ok: true, data: { error: "409" } }, "public").ok, false);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ new-app: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

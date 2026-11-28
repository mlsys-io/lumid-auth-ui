// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { renameState, verifyState } from "./username-apply";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}
const base = { source: "lumid", can_choose: false, can_claim: false, host_homes: [], hosts: [] };
check("moved home, with stopped boxes said in words", () =>
	eq(renameState({ from: "admin", to: "luyao", stopped: ["dev"], home: "moved" }),
		{ kind: "done", text: "home moved from admin to luyao; stopped 1 sandbox (create them again)" }));
check("pending means retry", () => eq(renameState({ from: "a", to: "b", stopped: [], home: "pending:pvc still in use" }).kind, "retry"));
check("verify: new name reported -> done", () => eq(verifyState({ ...base, user: "luyao" }, "luyao").kind, "done"));
check("verify: conflict -> failed with the reason", () =>
	eq(verifyState({ ...base, user: "admin", username_conflict: "taken by someone else" }, "luyao"),
		{ kind: "failed", text: "not switched: taken by someone else" }));
check("verify: site without the feature -> later", () => eq(verifyState(null, "luyao").kind, "later"));
export function run(): number {
	let failed = 0;
	for (const c of checks) { try { c.run(); } catch (e) { failed++; console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`); } }
	return failed;
}
export const caseCount = checks.length;

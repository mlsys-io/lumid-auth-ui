// "Public ports" words on the Sandboxes page. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { poolLine, portsButtonLabel, portsNextStep } from "./ports";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}
check("each site's pool in words", () => {
	eq(poolLine("home", { enabled: true, pool_size: 16, free: 10 }), "home: 10 of 16 free");
	eq(poolLine("office", { enabled: true, pool_size: 16, free: 0 }), "office: full (16 in use)");
	eq(poolLine("nus", { enabled: false }), "nus: not available");
});
check("toolbar button label", () => {
	eq(portsButtonLabel("home", { enabled: true, pool_size: 16, free: 3 }), "Public ports · 3 free");
	eq(portsButtonLabel("home", { enabled: true, pool_size: 16, free: 0 }), "Public ports · full");
	eq(portsButtonLabel("nus", { enabled: false }), "Public ports");
});
check("one next step", () => {
	eq(portsNextStep(0).includes("Start one"), true);
	eq(portsNextStep(2).startsWith("Pick a running sandbox"), true);
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

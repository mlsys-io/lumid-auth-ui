// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts (the repo
// has no standalone test runner; see that script's header).
import { runStatus, cycleStatus, runStatusTitle, RUN_STATUSES } from "./runStatus";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const st = (raw: string) => runStatus(raw).status;

check("me/runs states", () => {
	eq(st("succeeded"), "succeeded"); eq(st("failed"), "failed"); eq(st("running"), "running");
	eq(st("skipped"), "skipped"); eq(st("canceled"), "cancelled");
});
check("recovered is a success, flagged", () => {
	const r = runStatus("recovered");
	eq(r.status, "succeeded"); eq(r.recovered, true); eq(r.raw, "recovered");
});
check("FlowMesh states (upper case)", () => {
	eq(st("DONE"), "succeeded"); eq(st("FAILED"), "failed"); eq(st("CANCELLED"), "cancelled");
	eq(st("PENDING"), "queued"); eq(st("DISPATCHED"), "running");
});
check("experiment states", () => { eq(st("decided"), "succeeded"); eq(st("running"), "running"); eq(st("pending"), "queued"); });
check("directive Queued", () => eq(st("Queued"), "queued"));
check("spark chars", () => {
	eq(st("o"), "succeeded"); eq(st("x"), "failed"); eq(st("_"), "skipped"); eq(st("."), "running");
	eq(runStatus("r").recovered, true);
});
check("raw state is kept verbatim for the tooltip", () => {
	eq(runStatus("DONE").raw, "DONE");
	eq(runStatusTitle(runStatus("DONE")), 'Succeeded — source said "DONE"');
});
check("unknown word never paints as success or failure", () => eq(st("weird"), "skipped"));
check("empty is queued", () => { eq(st(""), "queued"); eq(runStatus(undefined).status, "queued"); });
check("cycle ok/running", () => {
	eq(cycleStatus({ ok: true }).status, "succeeded");
	eq(cycleStatus({ ok: false }).status, "failed");
	eq(cycleStatus({ ok: true, running: true }).status, "running");
	eq(cycleStatus({}).status, "skipped");
	eq(cycleStatus(null).status, "queued");
});
check("vocabulary is exactly six words", () => eq(RUN_STATUSES.join(","), "queued,running,succeeded,failed,skipped,cancelled"));

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

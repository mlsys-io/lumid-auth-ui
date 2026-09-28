// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts (the repo
// has no standalone test runner; see that script's header).
import { lumilakeReqIdOfTask, lumilakeReqIdOfTasks, fleetJobsPath, shortJobId } from "./fleet-provenance";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const Y = (name: string) => `apiVersion: flowmesh/v1\nkind: Workflow\nmetadata:\n  name: ${name}\nspec:\n  tasks: []\n`;

check("req id from raw_yaml metadata.name", () =>
	eq(lumilakeReqIdOfTask({ raw_yaml: Y("lumilake-req-FQ89FpUz6jnoyYyyjoPxxX") }), "req-FQ89FpUz6jnoyYyyjoPxxX"));
check("quoted name and trailing comment", () => {
	eq(lumilakeReqIdOfTask({ raw_yaml: Y(`"lumilake-req-abcdef12"`) }), "req-abcdef12");
	eq(lumilakeReqIdOfTask({ raw_yaml: Y(`'lumilake-req-abcdef12'  # from lumilake`) }), "req-abcdef12");
});
check("structured metadata.name wins over raw_yaml", () =>
	eq(lumilakeReqIdOfTask({ metadata: { name: "lumilake-req-AAAAAA11" }, raw_yaml: Y("lumilake-req-BBBBBB22") }), "req-AAAAAA11"));
check("top-level name", () => eq(lumilakeReqIdOfTask({ name: "lumilake-req-CCCCCC33" }), "req-CCCCCC33"));
check("a workflow not submitted by Lumilake: null", () => {
	eq(lumilakeReqIdOfTask({ raw_yaml: Y("my-inference-job") }), null);
	eq(lumilakeReqIdOfTask({ raw_yaml: "" }), null);
	eq(lumilakeReqIdOfTask({ raw_yaml: null }), null);
	eq(lumilakeReqIdOfTask(null), null);
	eq(lumilakeReqIdOfTask({ metadata: "lumilake-req-abcdef12" }), null);
});
check("a MENTION of a job id is not a submitter (never guess)", () => {
	eq(lumilakeReqIdOfTask({ raw_yaml: Y("x") + "  env:\n    PARENT: lumilake-req-abcdef12\n" }), null);
	eq(lumilakeReqIdOfTask({ raw_yaml: "# was lumilake-req-abcdef12\n" + Y("x") }), null);
	eq(lumilakeReqIdOfTask({ name: "lumilake-req-abcdef12-extra" }), null);
});
check("malformed ids rejected (identity would 400 them)", () => {
	eq(lumilakeReqIdOfTask({ raw_yaml: Y("lumilake-req-ab") }), null);
	eq(lumilakeReqIdOfTask({ raw_yaml: Y("lumilake-req-abc/def123") }), null);
	eq(lumilakeReqIdOfTask({ name: "lumilake-req-" }), null);
});
check("tasks: preferred task first, else the first that names one", () => {
	const tasks = [
		{ task_id: "t1", raw_yaml: Y("plain") },
		{ task_id: "t2", raw_yaml: Y("lumilake-req-SECOND22") },
		{ task_id: "t3", raw_yaml: Y("lumilake-req-THIRD333") },
	];
	eq(lumilakeReqIdOfTasks(tasks), "req-SECOND22");
	eq(lumilakeReqIdOfTasks(tasks, "t3"), "req-THIRD333");
	eq(lumilakeReqIdOfTasks(tasks, "t1"), "req-SECOND22");
	eq(lumilakeReqIdOfTasks([]), null);
	eq(lumilakeReqIdOfTasks(null), null);
});
check("fleet jobs path", () => {
	eq(fleetJobsPath("home", "wfl-1234"), "/studio/research-fleet/jobs?site=home&workflow=wfl-1234");
	eq(fleetJobsPath("home", "wfl-1234", "tsk-9"), "/studio/research-fleet/jobs?site=home&workflow=wfl-1234&task=tsk-9");
	eq(fleetJobsPath("", null), "/studio/research-fleet/jobs");
});
check("short job id", () => {
	eq(shortJobId("req-FQ89FpUz6jnoyYyyjoPxxX"), "req-FQ89FpUz…");
	eq(shortJobId("req-abc123"), "req-abc123");
	eq(shortJobId(undefined), "");
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

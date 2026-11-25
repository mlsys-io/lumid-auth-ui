// The pictures a run produced. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { flowmeshSite, imageFilePath, picturesLabel, runImages } from "./run-images";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

// The real shape of a diffusion run's result (Research Fleet, 2026-11-25).
const DIFFUSION = [{
	name: "e2e-pictures", task_id: "tsk-58e5",
	result: { ok: true, task_type: "diffusion", model: "stabilityai/sd-turbo",
		images: [{ path: "images/image_0.png" }, { path: "images/image_1.png" }],
		_artifacts: { base_url: "http://192.168.7.250:31800" } },
}];

check("site only for FlowMesh runs", () => {
	eq(flowmeshSite("home:fm:wfl-1"), "home");
	eq(flowmeshSite("nus:ll:req-1"), null);
	eq(flowmeshSite("garbage"), null);
});
check("a diffusion run's images", () => {
	eq(runImages("home:fm:wfl-1", DIFFUSION).map((i) => `${i.site}|${i.taskId}|${i.path}|${i.name}`),
		["home|tsk-58e5|images/image_0.png|image_0.png", "home|tsk-58e5|images/image_1.png|image_1.png"]);
});
check("artifacts lists count too, non-images and unsafe paths do not, no duplicates", () => {
	const outs = [{ task_id: "t", result: { artifacts: ["results.json", "out/a.JPG", "../x.png", "/etc/y.png", "out/a.JPG"] } }];
	eq(runImages("office:fm:w", outs).map((i) => i.path), ["out/a.JPG"]);
});
check("Lumilake runs and odd payloads give nothing", () => {
	eq(runImages("home:ll:req", DIFFUSION), []);
	eq(runImages("home:fm:w", null), []);
	eq(runImages("home:fm:w", [{ result: { images: [{ path: "a.png" }] } }]), []);
});
check("words and file path", () => {
	eq(picturesLabel(1), "1 picture");
	eq(picturesLabel(4), "4 pictures");
	eq(imageFilePath({ site: "home", taskId: "tsk 1", path: "images/my pic.png", name: "my pic.png" }),
		"/home/api/v1/results/tsk%201/files/images/my%20pic.png");
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

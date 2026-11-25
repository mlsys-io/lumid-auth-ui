// The files a run produced. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { fileKind, filesLabel, runFileUrl, runFiles } from "./run-files";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

check("a FlowMesh run's images and artifacts", () => {
	const outs = [{ task_id: "tsk-58e5", result: { images: [{ path: "images/image_0.png" }], artifacts: ["results.json", "../x", "/etc/y"] } }];
	eq(runFiles("home:fm:wfl-1", outs), [
		{ path: "tsk-58e5/images/image_0.png", name: "image_0.png", kind: "image" },
		{ path: "tsk-58e5/results.json", name: "results.json", kind: "data" },
	]);
});
check("Lumilake artifacts anywhere in the result, including JSON-in-a-string", () => {
	const uri = "lumid-data://lumilake-archive/home/artifacts/req-1/abc.png";
	const outs = { outputs: { graph_0: { picture: [JSON.stringify({ output: uri }), uri] } }, note: "no artifacts here" };
	eq(runFiles("home:ll:req-1", outs), [{ path: uri, name: "abc.png", kind: "image" }]);
});
check("nothing for unknown shapes", () => {
	eq(runFiles("home:fm:w", null), []);
	eq(runFiles("home:ll:r", "plain"), []);
	eq(runFiles("home:fm:w", [{ task_id: "bad", result: { images: ["a.png"] } }]), []);
});
check("url and words", () => {
	eq(runFileUrl("https://lum.id/", "home:fm:wfl-1", "tsk-1/images/a b.png"),
		"https://lum.id/api/v1/me/fleet/jobs/home%3Afm%3Awfl-1?view=file&path=tsk-1%2Fimages%2Fa%20b.png");
	eq([fileKind("a.PNG"), fileKind("x.csv"), fileKind("r.json"), fileKind("bin")], ["image", "text", "data", "other"]);
	eq([filesLabel(1), filesLabel(3)], ["1 file", "3 files"]);
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

// What a Research Fleet run produced and why it failed. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import {
	cellText, fleetStatusWord, hideInternals, latestRunsNote, lumilakeView, MAX_TABLE_ROWS, picturesContext,
	problemLine, publicResult, resultButtonLabel, resultUnavailableLine, rowsLabel, runLabel, runProblems, tableCapLine,
} from "./fleet-result";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

// The real shape of a Lumilake run's result (nus:ll:req-…, prod v0.5.580, 2026-11-25):
// each item is a JSON string {"df": "<pandas to_json orient=columns>"}.
const df = JSON.stringify({
	papers: { "0": 21331, "1": 17020, "2": 9001 },
	primary_category: { "0": "cs.CV", "1": "cs.LG", "2": "cs.CL" },
});
const LUMILAKE = { chat_histories: {}, outputs: { graph_0: { counts: [JSON.stringify({ df })] } } };

check("a Lumilake frame becomes a table: a column per key, a row per index, in order", () => {
	const v = lumilakeView(LUMILAKE);
	eq(v.tables.length, 1);
	const t = v.tables[0];
	eq(t.caption, "counts");
	eq(t.columns, ["papers", "primary_category"]);
	eq(t.numeric, [true, false]);
	eq(t.index, null, "a 0,1,2 index is not shown");
	eq(t.rows, [["21331", "cs.CV"], ["17020", "cs.LG"], ["9001", "cs.CL"]]);
	eq(t.totalRows, 3);
	eq(v.texts, []);
});
check("index order is numeric, and a meaningful index is kept", () => {
	const frame = JSON.stringify({ n: { "10": 1, "2": 2, "1": 3 } });
	eq(lumilakeView({ outputs: { g: { o: [JSON.stringify({ df: frame })] } } }).tables[0].rows, [["3"], ["2"], ["1"]]);
	const named = JSON.stringify({ n: { "cs.CV": 5, "cs.LG": 4 } });
	const t = lumilakeView({ outputs: { g: { o: [JSON.stringify({ df: named })] } } }).tables[0];
	eq(t.index, ["cs.CV", "cs.LG"]);
});
check("several graphs and outputs each get a caption; same-column items are one table", () => {
	const a = JSON.stringify({ df: JSON.stringify({ x: { "0": 1 } }) });
	const b = JSON.stringify({ df: JSON.stringify({ x: { "0": 2 } }) });
	const c = JSON.stringify({ df: JSON.stringify({ y: { "0": "k" } }) });
	const v = lumilakeView({ outputs: { graph_0: { counts: [a, b] }, graph_1: { other: [a, c] } } });
	eq(v.tables.map((t) => t.caption), ["counts · graph 0", "other · graph 1 (1 of 2)", "other · graph 1 (2 of 2)"]);
	eq(v.tables[0].rows, [["1"], ["2"]]);
});
check("split and records orients, and df given as an object", () => {
	const split = { df: { columns: ["a", "b"], index: [0, 1], data: [[1, "x"], [2, null]] } };
	eq(lumilakeView({ outputs: { g: { o: [split] } } }).tables[0].rows, [["1", "x"], ["2", "—"]]);
	const records = JSON.stringify({ df: JSON.stringify([{ a: 1, b: true }, { a: 2, b: false }]) });
	eq(lumilakeView({ outputs: { g: { o: [records] } } }).tables[0].rows, [["1", "yes"], ["2", "no"]]);
});
check("plain text items read as text; unknown shapes are left to the raw result", () => {
	const v = lumilakeView({ outputs: { g: { answer: ["The answer is 42.", '{"weird": 1}'] } } });
	eq(v.tables, []);
	eq(v.texts, [{ caption: "answer", texts: ["The answer is 42."] }]);
	eq(lumilakeView([{ task_id: "t" }]), { tables: [], texts: [] });
	eq(lumilakeView(null), { tables: [], texts: [] });
	eq(lumilakeView({ outputs: { g: { o: ['{"df": "not json"}'] } } }), { tables: [], texts: [] });
});
check("big tables are capped and say so", () => {
	const col: Record<string, number> = {};
	for (let i = 0; i < MAX_TABLE_ROWS + 5; i++) col[String(i)] = i;
	const t = lumilakeView({ outputs: { g: { o: [JSON.stringify({ df: JSON.stringify({ n: col }) })] } } }).tables[0];
	eq(t.rows.length, MAX_TABLE_ROWS);
	eq(tableCapLine(t), `Showing the first ${MAX_TABLE_ROWS} of ${MAX_TABLE_ROWS + 5} rows`);
	eq(tableCapLine(lumilakeView(LUMILAKE).tables[0]), null);
	eq(rowsLabel(1), "1 row");
	eq(rowsLabel(3), "3 rows");
});

check("internals are hidden: keys, private addresses, machine paths", () => {
	const r = publicResult([{ task_id: "t", result: {
		ok: true, model: "stabilityai/sd-turbo", images: [{ path: "images/image_0.png" }],
		_artifacts: { base_url: "http://192.168.7.250:31800" }, base_dir: "/home/fm/results/t", base_url: "http://10.0.0.4:8000",
		note: "saved to /data/flowmesh/results/t/out.png via http://192.168.7.250:31800/api",
	} }]);
	eq(r, [{ task_id: "t", result: {
		ok: true, model: "stabilityai/sd-turbo", images: [{ path: "images/image_0.png" }],
		note: "saved to (internal path) via (internal address)",
	} }]);
	eq(hideInternals("s3://bucket/fleet-jobs/x and https://lum.id/a stay; 172.20.1.2:9000 and 8.8.8.8 differ"),
		"s3://bucket/fleet-jobs/x and https://lum.id/a stay; (internal address) and 8.8.8.8 differ");
	eq(cellText({ base_dir: "/tmp/x", v: 1 }), '{"v":1}');
	eq(hideInternals("see file:///home/u/a.txt"), "see (internal path)");
});

check("a failed Lumilake run names the op and says plainly that no reason came back", () => {
	const outputs = { outputs: {}, error_info: [
		{ batch_error: "Output task tsk-9a1 failed", execution_request_id: "e1", graph: "graph_0", slice_index: 0, workflow_id: "w" },
		{ batch_id: "b1", execution_request_id: "e1", task_node_map: { "tsk-9a1": "count_by_category" } },
	] };
	const ps = runProblems({ outputs, status: { error: "Output task tsk-9a1 failed" } });
	eq(ps, [{ step: "count_by_category", why: "Lumilake didn't say why" }]);
	eq(problemLine(ps[0]), "The step “count_by_category” failed: Lumilake didn't say why");
});
check("Lumilake without a task map, abort, timeout and other errors", () => {
	eq(runProblems({ outputs: { error_info: [{ batch_error: "Output task tsk-1 failed" }] } }).map(problemLine),
		["A step failed; Lumilake didn't say why"]);
	eq(runProblems({ outputs: { error_info: [
		{ batch_error: "Task tsk-2 failed; aborting workflow (3 task(s) failed in total)" },
		{ task_node_map: { "tsk-2": "load_papers" } },
	] } }).map(problemLine), ["The step “load_papers” failed: Lumilake didn't say why (3 steps failed in all)"]);
	eq(runProblems({ outputs: { error_info: [{ batch_error: "Timeout waiting for output nodes to complete after 1800.0s" }] } }).map(problemLine),
		["Timed out after 1800 s waiting for the last steps to finish"]);
	eq(runProblems({ outputs: { error_info: [{ batch_error: "Traceback (most recent call last):\n  File \"/opt/x.py\"\nKeyError: 'papers'" }] } }).map(problemLine),
		["KeyError: 'papers'"]);
	eq(runProblems({ outputs: { error_info: [{ missing_output: "w1" }] } }).map(problemLine),
		["Part of the run finished without producing its output"]);
});
check("a failed FlowMesh run: the result's failed steps, then the status view if it adds something", () => {
	const outputs = [{ task_id: "t1", name: "train", result: { ok: true } }, { task_id: "t2", name: "eval", error: "CUDA out of memory at /home/u/x.py" }];
	eq(runProblems({ outputs, status: { error: "CUDA out of memory at /home/u/x.py", failed_step: "eval" } }),
		[{ step: "eval", why: "CUDA out of memory at (internal path)" }]);
	eq(runProblems({ outputs: [], status: { error: { message: "worker lost" }, failed_step: "train" } }).map(problemLine),
		["The step “train” failed: worker lost"]);
	eq(runProblems({ status: { error: "boom" } }).map(problemLine), ["boom"]);
	eq(runProblems({}), []);
});
check("a result that could not be read", () => {
	eq(resultUnavailableLine("failed", "compute service returned 409: job not finished yet"), "This run saved no result.");
});

check("row words: label, status, button, cap", () => {
	eq(runLabel({ name: " paper counts ", kind: "ll", site: "nus" }), "paper counts");
	eq(runLabel({ kind: "ll", site: "nus" }), "Lumilake compute graph on nus");
	eq(runLabel({ name: "", kind: "fm", site: "home" }), "FlowMesh compute graph on home");
	eq(fleetStatusWord("succeeded"), "Done");
	eq(fleetStatusWord("queued"), "Waiting");
	eq(resultButtonLabel("failed", false), "Why it failed");
	eq(resultButtonLabel("succeeded", false), "Result");
	eq(resultButtonLabel("succeeded", true), "Hide");
	eq(latestRunsNote(100, 100), "Showing your latest 100 runs");
	eq(latestRunsNote(12, 100), null);
});

check("the model and prompt behind a run's pictures", () => {
	eq(picturesContext([{ task_id: "t", result: { model: "stabilityai/sd-turbo", images: [{ path: "images/a.png" }] } }]),
		{ model: "stabilityai/sd-turbo" });
	eq(picturesContext([{ task_id: "t", result: { model: "m", prompt: "a red fox", images: ["a.png"] } }]),
		{ model: "m", prompt: "a red fox" });
	eq(picturesContext([{ task_id: "t", result: { prompts: ["a", "b"], images: ["a.png"] } }]), { prompt: "a · b" });
	eq(picturesContext([{ task_id: "t", result: { model: "m" } }]), null);
	eq(picturesContext({ outputs: {} }), null);
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

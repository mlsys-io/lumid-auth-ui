// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeRunRow, MeWorkflowRow } from "@/api/me";
import { runRowName, runRowDetail, appLabels, workflowTitles, runRowWhen, RUN_STATE_FILTERS, workflowFilterOptions, compareSelection } from "./runs-list";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (app: string, loop: string, ts = "20261127T124434Z", p: Partial<MeRunRow> = {}): MeRunRow => ({
	run_id: `scheduled:${app}:${loop}:${ts}`, workflow_slug: `${app}:${loop}`, kind: "scheduled", name: loop, app,
	state: "succeeded", started_at: 1795788785, ...p,
});
const wf = (app: string, loop: string, title?: string): MeWorkflowRow =>
	({ slug: `${app}:${loop}`, kind: "scheduled", name: loop, app, title, trigger: "manual", enabled: true, tenant: true }) as MeWorkflowRow;

check("plain names: the title when known, else the id in words — never the raw slug", () => {
	const titles = workflowTitles([wf("quant-research", "stock_backtests", "Stock backtests"), wf("mbb-consultant", "interview")]);
	const r = row("quant-research", "stock_backtests");
	eq(runRowName(r, titles.get(r.workflow_slug)), "Stock backtests");
	eq(runRowName(row("quant-research", "kol_poll")), "KOL poll");
	eq(runRowName(row("mbb-consultant", "interview"), titles.get("mbb-consultant:interview")), "Interview");
	eq(runRowName({ ...row("", ""), kind: "job", run_id: "job:1", workflow_slug: "", name: "Load tick data" }), "Load tick data");
	eq(runRowName({ ...row("", ""), kind: "job", run_id: "job:1", workflow_slug: "", name: "job_123" }), "Data job");
	eq(titles.size, 1);
});
check("start time on one line", () => {
	const w = runRowWhen(1795788785);
	if (!w || w.includes("\n")) throw new Error(w);
	eq(runRowWhen(0), "");
});
check("every state is offered, including skipped, canceled and queued", () => {
	eq(RUN_STATE_FILTERS.map((s) => s.value), ["", "succeeded", "failed", "running", "queued", "skipped", "canceled"]);
});
check("workflow filter: by app, in words, one app when filtered", () => {
	const rows = [wf("quant-research", "stock_backtests", "Stock backtests"), wf("quant-research", "backtest", "Backtest"), wf("mlsys-research", "simulate")];
	eq(workflowFilterOptions(rows), [
		{ app: "mlsys-research", options: [{ value: "mlsys-research:simulate", label: "Simulate" }] },
		{ app: "quant-research", options: [{ value: "quant-research:backtest", label: "Backtest" }, { value: "quant-research:stock_backtests", label: "Stock backtests" }] },
	]);
	eq(workflowFilterOptions(rows, "mlsys-research").length, 1);
});
check("compare: one app, 2–5 workflow runs, otherwise say why", () => {
	eq(compareSelection([row("q", "a")]).reason, "Tick two to five runs to compare them.");
	const ok = compareSelection([row("quant-research", "backtest", "20261126T150030Z"), row("quant-research", "stock_backtests")]);
	eq([ok.ok, ok.label, ok.href], [true, "Compare 2", "/studio/apps/quant-research/compare?runs=backtest:20261126T150030Z,stock_backtests:20261127T124434Z"]);
	eq(compareSelection([row("a", "x"), row("b", "y")]).reason, "Compare runs of one app at a time — these are from 2 apps.");
	eq(compareSelection([row("a", "x"), { ...row("a", "y"), run_id: "job:7", kind: "job" }]).reason, "Only workflow runs can be compared — 1 of these is a data job or other run.");
	eq(compareSelection([1, 2, 3, 4, 5, 6].map((i) => row("a", "x", `2026112${i}T000000Z`))).reason, "Compare up to 5 runs at a time (6 ticked).");
});
check("detail in words; apps titled alike are told apart", () => {
	eq(runRowDetail(row("q", "a", undefined, { reason: "universe_refresh_queued" })), "Universe refresh queued");
	eq(runRowDetail(row("q", "a", undefined, { reason: "1 result(s): 1 on real data" })), "1 result(s): 1 on real data");
	eq(runRowDetail(row("q", "a", undefined, { state: "failed", reason: 'HTTP 500: {"detail":"x"}' })).includes("{"), false);
	eq(runRowDetail(row("q", "a")), "");
	const t = (a: string) => (a.startsWith("quant-research") ? "Quant Research" : "MLSys Research");
	const m = appLabels(["quant-research", "quant-research-e2e", "mlsys-research", "quant-research"], t);
	eq([m.get("quant-research"), m.get("quant-research-e2e"), m.get("mlsys-research")], ["Quant Research", "Quant Research (E2E)", "MLSys Research"]);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ runs-list: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

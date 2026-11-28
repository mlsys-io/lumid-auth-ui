// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { FleetJob } from "../api/fleet";
import {
	FLEET_SETTLE_S, answerTime, countOf, fleetAccessNote, fleetWhen, railAction, railFleetJobs, railToConfirm, runPlace,
	runSites, sandboxSitesWords, siteAnswerTitle, siteList, siteName, workflowsLine, type FleetFresh, startNowLine, workerName, workerStatusWords,
} from "./fleet-view";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

const NOW = Date.parse("2026-11-28T13:49:00Z") / 1000;
const job = (id: string, status: FleetJob["status"], minsAgo: number, site = "office"): FleetJob => ({
	id, site, kind: "fm", status, terminal: status === "succeeded" || status === "failed" || status === "canceled",
	name: `measure ${id}`, created_at: new Date((NOW - minsAgo * 60) * 1000).toISOString(),
});

check("the 2026-11-28 sweep: queued rows 2 h old that nobody could confirm are not 'Waiting'", () => {
	const listed = [job("a", "queued", 134), job("b", "queued", 134), job("c", "queued", 150)];
	eq(railFleetJobs(listed, new Map(), NOW).length, 0);
});

check("a fresh read wins over the list's cache: done jobs leave the rail", () => {
	const listed = [job("a", "queued", 5), job("b", "queued", 5)];
	const fresh = new Map<string, FleetFresh>([["a", { status: "succeeded", terminal: true }], ["b", { status: "running", terminal: false }]]);
	eq(railFleetJobs(listed, fresh, NOW).map((j) => `${j.id}:${j.status}`), ["b:running"]);
});

check("a confirmed long wait is shown: the job itself says it is still queued", () => {
	const fresh = new Map<string, FleetFresh>([["a", { status: "queued", terminal: false }]]);
	eq(railFleetJobs([job("a", "queued", 200)], fresh, NOW).length, 1);
});

check("an unconfirmed young job is shown from the cache; just past the settle time it is not", () => {
	eq(railFleetJobs([job("a", "running", 10)], new Map(), NOW).length, 1);
	const edge = FLEET_SETTLE_S / 60;
	eq(railFleetJobs([job("a", "queued", edge - 1)], new Map(), NOW).length, 1, "inside");
	eq(railFleetJobs([job("a", "queued", edge + 1)], new Map(), NOW).length, 0, "outside");
});

check("finished rows never reach the rail", () => {
	eq(railFleetJobs([job("a", "succeeded", 1), job("b", "failed", 1), job("c", "canceled", 1)], new Map(), NOW).length, 0);
});

check("only unfinished jobs are re-read, newest first, capped", () => {
	const listed = [job("a", "succeeded", 1), job("b", "queued", 2), job("c", "running", 3), job("d", "queued", 4)];
	eq(railToConfirm(listed, 2), ["b", "c"]);
});

check("the tile says where, with the site's own name", () => {
	eq(railAction({ status: "queued", site: "office" }), "Waiting at Office");
	eq(railAction({ status: "running", site: "nus" }), "Running at NUS");
	eq(railAction({ status: "queued", site: "" }), "Waiting");
	eq(siteName("vast"), "Vast");
	eq(siteName("lab7"), "Lab7");
});

check("counts have proper plurals", () => {
	eq(countOf(1, "live worker"), "1 live worker");
	eq(countOf(10, "live worker"), "10 live workers");
	eq(countOf(0, "node"), "0 nodes");
	eq(countOf(2, "stale row"), "2 stale rows");
});

check("site lists read as a sentence", () => {
	eq(siteList(["home"]), "home");
	eq(siteList(["home", "office"]), "home and office");
	eq(siteList(["office", "cloud", "vast", "nus"]), "office, cloud, vast and NUS");
});

check("workflow counts have proper plurals and name the sites", () => {
	eq(workflowsLine(33, ["home"]), "33 workflows on home");
	eq(workflowsLine(1, ["home"]), "1 workflow on home");
	eq(workflowsLine(0, ["home"]), "No workflows on home");
	eq(workflowsLine(120, ["home", "office", "nus"]), "120 workflows across home, office and NUS");
	eq(workflowsLine(4, []), "4 workflows");
});

check("answer times are seconds a person reads, never bare ms", () => {
	eq(answerTime(326), "0.3 s");
	eq(answerTime(40), "under 0.1 s");
	eq(answerTime(2450), "2.5 s");
	eq(answerTime(14_200), "14 s");
	eq(answerTime(undefined), "no answer");
	eq(siteAnswerTitle({ site: "home", ok: true, count: 33, ms: 326 }), "home answered in 0.3 s with 33 rows");
	eq(siteAnswerTitle({ site: "office", ok: false, error: "timeout" }), "office did not answer: timeout");
});

check("dates use the app's format, not a US locale string", () => {
	const w = fleetWhen("2026-11-28T11:45:12Z");
	ok(/28/.test(w) && /Nov/.test(w), `day and month in words: ${w}`);
	ok(!/2026|\//.test(w), `no year or slashes: ${w}`);
	eq(fleetWhen(undefined), "—");
	eq(fleetWhen("garbage"), "—");
});

check("a run's place replaces its raw id", () => {
	eq(runPlace({ site: "home", kind: "fm" }), "on Home");
	eq(runPlace({ site: "", kind: "ll" }), "Lumilake run");
});

check("the non-admin note says where their GPU work really runs", () => {
	const jobs = [job("a", "succeeded", 1, "office"), job("b", "succeeded", 1, "office"), job("c", "succeeded", 1, "home")];
	eq(runSites(jobs), [{ site: "office", runs: 2 }, { site: "home", runs: 1 }]);
	const lines = fleetAccessNote({ listed: "home", hidden: ["office", "cloud", "vast", "nus"], sandboxSites: ["home", "office"], jobs });
	eq(lines[0], "These are the home machines. Only admins see the machine lists for office, cloud, vast and NUS.");
	ok(/GPU measurements \(the GPU sandbox instrument\) run on office GPUs for everyone/.test(lines[1]), lines[1]);
	ok(/open a sandbox on home and office from Sandboxes/.test(lines[1]), lines[1]);
	eq(lines[2], "Your latest 3 runs ran on office (2) and home (1) — see Jobs → Your runs.");
	ok(!/restricted|mesh/i.test(lines.join(" ")), "no 'restricted', no retired 'mesh'");
	eq(fleetAccessNote({ listed: "home", hidden: ["office"], sandboxSites: ["home"], jobs: [] }).length, 2);
});

check("the Sandboxes subtitle names every site the person may use", () => {
	eq(sandboxSitesWords(false, ["home", "office"]), "On home and office.");
	eq(sandboxSitesWords(true, ["home", "office", "nus"]), "Every site.");
});

check("machines in words, and whether a run can start now", () => {
	eq([workerStatusWords("IDLE"), workerStatusWords("BUSY"), workerStatusWords(null)], ["free", "busy", "unknown"]);
	eq([workerName("cpu_0"), workerName("gpu_1"), workerName("wkr-3319")], ["CPU worker 1", "GPU worker 2", "wkr-3319"]);
	const w = (status: string, gpu: boolean) => ({ status, gpu });
	eq(startNowLine([
		{ site: "home", workers: [w("IDLE", true), w("IDLE", false), w("BUSY", true)] },
		{ site: "office", workers: [w("IDLE", true), w("IDLE", true), w("IDLE", false)] },
		{ site: "cloud", workers: [] },
	]), "A GPU run can start now: 3 GPU workers free (Home 1, Office 2). A CPU run can start too: 2 free.");
	eq(startNowLine([{ site: "office", workers: [w("BUSY", true), w("BUSY", true)] }]), "A GPU run waits: all 2 GPU workers are busy.");
	eq(startNowLine([{ site: "home", workers: [w("IDLE", false)] }]), "No GPU machine is answering, so a GPU run would wait. A CPU run can start too: 1 free.");
	eq(startNowLine([]), "No machine is answering right now, so a run would wait.");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ fleet-view: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

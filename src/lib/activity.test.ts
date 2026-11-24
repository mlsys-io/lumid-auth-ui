// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeRunRow } from "@/api/me";
import { groupActivity, plainCause, fmtDuration, fmtTypical, progressOf, isOverdue, loopOfRun, workflowStatusLine, nextFireSec, dirIdToSec, fmtAgo } from "./activity";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let t = 1_795_500_000;
const mk = (app: string, loop: string, state: MeRunRow["state"], extra: Partial<MeRunRow> = {}): MeRunRow => {
	t += 600;
	return {
		run_id: `scheduled:${app}:${loop}:${t}`, workflow_slug: `${app}:${loop}`, kind: "scheduled",
		name: loop, app, state, started_at: t, duration_s: 50, ...extra,
	};
};

// ── plainCause: the real reasons seen on lum.id (2026-11-24) ──
check("HTTP 500 with a JSON body", () =>
	eq(plainCause('HTTP 500: {"detail":"internal server error","request_id":"22c5bdde-4d3a"}'), "Server error (HTTP 500)"));
check("context + HTTP Error 503", () =>
	eq(plainCause("analyst call failed: HTTP Error 503: Service Unavailable"), "Analyst call failed: service unavailable (HTTP 503)"));
check("timeout", () => eq(plainCause("TimeoutError: The read operation timed out"), "Timed out"));
check("python dict outcome, plurals", () =>
	eq(plainCause("{'ok': False, 'outcome': '3 case(s), 12 question(s), 1 failure(s)', 'cases': ['Case_001']}"), "3 cases, 12 questions, 1 failure"));
check("every arm failed", () =>
	eq(plainCause("every arm failed: {'current': 'ComputeError: preview rejected (500): schedule preview fail'}"), "Every version failed: preview rejected: server error (HTTP 500)"));
check("snake outcome", () => eq(plainCause("backend_unavailable"), "Backend unavailable"));
check("exception class is noise", () =>
	eq(plainCause("ValueError: invalid literal for int() with base 10: 'Q1'"), "App error: invalid literal for int() with base 10: 'Q1'"));
check("plain text passes, capitalised", () =>
	eq(plainCause("nothing to answer: pass question= or case=+q="), "Nothing to answer: pass question= or case=+q="));
check("empty", () => eq(plainCause(""), "No reason recorded"));
check("argparse exit: the error part", () =>
	eq(plainCause("commands/simulate.py exited with status 2: [--seed SEED]; simulate: error: unrecognized arguments: --from-run 1795529333 — per-run arg(s) are not declared"), "App error: unrecognized arguments: --from-run 1795529333"));
check("exit with no error text", () => eq(plainCause("commands/x.py exited with status 137"), "The app's command stopped (exit 137)"));
check("argparse usage listing --timeout is not a timeout", () =>
	eq(plainCause("commands/sim.py exited with status 2: usage: sim [--timeout T]; sim: error: unrecognized arguments: --from-run 1"), "App error: unrecognized arguments: --from-run 1"));
check("a parenthesised count is not an HTTP code", () => eq(plainCause("dedupe failed (404 duplicate keys)"), "Dedupe failed (404 duplicate keys)"));
check("sub-second durations", () => eq(fmtDuration(0.723), "723ms"));
check("long text is clipped at a word", () => {
	const s = plainCause("x ".repeat(80) + "end");
	if (!s.endsWith("…") || s.length > 92) throw new Error(s);
});

// ── formatting ──
check("durations", () => { eq(fmtDuration(51.08), "51s"); eq(fmtDuration(100), "1m 40s"); eq(fmtDuration(7500), "2h 05m"); eq(fmtDuration(undefined), ""); });
check("typical", () => { eq(fmtTypical(51), "~51s"); eq(fmtTypical(1102), "~18 min"); eq(fmtTypical(0), ""); });
check("progress + overdue", () => {
	eq(progressOf(25, 50), 0.5); eq(progressOf(80, 50), 1); eq(progressOf(10, undefined), null);
	eq(isOverdue(70, 50), false); eq(isOverdue(120, 50), true); eq(isOverdue(14, 8), false);
});

// ── grouping ──
check("loop from slug", () => eq(loopOfRun(mk("quant-research", "kol_poll", "succeeded")), "kol_poll"));

check("a failing streak, oldest-first since, skips don't break it", () => {
	const rows = [
		mk("qr", "harvest", "succeeded"),
		mk("qr", "harvest", "failed", { reason: "HTTP 500: {}" }),
		mk("qr", "harvest", "skipped"),
		mk("qr", "harvest", "failed", { reason: "TimeoutError: x" }),
		mk("qr", "harvest", "failed", { reason: "HTTP 500: {}" }),
	];
	const a = groupActivity(rows);
	eq(a.failing.length, 1);
	const f = a.failing[0].failing!;
	eq(f.count, 3); eq(f.sinceSec, rows[1].started_at); eq(f.coversWindow, false); eq(f.cause, "Server error (HTTP 500)");
	eq(f.latestRunId, rows[4].run_id);
});
check("every run failed → covers the window", () => {
	const a = groupActivity([mk("qr", "h", "failed"), mk("qr", "h", "failed")]);
	eq(a.failing[0].failing!.coversWindow, true);
});
check("recovered workflow is not failing", () => {
	const a = groupActivity([mk("qr", "h", "failed"), mk("qr", "h", "succeeded")]);
	eq(a.failing.length, 0);
});
check("running run listed with its workflow's typical duration", () => {
	const rows = [mk("qr", "bt", "succeeded", { duration_s: 40 }), mk("qr", "bt", "succeeded", { duration_s: 60 }), mk("qr", "bt", "running", { duration_s: undefined })];
	const a = groupActivity(rows);
	eq(a.running.length, 1); eq(a.running[0].wf.typicalS, 50); eq(a.running[0].wf.spark, "oo.");
});
check("a running run does not hide a failing streak", () => {
	const a = groupActivity([mk("qr", "h", "failed"), mk("qr", "h", "running")]);
	eq(a.failing.length, 1); eq(a.running.length, 1);
});
check("spark is newest 14, oldest → newest, with cycle ids", () => {
	const rows = Array.from({ length: 16 }, (_, i) => mk("qr", "p", i % 2 ? "failed" : "succeeded"));
	const w = groupActivity(rows).apps[0].workflows[0];
	eq(w.spark.length, 14); eq(w.spark.slice(-1), "x"); eq(w.sparkRuns.length, 14);
	if (!/^\d{8}T\d{6}Z$/.test(w.sparkRuns[13].ts)) throw new Error(w.sparkRuns[13].ts);
});
check("apps: running first, then failing, then recent; app filter", () => {
	const rows = [mk("a", "x", "succeeded"), mk("b", "y", "failed"), mk("c", "z", "running")];
	eq(groupActivity(rows).apps.map((a) => a.app), ["c", "b", "a"]);
	eq(groupActivity(rows, { app: "b" }).apps.map((a) => a.app), ["b"]);
});

// ── workflow page: the status line and the next scheduled run ──
const NOW = Date.UTC(2026, 10, 24, 14, 20, 0) / 1000; // 24 Nov 14:20Z
const cyc = (ts: string, ok?: boolean, running?: boolean) => ({ ts, ok, running, duration_s: 51 });
check("dir-id parses to epoch", () => eq(dirIdToSec("20261124T141039Z"), Date.UTC(2026, 10, 24, 14, 10, 39) / 1000));
check("fmtAgo", () => { eq(fmtAgo(NOW - 30, NOW), "just now"); eq(fmtAgo(NOW - 720, NOW), "12m ago"); eq(fmtAgo(NOW - 3 * 86400, NOW), "3d ago"); });
check("status: never ran / first run going", () => {
	eq(workflowStatusLine([], NOW).text, "Hasn't run yet");
	eq(workflowStatusLine([cyc("20261124T141000Z", undefined, true)], NOW).text, "First run in progress");
});
check("status: last ok, ignoring the running one", () => {
	const l = workflowStatusLine([cyc("20261124T141800Z", undefined, true), cyc("20261124T140800Z", true)], NOW);
	eq(l.tone, "ok"); eq(l.text, "Last run succeeded 12m ago · took 51s");
});
check("status: one failure", () => eq(workflowStatusLine([cyc("20261124T140800Z", false), cyc("20261124T130800Z", true)], NOW).text, "Last run failed 12m ago"));
check("status: a streak after a success", () => {
	const l = workflowStatusLine([cyc("20261124T140800Z", false), cyc("20261123T140800Z", false), cyc("20261122T140800Z", false), cyc("20261121T140800Z", true)], NOW);
	eq(l.tone, "failing"); if (!/^Failing since .+ · 3 runs in a row$/.test(l.text)) throw new Error(l.text); eq(l.runId, "20261124T140800Z");
});
check("status: every loaded run failed", () => {
	const l = workflowStatusLine([cyc("20261124T140800Z", false), cyc("20261122T110800Z", false)], NOW);
	eq(l.text, "The last 2 runs all failed");
});
check("next fire: hourly at :07", () => {
	eq(nextFireSec("7 * * * *", NOW), Date.UTC(2026, 10, 24, 15, 7) / 1000);
	eq(nextFireSec("30 * * * *", NOW), Date.UTC(2026, 10, 24, 14, 30) / 1000);
	eq(nextFireSec("@hourly", NOW), Date.UTC(2026, 10, 24, 15, 0) / 1000);
});
check("next fire: every 10 min", () => eq(nextFireSec("*/10 * * * *", NOW + 60), Date.UTC(2026, 10, 24, 14, 30) / 1000));
check("next fire: timezone-dependent schedules give no time", () => {
	eq(nextFireSec("5 */2 * * *", NOW), null); eq(nextFireSec("7 13 * * *", NOW), null);
	eq(nextFireSec("@trigger", NOW), null); eq(nextFireSec("*/7 * * * *", NOW), null);
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

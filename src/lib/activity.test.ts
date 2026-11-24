// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeRunRow } from "@/api/me";
import { groupActivity, plainCause, fmtDuration, fmtTypical, progressOf, isOverdue, loopOfRun } from "./activity";

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

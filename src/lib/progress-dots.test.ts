// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeCycleDetail, MeRunStepEvent } from "@/api/me";
import {
	agoWords, dotSeconds, runDotWords, stepDotWords, windowDots, runDotsLabel, stepsSummary, stepsSpan, stepRows, stepsFromCycle,
	type StepDot,
} from "./progress-dots";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = 1_795_800_000;
const T = 1_795_500_000;
const ev = (step_id: string, a: number, b: number | null, ok = true, summary = ""): MeRunStepEvent =>
	({ step_id, stage: null, kind: "tool", started_at: T + a, ended_at: b == null ? null : T + b, ok, summary });
const detail = (p: Partial<MeCycleDetail>): MeCycleDetail => ({ app: "quant-research", loop: "backtest", ts: "20261127T120000Z", summary: {}, steps: [], ...p });

check("a run dot says when and how it went, in words", () => {
	eq(runDotWords({ id: "a", ok: false, ts: NOW - 3 * 3600 }, NOW), "Run 3 h ago — failed");
	eq(runDotWords({ id: "a", ok: true, running: true, ts: NOW - 120, label: "Backtest" }, NOW), "Backtest 2 min ago — running");
	eq(runDotWords({ id: "a", ok: true, ts: "nonsense" }, NOW), "Run — succeeded");
	eq(agoWords(NOW - 2 * 86400, NOW), "2 days ago");
	eq(agoWords(NOW - 86400, NOW), "1 day ago");
	eq(agoWords(NOW - 5, NOW), "just now");
});
check("run time: epoch seconds, a numeric string or a cycle-dir id", () => {
	eq(dotSeconds(1795500000), 1795500000);
	eq(dotSeconds("1795500000"), 1795500000);
	eq(dotSeconds("20261124T141039Z"), Date.UTC(2026, 10, 24, 14, 10, 39) / 1000);
	eq(dotSeconds(""), null);
});
check("a step dot says its state and time; an estimate says so", () => {
	eq(stepDotWords({ id: "1", label: "Backtest", state: "done", durationS: 44 }), "Backtest — done in 44s");
	eq(stepDotWords({ id: "1", label: "Submit", state: "failed", durationS: 3, note: "Server error (HTTP 500)" }), "Submit — failed after 3s: Server error (HTTP 500)");
	eq(stepDotWords({ id: "1", label: "Report", state: "waiting", estimated: true }), "Report — not started yet (estimated from the last run)");
	eq(stepDotWords({ id: "1", label: "Poll", state: "skipped" }), "Poll — skipped");
	eq(stepDotWords({ id: "1", label: "Score", state: "running" }), "Score — running");
});
check("long sequences keep the newest and count the rest", () => {
	const w = windowDots([1, 2, 3, 4, 5], 3);
	eq([w.shown, w.earlier, w.earlierText], [[3, 4, 5], 2, "+2 earlier"]);
	eq(windowDots([1, 2], 20).earlierText, "");
	eq(runDotsLabel(40, 20), "Last 20 runs");
	eq(runDotsLabel(7, 20), "Last 7 runs");
	eq(runDotsLabel(1, 20), "Last run");
	eq(runDotsLabel(0, 20), "No runs yet");
});
const S: StepDot[] = [
	{ id: "a", label: "Read", state: "done", startedAt: T, durationS: 19 },
	{ id: "b", label: "Backtest", state: "failed", startedAt: T + 19, durationS: 25, note: "Server error (HTTP 500)" },
	{ id: "c", label: "Report", state: "skipped", startedAt: T + 44, durationS: 0 },
];
check("the steps line and span, in words", () => {
	eq(stepsSummary(S), "1 of 3 steps done · 1 failed · 1 skipped");
	eq(stepsSummary([]), "No steps reported");
	eq(stepsSpan(S), "took 44s");
	const live: StepDot[] = [{ id: "a", label: "Read", state: "done", startedAt: T, durationS: 19 }, { id: "b", label: "Score", state: "running", startedAt: T + 19 }];
	eq(stepsSpan(live, T + 2152), "+0:00 — +35:52");
	eq(stepsSpan([{ id: "a", label: "x", state: "done", durationS: 3 }, { id: "b", label: "y", state: "done", durationS: 4 }]), "took 7s");
});
check("list rows: +m:ss, failures open, older rows quieter", () => {
	const r = stepRows(S);
	eq(r.map((x) => x.offset), ["+0:00", "+0:19", "+0:44"]);
	eq(r.map((x) => x.open), [false, true, false]);
	eq(r[1].took, "25s");
	eq(r[2].took, "", "a skipped step took no time worth saying");
	const many: StepDot[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), label: `S${i}`, state: "done" as const, startedAt: T + i, durationS: 1 }));
	eq(stepRows(many).map((x) => x.quiet), [2, 2, 1, 1, 1, 1, 1, 0, 0, 0]);
	const waiting = stepRows([{ id: "a", label: "A", state: "running", startedAt: T }, { id: "b", label: "B", state: "waiting" }]);
	eq([waiting[0].took, waiting[1].offset, waiting[1].quiet], ["running", "", 0]);
});
check("steps from a run: events first, then steps; failures in plain words", () => {
	const d = detail({ events: [ev("read_tape", 0, 4), ev("submit", 4, 7, false, 'HTTP 500: {"detail":"x"}'), ev("poll", 7, 8, true, "skipped: nothing open")] });
	const s = stepsFromCycle(d);
	eq(s.map((x) => [x.label, x.state, x.durationS]), [["Read tape", "done", 4], ["Submit", "failed", 3], ["Poll", "skipped", 1]]);
	if (!s[1].note || /\{/.test(s[1].note)) throw new Error(`raw error reached the note: ${s[1].note}`);
	const fromSteps = stepsFromCycle(detail({ steps: [{ step_id: "engine_command", ok: true, duration_s: 3.2 }] }));
	eq(fromSteps.map((x) => [x.label, x.state, x.durationS]), [["Ran backtest", "done", 3.2]]);
	eq(stepsFromCycle(null), []);
	eq(stepsFromCycle(detail({})), []);
});
check("a running run: the step it is on breathes, steps it has not reached are waiting", () => {
	const tpl = [ev("read", 0, 10), ev("score", 10, 20), ev("report", 20, 30)];
	const live = stepsFromCycle(detail({ running: true, events: [ev("read", 0, 10), ev("score", 10, null)] }), { template: tpl });
	eq(live.map((x) => x.state), ["done", "running", "waiting"]);
	eq(live[2].estimated, true);
	// Nothing reported yet: placed on the last run's steps by elapsed time.
	const est = stepsFromCycle(detail({ running: true }), { template: tpl, elapsedS: 15 });
	eq(est.map((x) => x.state), ["done", "running", "waiting"]);
	eq(est.every((x) => x.estimated), true);
	// No template: nothing invented.
	eq(stepsFromCycle(detail({ running: true }), { elapsedS: 15 }), []);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ progress-dots: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

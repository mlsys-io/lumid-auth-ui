// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeRunStepEvent } from "@/api/me";
import { buildTimeline, fmtOffset, stepName, timelineWorthShowing, estimateSteps, eventHeld } from "./run-timeline";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const T = 1_795_500_000;
const ev = (step_id: string, stage: MeRunStepEvent["stage"], a: number, b: number | null, ok = true, summary = "", kind: MeRunStepEvent["kind"] = "tool"): MeRunStepEvent =>
	({ step_id, stage, kind, started_at: T + a, ended_at: b == null ? null : T + b, ok, summary });

check("offsets", () => { eq(fmtOffset(19), "+0:19"); eq(fmtOffset(725), "+12:05"); eq(fmtOffset(3727), "+1:02:07"); });
check("step names", () => {
	eq(stepName("engine_command", "harvest_outbox"), "Ran harvest outbox");
	eq(stepName("score_docs"), "Score docs");
	eq(stepName("engine_compute"), "Ran on the compute fleet");
});
check("groups by stage in run order, failure in words", () => {
	const t = buildTimeline([
		ev("read_tape", "observe", 0, 4), ev("pick_signal", "hypothesize", 4, 10, true, "", "llm"),
		ev("submit", "act", 10, 72, false, 'HTTP 500: {"detail":"x"}'), ev("note", "learn", 72, 73),
	]);
	eq(t.groups.map((g) => g.stage), ["Observe", "Hypothesize", "Act", "Learn"]);
	eq(t.rows.map((r) => r.offset), ["+0:00", "+0:04", "+0:10", "+1:12"]);
	eq(t.rows[1].kind, "model call");
	eq(t.rows[2].duration, "1m 02s");
	eq(t.failure, "Failed at Act — Submit: Server error (HTTP 500)");
	eq(t.total, "1m 13s");
});
check("a returning stage gets its own group", () =>
	eq(buildTimeline([ev("a", "act", 0, 1), ev("b", "analyze", 1, 2), ev("c", "act", 2, 3)]).groups.map((g) => g.stage), ["Act", "Analyze", "Act"]));
check("running: only the open last step pulses", () => {
	const t = buildTimeline([ev("a", "act", 0, 1), ev("b", "analyze", 1, null)], { running: true });
	eq(t.rows.map((r) => r.running), [false, true]);
	eq(t.failure, null);
});
check("estimate: where a running run probably is, from the last run's steps", () => {
	const tpl = [ev("read", "observe", 0, 10), ev("draft", "hypothesize", 10, 70, true, "", "llm"), ev("judge", "act", 70, 100)];
	const e = estimateSteps(tpl, 30)!;
	eq(e.steps.map((s) => s.state), ["done", "now", "next"]);
	eq(e.now, { name: "Draft", stage: "Hypothesize" });
	const over = estimateSteps(tpl, 500)!;
	eq(over.beyond, true); eq(over.now?.name, "Judge");
	eq(estimateSteps([ev("engine_command", null, 0, 60)], 10), null);
});
check("worth showing", () => {
	eq(timelineWorthShowing([ev("engine_command", null, 0, 60, false)]), false);
	eq(timelineWorthShowing([ev("engine_command", "act", 0, 60)]), true);
	eq(timelineWorthShowing([ev("a", null, 0, 1), ev("b", null, 1, 2)]), true);
	eq(timelineWorthShowing(undefined), false);
});

check("a held stage reads held (not run), not failed", () => {
	const t = buildTimeline([ev("simulate", null, 0, 1, true, "done", "stage"), { step_id: "sandbox", stage: null, kind: "stage", started_at: null, ended_at: null, ok: false, summary: "held" }]);
	eq(t.failure, null);
	eq(t.held, "Sandbox held (not run)");
	eq([t.rows[1].held, t.rows[1].ok, t.rows[1].summary], [true, true, "held (not run)"]);
	eq(eventHeld({ ok: false, summary: "Held" }), true);
	eq(eventHeld({ ok: true, summary: "held" }), false);
	// A real failure still says so.
	eq(buildTimeline([ev("x", null, 0, 1, false, "boom")]).held, null);
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

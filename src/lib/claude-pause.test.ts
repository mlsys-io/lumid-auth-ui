// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { OVERRIDE_WINDOW_MS, pauseLabel, pauseState } from "./claude-pause";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const now = new Date("2026-11-25T05:00:00Z");
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

check("pause: an unpaused account has no pause state", () => {
	eq(pauseState({}, now).kind, "none");
});

check("pause: before pause_enforced_at it is the grace, and says when sessions move", () => {
	const s = pauseState({ draining_since: iso(-60_000), pause_enforced_at: iso(240_000) }, now);
	eq(s.kind, "grace");
	if (!pauseLabel(s).includes("live sessions move")) throw new Error(pauseLabel(s));
});

check("pause: after the grace with no recent override it is holding", () => {
	eq(pauseState({ draining_since: iso(-3_600_000), pause_enforced_at: iso(-3_000_000) }, now).kind, "holding");
});

// The 2026-11-25 case: "paused" while the backstop kept serving it.
check("pause: a recent backstop override wins, even inside the grace", () => {
	const s = pauseState({
		draining_since: iso(-120_000), pause_enforced_at: iso(180_000), drain_overridden_at: iso(-30_000),
	}, now);
	eq(s.kind, "overridden");
	eq(pauseLabel(s), "paused · still serving");
});

check("pause: an old override stops showing", () => {
	eq(pauseState({
		draining_since: iso(-3_600_000), pause_enforced_at: iso(-3_000_000),
		drain_overridden_at: iso(-OVERRIDE_WINDOW_MS - 1000),
	}, now).kind, "holding");
});

check("pause: an older identity without pause_enforced_at reads as plain paused", () => {
	const s = pauseState({ draining_since: iso(-60_000) }, now);
	eq(s.kind, "holding");
	eq(pauseLabel(s), "paused");
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

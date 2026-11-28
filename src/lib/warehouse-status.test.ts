// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { freshnessLine, FRESHNESS_WHY, sourcesLine, offlineLine, offlineWhy, DATA_STARTERS } from "./warehouse-status";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("freshness says what is counted, worst first, nothing for zero", () => {
	eq(freshnessLine({ green: 201, amber: 1, red: 60, gray: 35 }), "201 of 297 feeds on schedule · 60 overdue · 1 slightly behind · 35 never refreshed");
	eq(freshnessLine({ green: 112, amber: 0, red: 115, gray: 43 }), "112 of 270 feeds on schedule · 115 overdue · 43 never refreshed");
	eq(freshnessLine({ green: 1, amber: 0, red: 0, gray: 0 }), "1 of 1 feed on schedule");
	eq(freshnessLine({ green: 0, amber: 0, red: 0, gray: 0 }), null);
	eq(freshnessLine(undefined), null);
	eq(freshnessLine({ green: 5 } as never), "5 of 5 feeds on schedule");
});
check("the tooltip defines every state with the view's real thresholds", () => {
	for (const w of ["On schedule", "Slightly behind", "Overdue", "Never refreshed", "daily: 1 day", "over 3 days", "quarterly: 95"]) {
		if (!FRESHNESS_WHY.includes(w)) throw new Error(`missing ${w}`);
	}
	if (/\b(fresh|stale|unknown)\b/i.test(FRESHNESS_WHY)) throw new Error("uses the old words");
});
check("sources: 'N of M reachable', all when all, loading said", () => {
	eq(sourcesLine(3, 4, 25, 300), "3 of 4 sources reachable · 25 schemas · 300 tables · read-only");
	eq(sourcesLine(4, 4, 1, 1), "All 4 sources reachable · 1 schema · 1 table · read-only");
	eq(sourcesLine(2, 4, 20, 250, 1), "2 of 4 sources reachable (1 still loading) · 20 schemas · 250 tables · read-only");
});
check("an offline source says so in words, with what still works", () => {
	eq(offlineLine("LQT Data", 3), "LQT Data isn't answering right now. Its tables can't be browsed for now; the other 3 sources still work.");
	eq(offlineLine("LQT Data", 1), "LQT Data isn't answering right now. Its tables can't be browsed for now; the other source still works.");
	eq(offlineLine("LQT Data", 0), "LQT Data isn't answering right now. Its tables can't be browsed for now.");
	const why = offlineWhy("HTTP 502: Bad Gateway");
	if (!why.includes("502") || why.includes("{")) throw new Error(why);
	eq(offlineWhy("").startsWith("No reason recorded"), true);
});
check("two or three plain starter questions", () => {
	eq(DATA_STARTERS.length >= 2 && DATA_STARTERS.length <= 3, true);
	for (const q of DATA_STARTERS) if (!q.endsWith("?") || /_[a-z]/.test(q)) throw new Error(q);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ warehouse-status: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

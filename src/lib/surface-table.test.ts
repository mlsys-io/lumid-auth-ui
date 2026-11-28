// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import {
	isNameColumn, looksLikeId, isExampleName, nameDisplay, examplesLast, studioWhen, rowNoun,
	tableCountLine, hiddenToggleLabel, statFigure, whenMs, whenFull,
} from "./surface-table";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("a name column is the untyped name/title one", () => {
	eq(isNameColumn({ key: "name" }), true);
	eq(isNameColumn({ key: "strategy_name" }), true);
	eq(isNameColumn({ key: "name", type: "badge" }), false);
	eq(isNameColumn({ key: "status" }), false);
	eq(isNameColumn({ key: "strategy_id" }), false);
});
check("ids vs words: snake/kebab ids yes; spaces, uuids, hashes, numbers no", () => {
	eq(["qr_fwd_e3qi", "silent_arm_demo", "momentum-30m"].map(looksLikeId), [true, true, true]);
	eq(["Alpha 001 Options Gap", "momentum", "11111111-2222-3333-4444-555555555555", "a3f9c2d1e4b5a6c7", "1.0.2", ""].map(looksLikeId), [false, false, false, false, false, false]);
});
check("seeded examples: *_demo / demo_* / *-example", () => {
	eq(["silent_arm_demo", "demo_strategy", "kol-example", "demolition", "my_demonstration"].map(isExampleName), [true, true, true, false, false]);
});
check("the row's own title wins; else the id in words with the id kept; words stay", () => {
	eq(nameDisplay({ title: "Forward gap" }, "qr_fwd_e3qi"), { label: "Forward gap", raw: "qr_fwd_e3qi", example: false });
	eq(nameDisplay({ display_name: "Mean reversion (sample)" }, "mean_reversion_demo"), { label: "Mean reversion (sample)", raw: "mean_reversion_demo", example: true });
	eq(nameDisplay({}, "qr_fwd_e3qi"), { label: "Qr fwd e3qi", raw: "qr_fwd_e3qi", example: false });
	eq(nameDisplay({}, "Alpha 001 Options Gap"), { label: "Alpha 001 Options Gap", example: false });
	eq(nameDisplay({}, null), { label: "—", example: false });
});
check("an example's badge carries 'demo', so the label drops it", () => {
	eq(nameDisplay({}, "silent_arm_demo"), { label: "Silent arm", raw: "silent_arm_demo", example: true });
	eq(nameDisplay({}, "momentum_30m_demo").label, "Momentum 30m");
});
check("the reader's own rows first, examples after, order otherwise kept", () => {
	const rows = [{ name: "qr_fwd_e3qi" }, { name: "silent_arm_demo" }, { name: "Alpha 001" }, { name: "mean_reversion_demo" }, { name: "qr_fwd_l03l" }];
	eq(examplesLast(rows, (r) => r.name).map((r) => r.name), ["qr_fwd_e3qi", "Alpha 001", "qr_fwd_l03l", "silent_arm_demo", "mean_reversion_demo"]);
	const none = [{ name: "a" }, { name: "b" }];
	eq(examplesLast(none, (r) => r.name) === none, true, "unchanged list is the same array");
});
check("Studio time: short month, no seconds, year only when not this year", () => {
	const now = Date.UTC(2026, 10, 28, 12);
	const same = studioWhen(Date.UTC(2026, 10, 27, 6, 48, 29), now);
	if (!same || /2026/.test(same) || /:29\b/.test(same) || /\d+\/\d+\/\d+/.test(same)) throw new Error(same);
	const old = studioWhen(Date.UTC(2025, 7, 26, 13), now);
	if (!/2025/.test(old)) throw new Error(old);
	eq(studioWhen(0, now), "");
	eq(studioWhen(NaN, now), "");
});
check("timestamps from both wire shapes; zero time and 0 are never", () => {
	eq(whenMs(1795788785), 1795788785000);
	eq(whenMs(1795788785000), 1795788785000);
	eq(whenMs("1795788785"), 1795788785000);
	eq(whenMs("2026-11-27T06:48:29Z"), Date.UTC(2026, 10, 27, 6, 48, 29));
	eq(whenMs("0001-01-01T00:00:00Z"), null);
	eq(whenMs(0), null);
	eq(whenMs(""), null);
	eq(whenMs("not a date"), null);
	eq(typeof whenFull("2026-11-27T06:48:29Z"), "string");
	eq(whenFull(null), undefined);
});
check("counts say what is counted, and the toggle says what it does", () => {
	eq(rowNoun("strategies"), { one: "strategy", many: "strategies" });
	eq(rowNoun("data.cases"), { one: "case", many: "cases" });
	eq(rowNoun("matches"), { one: "match", many: "matches" });
	eq(rowNoun(undefined), { one: "row", many: "rows" });
	eq(rowNoun("rejected"), { one: "row", many: "rows" });
	eq(tableCountLine(36, rowNoun("strategies")), "36 strategies");
	eq(tableCountLine(1, rowNoun("strategies")), "1 strategy");
	eq(tableCountLine(1446, rowNoun("runs")), `${(1446).toLocaleString()} runs`);
	eq(hiddenToggleLabel(30, false), "Show 30 hidden");
	eq(hiddenToggleLabel(30, true), "Hide those 30 again");
});
check("stat figures: separators on whole numbers from 1,000", () => {
	eq(statFigure(1446), (1446).toLocaleString());
	eq(statFigure(36), "36");
	eq(statFigure("1.0.2"), "1.0.2");
	eq(statFigure(0.5), "0.5");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ surface-table: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

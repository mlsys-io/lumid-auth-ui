// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { readAppSpec, parseNewVersions, addVersions } from "./app-spec";
import {
	versionSettings, settingFields, addedField, inputDefaults, readField, sameValue, changeWords, buildSettings,
	versionIdFrom, sameSettingsAs, firstVersionSettings, nameHint, fieldChange, addsLine, sameSettingsWords, duplicateProblems, formVersion, versionsYaml, startsFromWords, showValue,
} from "./version-form";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// The shape a served version takes (flat), and the spec's own (`inputs:`).
const FIRST = {
	id: "baseline_momentum_12_1", title: "Baseline 12-1 momentum", about: "BASELINE",
	spec: { universe: "top_n_dollar_volume:100", rebalance: 21, costs: { bps: 1, half_spread_bps: 2 }, tickers: ["SPY", "QQQ"] },
	start: "2005-01-03", folds: 5, long_only: true, weights: [0.5, 0.5],
};

check("version form: settings drop the meta fields, served flat or under inputs", () => {
	eq(Object.keys(versionSettings(FIRST)), ["spec", "start", "folds", "long_only", "weights"]);
	eq(versionSettings({ id: "a", about: "x", inputs: { spec: { signal: "s" } } }), { spec: { signal: "s" } });
	eq(versionSettings(undefined), {});
});

check("version form: one field per setting, nested ones by their leaves, labelled in words", () => {
	const f = settingFields(versionSettings(FIRST));
	eq(f.map((x) => x.key), ["spec.universe", "spec.rebalance", "spec.costs.bps", "spec.costs.half_spread_bps", "spec.tickers", "start", "folds", "long_only", "weights"]);
	eq(f.map((x) => x.label), ["Spec · universe", "Spec · rebalance", "Costs · bps", "Costs · half spread (bps)", "Spec · tickers", "Start", "Folds", "Long only", "Weights"]);
	eq(f.map((x) => x.kind), ["text", "number", "number", "number", "list", "text", "number", "yesno", "list"]);
	eq(f.map((x) => x.initial), ["top_n_dollar_volume:100", "21", "1", "2", "SPY, QQQ", "2005-01-03", "5", true, "0.5, 0.5"]);
	eq(settingFields({ empty: {}, rows: [{ a: 1 }] }).map((x) => [x.key, x.kind, x.initial]), [["empty", "json", "{}"], ["rows", "json", "[{\"a\":1}]"]]);
});

check("version form: edits keep their type", () => {
	const f = Object.fromEntries(settingFields(versionSettings(FIRST)).map((x) => [x.key, x]));
	eq(readField(f["folds"], " 7 "), { value: 7 });
	eq("problem" in readField(f["folds"], "seven"), true);
	eq("problem" in readField(f["folds"], ""), true);
	eq(readField(f["spec.tickers"], "SPY, IWM ,"), { value: ["SPY", "IWM"] });
	eq(readField(f["weights"], "0.6, 0.4"), { value: [0.6, 0.4] });
	eq("problem" in readField(f["weights"], "0.6, x"), true);
	eq(readField(f["long_only"], false), { value: false });
	eq(readField(f["start"], "2010-01-04"), { value: "2010-01-04" });
	const j = settingFields({ rows: [{ a: 1 }] })[0];
	eq(readField(j, "[{a: 2}]"), { value: [{ a: 2 }] });
	eq("problem" in readField(j, "[{a: "), true);
});

check("version form: a change is marked against the first version", () => {
	const f = Object.fromEntries(settingFields(versionSettings(FIRST)).map((x) => [x.key, x]));
	eq(changeWords(f["start"], "2005-01-03"), null);
	eq(changeWords(f["start"], "2010-01-04"), "changed from 2005-01-03");
	eq(changeWords(f["long_only"], false), "changed from yes");
	eq(changeWords(f["spec.tickers"], ["SPY", "QQQ"]), null);
	eq(changeWords(addedField("end", "2025-10-31"), "2025-10-31")?.startsWith("added"), true);
	eq(showValue(null), "");
});

check("version form: settings are written back nested, untouched ones kept", () => {
	const base = versionSettings(FIRST);
	const fields = settingFields(base);
	const r = buildSettings(base, fields, { "spec.costs.bps": "3", start: "2010-01-04" });
	eq([r.problems, r.changed], [[], 2]);
	eq(r.settings, { ...base, spec: { ...FIRST.spec, costs: { bps: 3, half_spread_bps: 2 } }, start: "2010-01-04" });
	eq(base.start, "2005-01-03", "the first version is not mutated");
	const none = buildSettings(base, fields, {});
	eq([none.changed, sameValue(none.settings, base)], [0, true]);
	const bad = buildSettings(base, fields, { folds: "many" });
	eq(bad.problems, ["Folds: write a number."]);
	const added = buildSettings(base, [...fields, addedField("end", "2025-10-31")], {});
	eq([added.changed, added.settings.end], [1, "2025-10-31"]);
});

check("version form: the id comes from the name, unique and valid", () => {
	eq(versionIdFrom("Six-month momentum (top 500)", []), "six_month_momentum_top_500");
	eq(versionIdFrom("Six-month momentum", ["six_month_momentum", "six_month_momentum_2"]), "six_month_momentum_3");
	eq(versionIdFrom("12-1 momentum", []), "v_12_1_momentum");
	eq(versionIdFrom("  ", []), "version");
	eq(versionIdFrom("Café crème", []), "cafe_creme");
	const long = versionIdFrom("a".repeat(80), ["a".repeat(44)]);
	eq([long.length <= 48, /^[a-z][a-z0-9_]{0,47}$/.test(long)], [true, true]);
});

check("version form: the same settings as a version already there is caught", () => {
	const existing = [{ id: "baseline_momentum_12_1", label: "Baseline 12-1 momentum", settings: versionSettings(FIRST) }];
	const reordered = { folds: 5, start: "2005-01-03", long_only: true, weights: [0.5, 0.5], spec: { costs: { half_spread_bps: 2, bps: 1 }, tickers: ["SPY", "QQQ"], rebalance: 21, universe: "top_n_dollar_volume:100" } };
	eq(sameSettingsAs(reordered, existing)?.id, "baseline_momentum_12_1");
	eq(sameSettingsAs({ ...reordered, folds: 6 }, existing), null);
	eq(sameSettingsAs({ ...reordered, weights: [0.5] }, existing), null);
	eq(sameSettingsWords("Baseline 12-1 momentum"), "Same settings as Baseline 12-1 momentum — change something to make it a new try.");
	eq(duplicateProblems([{ id: "x", inputs: reordered }], existing), [sameSettingsWords("Baseline 12-1 momentum")]);
	eq(duplicateProblems([{ id: "a_one", inputs: { folds: 1 } }, { id: "a_two", inputs: { folds: 1 } }], existing), ["A two: Same settings as A one — change something to make it a new try."]);
});

check("version form: the form goes through the same parse and save as the text", () => {
	const v = formVersion({ id: "mom_6_1", name: " Six-month momentum ", about: "", settings: { spec: { signal: "lag(ret_105, 21)", costs: { bps: 1 } } } });
	eq(v, { id: "mom_6_1", title: "Six-month momentum", inputs: { spec: { signal: "lag(ret_105, 21)", costs: { bps: 1 } } } });
	const text = versionsYaml([v]);
	const r = parseNewVersions(text, ["baseline_m"], ["spec"]);
	eq([r.problems, r.versions], [[], [v]]);
	const spec = `experiments:\n  - id: s\n    workflow: w\n    versions:\n      - id: baseline_m\n        inputs: {spec: {signal: x}}\n`;
	eq(addVersions(spec, "s", r.versions).includes("costs:\n"), true);
});

check("version form: inputs the first version leaves at the workflow's value", () => {
	const spec = readAppSpec(`workflows:
  - id: a
    inputs: {start: "2021-01-04", spec: "@baseline:m"}
  - id: b
    inputs: {start: "1999-01-01", folds: 5}
  - id: chain
    steps: {workflows: [a, b]}
`);
	eq(inputDefaults(spec, "chain"), { start: "2021-01-04", spec: "@baseline:m", folds: 5 });
	eq(inputDefaults(spec, "nope"), {});
	eq(addedField("folds", 5).kind, "number");
});

check("version form: the first version from the served list, else the spec's template", () => {
	eq(firstVersionSettings([{ id: "a", spec: { x: 1 } }, { id: "b" }], ""), { spec: { x: 1 } });
	eq(firstVersionSettings([], "- id: a_2\n  about: x\n  inputs:\n    spec: {x: 2}\n"), { spec: { x: 2 } });
	eq(firstVersionSettings(undefined, "- id: [\n"), {});
	eq([nameHint(" "), nameHint("Six-month")], ["Give it a name first — that is what the map and the panel show.", null]);
});

check("version form: the mark under a field, and the line above Add", () => {
	const f = Object.fromEntries(settingFields(versionSettings(FIRST)).map((x) => [x.key, x]));
	eq([fieldChange(f["folds"], "5"), fieldChange(f["folds"], "6"), fieldChange(f["folds"], "six")], [null, "changed from 5", null]);
	eq(fieldChange(f["long_only"], true), null);
	eq(addsLine(["Six-month momentum"], 2), "Adds 1: Six-month momentum (2 settings changed). Nothing runs until you press Run.");
	eq(addsLine(["A", "B"]), "Adds 2: A, B. Nothing runs until you press Run.");
});

check("version form: where it starts, in words", () => {
	eq(startsFromWords("Baseline 12-1 momentum", 13), "Starts from Baseline 12-1 momentum — one of 13 versions here. Change what this one should try differently.");
	eq(startsFromWords("Current version", 1).includes("the only version so far"), true);
});

export const caseCount = checks.length;

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

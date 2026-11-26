// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { instrumentChoices, instrumentName, measuredBy } from "./measure";
import { measuredLine } from "./run-answer";
import { readAppSpec, setFeedback } from "./app-spec";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const registry = [
	{ name: "mlsys-simulator", about: "", share: "global", versions: ["v0.1.3"] },
	{ name: "lqt-backtest", about: "", share: "global", versions: ["harness 3"] },
	{ name: "mlsys-sandbox", about: "", share: "tenant", versions: ["sandbox-v0.1.0", "sandbox-v0.2.0"] },
];

check("a step's instrument in words, with its one accepted version", () => {
	eq(measuredBy("mlsys-simulator", registry), "Measured by the MLSys simulator (v0.1.3). Identical setups are measured once and reused for everyone.");
	eq(measuredBy("lqt-backtest", registry)?.startsWith("Measured by a backtest on recorded market history (harness 3). A backtest over a fixed past window"), true);
});
check("several accepted versions: none is named rather than guessed", () => {
	eq(measuredBy("mlsys-sandbox", registry), "Measured by the MLSys GPU sandbox. Every run is a fresh measurement on a real GPU; it is never reused.");
});
check("no instrument: no line; an unknown one is named as given", () => {
	eq(measuredBy("", registry), null);
	eq(measuredBy(undefined, registry), null);
	eq(instrumentName("forward-test"), "forward test");
	eq(measuredBy("forward-test", null), "Measured by forward test.");
});
check("choices come from the registry, else the known instruments", () => {
	eq(instrumentChoices(registry).map((c) => c.value), ["mlsys-simulator", "lqt-backtest", "mlsys-sandbox"]);
	eq(instrumentChoices(null).length, 3);
});
check("a reused result says so once", () => {
	eq(measuredLine({ measured_on: "Simulated RTX 5080 (mlsys-simulator v0.1.3)", reused: true })?.text,
		"Measured on Simulated RTX 5080 (mlsys-simulator v0.1.3) · reused from an identical run");
	eq(measuredLine({ measured_on: "Simulated RTX 5080 · reused from an identical run", reused: true })?.text,
		"Measured on Simulated RTX 5080 · reused from an identical run");
	eq(measuredLine({ measured_on: "RTX 5080 at office", reused: false })?.text, "Measured on RTX 5080 at office");
});
check("a feedback step's service survives a parse and an edit", () => {
	const text = "workflows:\n- id: simulate\n  feedback:\n  - step: simulator\n    service: mlsys-simulator  # shared\n    metrics:\n    - {name: objective, better: higher}\n";
	const spec = readAppSpec(text);
	eq(spec.workflows[0].feedback[0].service, "mlsys-simulator");
	const edited = setFeedback(text, "simulate", [{ ...spec.workflows[0].feedback[0], metrics: [{ name: "objective", better: "higher", target: 30 }] }]);
	const again = readAppSpec(edited);
	eq(again.workflows[0].feedback[0].service, "mlsys-simulator", "service after edit");
	eq(again.workflows[0].feedback[0].metrics[0].target, 30);
	const dropped = setFeedback(text, "simulate", [{ step: "simulator", metrics: [{ name: "objective", better: "higher" }] }]);
	eq(readAppSpec(dropped).workflows[0].feedback[0].service, undefined, "service removed");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ measure: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;

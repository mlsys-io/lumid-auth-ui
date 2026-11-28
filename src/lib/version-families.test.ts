// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Shapes are the live API's (2026-11-28): MLSys serve_9_2 / sla_model_size
// (overrides), Quant Research (top-level fields), Try setups ({id, seed}).
import type { MeExperiment } from "@/api/me";
import { buildResearchTree, pathTo } from "./research-map";
import { familyBestWords, familyLine, familyStatus, versionFamilies, versionSettings, withFamilies } from "./version-families";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const meta = { base: "baseline", study: "serve_9_2", task: "9.2" };
const arm = (size: string, model: string | null, c: number) => ({
	id: `llm_${size.replace(".", "_").toLowerCase()}_c${c}`, title: `${size} · concurrency ${c}`, ...meta,
	overrides: { ...(model ? { "deployments.model": model } : {}), "serving.max_concurrency": c },
});
const serveArms = [
	{ id: "llm_1_7b_c32", title: "1.7B · concurrency 32 (baseline)", ...meta, description: "The 9.2 template baseline (Qwen3 1.7B, max_concurrency 32)." },
	arm("1.7B", null, 4), arm("1.7B", null, 8), arm("1.7B", null, 16),
	...[4, 8, 12, 16, 32].map((c) => arm("0.6B", "llm-0.6b", c)),
	...[32, 4, 8, 12, 16].map((c) => arm("4B", "llm-4b", c)), // declared out of order on purpose
];
const serve = {
	id: "serve_9_2", title: "Serve 9.2", kind: "arms", status: "active", n_results: 6, comparable: true, criteria_met: false,
	baseline: "llm_1_7b_c32", best_variant: "llm_0_6b_c12",
	metric: { name: "energy_j_per_req", higher_is_better: false },
	arms: serveArms,
	variants: { llm_0_6b_c12: { n: 2, mean: 75.3 }, llm_0_6b_c4: { n: 2, mean: 90.1 }, llm_1_7b_c32: { n: 1, mean: 88 }, llm_1_7b_c8: { n: 1, mean: 81 } },
	loops: ["serve"],
} as unknown as MeExperiment;

check("families: serve_9_2 reads as 0.6B, 1.7B (with the baseline) and 4B", () => {
	const fs = versionFamilies(serve);
	eq(fs.map((f) => f.name).sort(), ["0.6B", "1.7B", "4B"]);
	const by = new Map(fs.map((f) => [f.name, f]));
	eq(by.get("1.7B")!.members, ["llm_1_7b_c4", "llm_1_7b_c8", "llm_1_7b_c16", "llm_1_7b_c32"]);
	eq(by.get("1.7B")!.key, "serving.max_concurrency");
	eq(fs.reduce((a, f) => a + f.members.length, 0), 14);
	// Ids are stable and distinct, with no colon past the experiment.
	eq(new Set(fs.map((f) => f.id)).size, 3);
	for (const f of fs) eq(f.id.split(":").length, 3, f.id);
});
check("families: the subtitle orders values as numbers; the baseline keeps its word", () => {
	const by = new Map(versionFamilies(serve).map((f) => [f.name, f]));
	eq(by.get("0.6B")!.sub, "concurrency 4 · 8 · 12 · 16 · 32");
	eq(by.get("4B")!.sub, "concurrency 4 · 8 · 12 · 16 · 32");
	eq(by.get("1.7B")!.sub, "concurrency 4 · 8 · 16 · 32 (baseline)");
	eq(familyLine(by.get("0.6B")!), "5 versions that differ only in concurrency");
});
check("families: status and best come from the best member", () => {
	const by = new Map(versionFamilies(serve).map((f) => [f.name, f]));
	const small = by.get("0.6B")!;
	eq([small.tag, small.lead], ["leading", "llm_0_6b_c12"]);
	eq(small.best?.id, "llm_0_6b_c12");
	eq(familyStatus(small).text, "Concurrency 12 leads the experiment");
	eq(familyBestWords(small), "Best: concurrency 12 — 75.3 J per request");
	// The grid's number at the furthest step wins over the averages.
	eq(familyBestWords(small, { version: "llm_0_6b_c4", value: 70, unit: "J per request", metric: "energy_j_per_req", step: "Sandbox" }), "Best: concurrency 4 — 70 J per request at Sandbox");
	const mid = by.get("1.7B")!;
	eq(mid.best?.id, "llm_1_7b_c8"); // 81 < 88, lower is better
	eq(mid.tag, "trying");
	eq(by.get("4B")!.tag, "not run yet");
	eq(familyStatus(by.get("4B")!).text, "None of its 5 versions has run yet");
});
check("families: sla_model_size is one family covering all — not grouped", () => {
	const sla = { id: "sla_model_size", kind: "arms", arms: [{ id: "llm_1_7b" }, { id: "llm_0_6b", overrides: { "deployments.model": "llm-0.6b" } }, { id: "llm_4b", overrides: { "deployments.model": "llm-4b" } }] } as unknown as MeExperiment;
	eq(versionFamilies(sla), []);
	eq(versionFamilies({ ...sla, arms: sla.arms!.slice(0, 2) } as MeExperiment), []); // under 3 versions
});
check("families: Quant Research top-level fields flatten to dotted keys", () => {
	const spec = { signal: "momentum", lookback: 20 };
	const q = { id: "costs_sweep", kind: "arms", arms: [
		{ id: "c1", description: "d", spec, costs: { bps: 1, half_spread_bps: 2 }, eval_start: "2024-01-01", n_trials: 3 },
		{ id: "c5", spec, costs: { bps: 5, half_spread_bps: 2 }, eval_start: "2024-01-01", n_trials: 3 },
		{ id: "c10", spec, costs: { bps: 10, half_spread_bps: 2 }, eval_start: "2024-01-01", n_trials: 3 },
		{ id: "rev", spec: { signal: "reversal", lookback: 20 }, costs: { bps: 1, half_spread_bps: 2 }, eval_start: "2024-01-01", n_trials: 3 },
	] } as unknown as MeExperiment;
	eq([...versionSettings(q.arms as Array<Record<string, unknown>>).byId.get("c1")!.keys()], ["spec.signal", "spec.lookback", "costs.bps", "costs.half_spread_bps", "eval_start", "n_trials"]);
	const fs = versionFamilies(q);
	eq(fs.length, 1);
	eq(fs[0].key, "costs.bps");
	eq(fs[0].members, ["c1", "c5", "c10"]);
	eq(fs[0].sub, "bps 1 · 5 · 10");
	// No titles: the name says what they share, in words.
	eq(fs[0].name, "Signal momentum");
});
check("families: Try setups {id, seed} groups only when it doesn't cover everything", () => {
	const seeds = { id: "seeds", kind: "arms", arms: [{ id: "s1", seed: 1 }, { id: "s7", seed: 7 }, { id: "s3", seed: 3 }] } as unknown as MeExperiment;
	eq(versionFamilies(seeds), []);
	const mixed = { ...seeds, arms: [...seeds.arms!, { id: "wide", window: 60 }] } as unknown as MeExperiment;
	const fs = versionFamilies(mixed);
	eq(fs.map((f) => [f.key, f.members]), [["seed", ["s1", "s3", "s7"]]]);
	eq(fs[0].sub, "seed 1 · 3 · 7");
	eq(fs[0].name, "Window not set");
	// Ids alone carry no settings: nothing to group.
	eq(versionFamilies({ id: "x", kind: "arms", arms: [{ id: "a" }, { id: "b" }, { id: "c" }] } as unknown as MeExperiment), []);
});
check("families: titles sharing a tail name the family by it", () => {
	const e = { id: "m", kind: "arms", arms: [
		{ id: "a", title: "0.6B · concurrency 32", overrides: { model: "llm-0.6b", c: 32 } },
		{ id: "b", title: "4B · concurrency 32", overrides: { model: "llm-4b", c: 32 } },
		{ id: "c", title: "1.7B · concurrency 8", overrides: { c: 8 } },
	] } as unknown as MeExperiment;
	const fs = versionFamilies(e);
	eq(fs.map((f) => [f.name, f.sub]), [["concurrency 32", "model 0.6B · 4B"]]);
});
check("tree: a family is one node under its experiment; members only in the list", () => {
	const t = buildResearchTree("mlsys", [serve], [], [{ id: "serve" }]);
	const map = withFamilies(t, [serve]);
	eq(map.nodes.filter((n) => n.kind === "version").length, 0);
	const fams = map.nodes.filter((n) => n.kind === "family");
	eq(fams.length, 3);
	eq(fams.every((n) => n.parent === "exp:serve_9_2" && n.depth === 3), true);
	eq(map.edges.filter((e) => e.source === "exp:serve_9_2").length, 3);
	// A hidden version selects as its family on the map.
	const small = [...map.families.values()].find((f) => f.name === "0.6B")!;
	eq(map.drawnAs.get("ver:serve_9_2:llm_0_6b_c12"), small.id);
	const list = withFamilies(t, [serve], { members: true });
	const kids = list.nodes.filter((n) => n.parent === small.id);
	eq(kids.map((n) => n.ref), small.members);
	eq(kids.every((n) => n.kind === "version" && n.depth === 4), true);
	eq(pathTo(list.nodes, small.id).size, 3 + 1 + 5); // app, workflow, experiment, family, 5 versions
	// An experiment that doesn't group is left exactly as it was.
	const plain = withFamilies(buildResearchTree("q", [{ id: "e", kind: "arms", arms: [{ id: "a" }, { id: "b" }] } as unknown as MeExperiment], []), []);
	eq(plain.nodes.filter((n) => n.kind === "version").length, 2);
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

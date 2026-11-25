// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { modelShortLabel } from "./model-label";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("claude models: just the model", () => {
	eq(modelShortLabel({ id: "claude-code-sonnet", display_name: "Claude Sonnet (Code)" }), "Sonnet");
	eq(modelShortLabel({ id: "claude-code-fable", display_name: "Claude Fable 5 (Code)" }), "Fable 5");
});
check("the name comes from display_name, not the historical id", () => {
	eq(modelShortLabel({ id: "claude-code-qwen35", display_name: "DeepSeek-V4.1-Flash (Code)" }), "DeepSeek · Code");
	eq(modelShortLabel({ id: "deepseek-v4.1-flash", display_name: "DeepSeek-V4.1-Flash (Chat)" }), "DeepSeek");
	eq(modelShortLabel({ id: "lumid-qwen38-27b", display_name: "Qwen3.8-27B (Chat)" }), "Qwen3.8-27B");
	eq(modelShortLabel({ id: "claude-code-flash-next", display_name: "Qwen3.8 Flash-Next (Code)" }), "Qwen3.8 Flash-Next · Code");
});
check("older names with a location suffix still read cleanly", () => {
	eq(modelShortLabel({ id: "lumid-qwen38-27b", display_name: "Qwen3.8-27B (Chat · Lumid GPU)" }), "Qwen3.8-27B");
});
check("no name: a short id", () => {
	eq(modelShortLabel({ id: "x", display_name: "" }), "x");
	eq(modelShortLabel({ id: "some-very-long-model-id" }), "some-very-lo…");
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

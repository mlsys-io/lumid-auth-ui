// A sandbox that is not working says why. Run by scripts/test-workflow.mjs via
// src/workflow/workflow.test.ts (the repo has no standalone test runner).
import { sandboxDetail, sandboxToShell, type Sandbox } from "./sandboxes";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const base: Sandbox = { name: "dev", pod: "sbx-bob-dev", phase: "Running", gpu: 1 };

check("healthy sandbox keeps the pod name as its detail", () => eq(sandboxDetail(base), "sbx-bob-dev"));

check("Queued still reports what it waits for", () =>
	eq(sandboxDetail({ ...base, phase: "Queued", gpus_free: "0/4", waiting_for: "Insufficient nvidia.com/gpu" }),
		"0/4 GPUs free. Insufficient nvidia.com/gpu"));

check("Failed sandbox shows the reason and the plain-language hint (2026-10-12 report)", () => {
	const d = sandboxDetail({ ...base, phase: "Failed", reason: "StartError", message: "nvml error: driver/library version mismatch", hint: "The GPU driver on that machine is out of sync" });
	eq(d, "StartError - The GPU driver on that machine is out of sync");
});

check("no hint -> the raw message is shown instead", () =>
	eq(sandboxDetail({ ...base, phase: "Failed", reason: "Error", message: "exit 1" }), "Error - exit 1"));

check("shell row carries the detail and the full sandbox for the disclosure", () => {
	const s: Sandbox = { ...base, phase: "Failed", reason: "OOMKilled", hint: "ran out of memory", events: [{ reason: "Failed", message: "m", count: 1, at: "2026-10-12T05:00:00Z" }] };
	const r = sandboxToShell(s);
	eq(r.state, "Failed");
	eq(r.detail, "OOMKilled - ran out of memory");
	eq(r.sandbox?.events?.length, 1);
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

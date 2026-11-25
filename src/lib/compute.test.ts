// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { capacityLine, capacityRows, queueItems, shortKind } from "./compute";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("GPU names read short", () => {
	eq(shortKind("NVIDIA GeForce RTX 5080"), "RTX 5080");
	eq(shortKind("NVIDIA RTX PRO 4000 Blackwell SFF Edition"), "RTX PRO 4000");
	eq(shortKind("NVIDIA RTX 6000 Ada Generation"), "RTX 6000 Ada");
	eq(shortKind("CPU"), "CPU");
});

// The live fleet as of 2026-11-25 (counts only).
const live = [
	{ site: "home", kind: "NVIDIA RTX PRO 4000 Blackwell SFF Edition", total: 5, busy: 5, idle: 0 },
	{ site: "home", kind: "CPU", total: 5, busy: 5, idle: 0 },
	{ site: "nus", kind: "CPU", total: 12, busy: 0, idle: 12 },
	{ site: "office", kind: "NVIDIA GeForce RTX 5080", total: 3, busy: 1, idle: 2 },
	{ site: "office", kind: "CPU", total: 5, busy: 1, idle: 4 },
];

check("capacity: by kind across sites, GPUs first, CPU last", () => {
	const rows = capacityRows(live);
	eq(rows.map((r) => r.label), ["RTX PRO 4000", "RTX 5080", "CPU"]);
	const cpu = rows.find((r) => r.label === "CPU")!;
	eq([cpu.total, cpu.busy, cpu.sites], [22, 6, ["home", "nus", "office"]]);
	eq(capacityLine(rows[0]), "all 5 in use");
	eq(capacityLine(rows[1]), "1 of 3 in use");
	eq(capacityLine({ ...rows[1], busy: 0 }), "3 free");
});

check("queue: waiting in drain order with their place; running with progress", () => {
	const q = queueItems([
		{ req_id: "a", loop: "simulate", state: "queued", position: 2, remaining: 1, variant_id: "c16" },
		{ req_id: "b", loop: "simulate", state: "running", remaining: 2, ran: 1, variant_id: "c32" },
		{ req_id: "c", loop: "simulate", state: "queued", position: 1, remaining: 3, branch_label: "c8" },
		{ req_id: "d", loop: "simulate", state: "done", remaining: 0, ran: 1 },
		{ req_id: "e", loop: "simulate", state: "queued", position: null, remaining: 1, last_error: "boom" },
	]);
	eq(q.waiting.map((w) => [w.key, w.line]), [["c", "next in line · 3 runs to go"], ["a", "#2 in line"], ["e", "waiting · retrying after an error"]]);
	eq(q.running.map((r) => [r.key, r.version, r.line]), [["b", "c32", "1 done, 2 runs to go"]]);
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

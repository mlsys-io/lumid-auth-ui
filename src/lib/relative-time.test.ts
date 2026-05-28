// Runs under vitest (`describe`/`it`/`expect`) once test infra is wired,
// and also standalone via `node --import tsx --test src/lib/relative-time.test.ts`
// using the node:test shim below — the repo has no runner configured yet.
import { formatRelative } from "./relative-time";

type Case = { name: string; input: string | number | null | undefined; expect: string };

const FIXED_NOW = new Date("2026-05-28T12:00:00Z").getTime();
const cases: Case[] = [
	{ name: "null → em dash", input: null, expect: "—" },
	{ name: "undefined → em dash", input: undefined, expect: "—" },
	{ name: "empty string → em dash", input: "", expect: "—" },
	{ name: "epoch zero → em dash (the 20580-days bug)", input: 0, expect: "—" },
	{ name: "1970 ISO → em dash", input: "1970-01-01T00:00:01Z", expect: "—" },
	{ name: "garbage → em dash", input: "not-a-date", expect: "—" },
	{ name: "pre-2024 → em dash", input: "2023-12-31T23:59:59Z", expect: "—" },
	{ name: "2 days ago → '2 days ago'", input: "2026-05-26T12:00:00Z", expect: "2 days ago" },
	{ name: "1 day ago → '1 day ago'", input: "2026-05-27T12:00:00Z", expect: "1 day ago" },
	{ name: "30 min ago → '30 min ago'", input: "2026-05-28T11:30:00Z", expect: "30 min ago" },
	{ name: "future → 'scheduled'", input: "2026-06-01T00:00:00Z", expect: "scheduled" },
];

function run() {
	const realNow = Date.now;
	(Date as unknown as { now: () => number }).now = () => FIXED_NOW;
	let failed = 0;
	for (const c of cases) {
		const got = formatRelative(c.input);
		if (got !== c.expect) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`FAIL ${c.name}: got ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`);
		}
	}
	(Date as unknown as { now: () => number }).now = realNow;
	return failed;
}

// vitest harness (no-op if vitest globals are absent)
declare const describe: undefined | ((n: string, f: () => void) => void);
declare const it: undefined | ((n: string, f: () => void) => void);
declare const expect: undefined | ((v: unknown) => { toBe: (e: unknown) => void });

if (typeof describe === "function" && typeof it === "function" && typeof expect === "function") {
	describe("formatRelative", () => {
		const realNow = Date.now;
		for (const c of cases) {
			it(c.name, () => {
				(Date as unknown as { now: () => number }).now = () => FIXED_NOW;
				try {
					expect!(formatRelative(c.input)).toBe(c.expect);
				} finally {
					(Date as unknown as { now: () => number }).now = realNow;
				}
			});
		}
	});
} else {
	const failed = run();
	const proc = (globalThis as { process?: { exitCode?: number } }).process;
	if (failed > 0) {
		// eslint-disable-next-line no-console
		console.error(`${failed} case(s) failed`);
		if (proc) proc.exitCode = 1;
	} else {
		// eslint-disable-next-line no-console
		console.log(`relative-time: all ${cases.length} cases passed`);
	}
}

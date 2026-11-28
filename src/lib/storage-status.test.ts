// Words for the Storage tab. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { checkedLine, folderLine, formatBytes, percentUsed, serviceLine, sortByFullness, usageLine, usageTone } from "./storage-status";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}
const G = 1024 ** 3, T = 1024 ** 4;

check("bytes in binary units, like df", () => {
	eq(formatBytes(0), "0 B"); eq(formatBytes(1536), "1.5 KB"); eq(formatBytes(500 * G), "500 GB"); eq(formatBytes(43.2 * T), "43.2 TB");
});
check("tone: 90% nearly full, at/over the limit failing", () => {
	eq(usageTone(10, 100), "ok"); eq(usageTone(90, 100), "attention"); eq(usageTone(100, 100), "failing"); eq(usageTone(5, 0), "ok");
});
check("over the limit says writes fail, in words", () => {
	const l = usageLine({ user: "a", kind: "home", machine: "luyao4", used_bytes: 955 * G, limit_bytes: 500 * G });
	eq(l, "955 GB of 500 GB on luyao4 — over the limit: writes fail until you delete files");
});
check("sandbox home is 'your sandboxes', not a site code", () => {
	eq(usageLine({ user: "a", kind: "sandbox-home", machine: "office", used_bytes: 4 * G, limit_bytes: 20 * G }), "4.0 GB of 20.0 GB on your sandboxes");
});
check("folder free space, or why it is unknown", () => {
	eq(folderLine({ kind: "d", label: "D", path: "/mnt/datasets", backing: "x", ok: true, total_bytes: 50 * T, free_bytes: 48 * T }), "48.0 TB free of 50.0 TB");
	eq(folderLine({ kind: "d", label: "D", path: "/p", backing: "x", ok: false, error: "did not answer in 15 s" }), "Not answering");
	eq(folderLine({ kind: "d", label: "D", path: "/p", backing: "x", ok: false, error: "not mounted" }), "Not reachable");
});
check("check age: minutes, and stale past 30 min", () => {
	const now = Date.parse("2026-11-28T10:00:00Z");
	eq(checkedLine("2026-11-28T09:56:00Z", now), { text: "Checked 4 min ago", stale: false });
	eq(checkedLine("2026-11-28T09:00:00Z", now).stale, true);
	eq(checkedLine(null, now), { text: "Not checked yet", stale: true });
});
check("service words", () => {
	eq(serviceLine({ name: "m", url: "u", ok: true, code: 200, ms: 12 }), "Working · 12 ms");
	eq(serviceLine({ name: "m", url: "u", ok: false, error: "unreachable" }), "Not reachable");
	eq(serviceLine({ name: "m", url: "u", ok: false, code: 500 }), "Not working (HTTP 500)");
});
check("percent and fullest-first", () => {
	eq(percentUsed(955, 500), 191);
	const rows = [{ user: "b", kind: "home", machine: "m", used_bytes: 1, limit_bytes: 10 }, { user: "a", kind: "home", machine: "m", used_bytes: 12, limit_bytes: 10 }];
	eq(sortByFullness(rows).map((r) => r.user), ["a", "b"]);
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

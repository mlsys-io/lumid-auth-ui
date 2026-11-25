// Words for table activity. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import {
	activityRows, agoWords, appUseLabel, appUseLine, emptyActivityLine, othersLine, parseTableLink, rowsWords, tableHref, tableUseLine,
} from "./data-activity";
import type { InstanceActivity, LakeInstance } from "@/api/dataLake";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

const NOW = Date.parse("2026-11-25T08:00:00Z");

check("rows read as words", () => {
	eq(rowsWords(1), "1 row");
	eq(rowsWords(1234), "1,234 rows");
	eq(rowsWords(-3), "0 rows");
});
check("ago", () => {
	eq(agoWords("2026-11-25T07:58:00Z", NOW), "2m ago");
	eq(agoWords("2026-11-25T05:00:00Z", NOW), "3h ago");
	eq(agoWords("not a time", NOW), "");
});
check("deep link round-trips", () => {
	const href = tableHref("findata", "instrument", "cross_venue_link_proposals");
	eq(href, "/studio/data-warehouse?inst=findata&table=instrument.cross_venue_link_proposals");
	eq(parseTableLink(new URLSearchParams(href.split("?")[1])), { inst: "findata", schema: "instrument", table: "cross_venue_link_proposals" });
	eq(parseTableLink(new URLSearchParams("inst=findata&table=nodot")), null);
});
check("a run's table line", () => {
	eq(tableUseLine({ schema: "s", table: "t", rows: 1234, requests: 3, last_at: "2026-11-25T06:00:00Z" }, "wrote", NOW), "Wrote 1,234 rows · 2h ago");
	eq(tableUseLine({ schema: "s", table: "t", rows: 1, requests: 1, last_at: "" }, "read", NOW), "Read 1 row");
});
check("who used a table", () => {
	eq(appUseLabel({ app: "venue-link-matcher", loop: "match" }), "venue-link-matcher · match");
	eq(appUseLabel({ app: "", loop: "" }), "Queries outside a workflow");
	eq(appUseLine({ app: "a", loop: "", rows: 10, requests: 1, last_at: "2026-11-25T07:00:00Z" }, "wrote", NOW), "Last wrote 10 rows 1h ago");
});
check("others are counted, never named", () => {
	eq(othersLine({ writers: 0, readers: 0 }), "");
	eq(othersLine(undefined), "");
	eq(othersLine({ writers: 1, readers: 3 }), "1 other person writes it · 3 other people read it");
});
check("empty is honest about when recording began", () => {
	eq(emptyActivityLine("table"), "No workflow has read or written this table since 25 Nov, when this started being recorded.");
});
check("rows list writes first, across instances", () => {
	const inst = (id: string) => ({ id, label: id, basePath: "/" + id, where: "" }) as LakeInstance;
	const u = { schema: "s", table: "t", rows: 1, requests: 1, last_at: "" };
	const acts: InstanceActivity[] = [
		{ instance: inst("lumid-data"), wrote: [], read: [u] },
		{ instance: inst("findata"), wrote: [u], read: [] },
	];
	eq(activityRows(acts).map((r) => `${r.verb}:${r.instanceId}`), ["wrote:findata", "read:lumid-data"]);
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

// Words for the Data Warehouse header (components/app-surface/DataLakeViewer):
// how many sources answered, how up to date each one's feeds are, and what an
// offline source means for the reader. Pure and tested (warehouse-status.test.ts).
//
// Before (audit, 2026-11-28): "3/4 instances", "FinData 201 fresh · 1 stale ·
// 60 overdue · 35 unknown" and a red "LQT Data offline" — counters with no
// noun, states with no definition, and an outage with no consequence.

import { plainCause } from "./activity";

/** Per-instance counts from an instance's GET /freshness. They come from
 *  `provenance.endpoint_freshness` (findata ddl/20_endpoint_freshness.sql): one
 *  row per active FEED (an upstream endpoint writing one table), graded by how
 *  long ago it last brought data against its own cadence. */
export interface FreshnessCounts {
	green: number;
	amber: number;
	red: number;
	gray: number;
}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** "201 of 297 feeds on schedule · 60 overdue · 1 slightly behind · 35 never refreshed".
 *  The worst state leads after the headline; a state with none is left out.
 *  null when the source reported no feeds at all. */
export function freshnessLine(f: Partial<FreshnessCounts> | null | undefined): string | null {
	if (!f) return null;
	const green = n(f.green), amber = n(f.amber), red = n(f.red), gray = n(f.gray);
	const total = green + amber + red + gray;
	if (total === 0) return null;
	const parts = [`${green.toLocaleString()} of ${total.toLocaleString()} feed${total === 1 ? "" : "s"} on schedule`];
	if (red) parts.push(`${red.toLocaleString()} overdue`);
	if (amber) parts.push(`${amber.toLocaleString()} slightly behind`);
	if (gray) parts.push(`${gray.toLocaleString()} never refreshed`);
	return parts.join(" · ");
}

/** What each state means, for the line's tooltip — the thresholds the view
 *  actually applies (by the feed's cadence, in days since its newest data or
 *  last successful refresh, whichever is later). */
export const FRESHNESS_WHY = [
	"Each feed is one upstream source that keeps a table up to date, graded against its own schedule:",
	"On schedule — refreshed within its cadence (daily: 1 day, weekly: 7, quarterly: 95).",
	"Slightly behind — a little late (daily: 2–3 days, weekly: 8–14, quarterly: 96–120).",
	"Overdue — later than that (daily: over 3 days, weekly: over 14, quarterly: over 120).",
	"Never refreshed — no successful refresh or data date recorded yet.",
	"A feed on any other cadence counts as on schedule once it has data.",
].join("\n");

/** The headline under the title: "3 of 4 sources reachable · 25 schemas · 300 tables · read-only". */
export function sourcesLine(reachable: number, total: number, schemas: number, tables: number, loading = 0): string {
	let head = reachable === total
		? `All ${total} source${total === 1 ? "" : "s"} reachable`
		: `${reachable} of ${total} sources reachable`;
	if (loading > 0) head += ` (${loading} still loading)`;
	return `${head} · ${schemas.toLocaleString()} schema${schemas === 1 ? "" : "s"} · ${tables.toLocaleString()} table${tables === 1 ? "" : "s"} · read-only`;
}

/** A source that didn't answer, in words, with what still works. No outage
 *  start is recorded anywhere the page can read, so none is claimed. */
export function offlineLine(label: string, othersUp: number): string {
	const rest = othersUp > 0
		? ` Its tables can't be browsed for now; the other ${othersUp === 1 ? "source still works" : `${othersUp} sources still work`}.`
		: " Its tables can't be browsed for now.";
	return `${label} isn't answering right now.${rest}`;
}

/** Tooltip for an offline source: the error in plain words, and that the page retries. */
export function offlineWhy(error: string | null | undefined): string {
	return `${plainCause(error)}. The page asks again each time you open it.`;
}

/** The short form in the catalog tree, beside the source's name. */
export const OFFLINE_SHORT = "not answering";

/** Starter questions for the empty Data Warehouse chat. Plain questions the
 *  platform data tools (data_catalog / data_query) can answer; pressing one
 *  pre-fills the composer, the reader sends it. */
export const DATA_STARTERS: readonly string[] = [
	"What data do I have on US stocks, and how far back does it go?",
	"Which tables could I use to backtest an earnings strategy?",
	"What's in the prediction-market data, and how fresh is it?",
];

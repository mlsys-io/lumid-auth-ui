// Column order for a catalog sample. Pure and tested (table-columns.test.ts).
//
// Sample rows arrive as alphabetically keyed JSON, and the preview used to show
// only the first 20 keys — so arxiv.papers never showed `title`, and a CFTC table
// showed neither the market nor the date (scripted check, 2026-11-25). Now every
// column is shown (the table scrolls sideways), led by the ones a reader looks
// for first: identifiers, names/titles, symbols, dates.

const LEAD: RegExp[] = [
	/^(id|uid|eid|key)$/i,
	/^(symbol|ticker|paper_id|participant_id)$/i,
	/(^|_)(name|title)$/i,
	/^(date|day|ts|time|timestamp)$/i,
	/(_date|_at|_ts|_time)$/i,
	/_id$/i,
];

function rank(col: string): number {
	const i = LEAD.findIndex((re) => re.test(col));
	return i === -1 ? LEAD.length : i;
}

/** Every column seen in `rows` (first 100 rows), lead columns first, then A–Z. */
export function sampleColumns(rows: Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	for (const r of rows.slice(0, 100)) {
		if (r && typeof r === "object") for (const k of Object.keys(r)) seen.add(k);
	}
	return [...seen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Shared relative-time formatting. Extracted so the null/epoch guard is
// unit-testable in isolation (importing the React pages would drag JSX).
//
// The bug this guards against: a null/0/garbage `last_run_ts` parses to
// near the unix epoch, and a naive `Date.now() - t` then renders as
// "20580 days ago". Anything before 2024-01-01 (or unparseable) is
// treated as "no real timestamp" and rendered as an em dash.

export const MIN_VALID_TS = new Date("2024-01-01T00:00:00Z").getTime();

/** Long-form relative time, e.g. "3 days ago". Returns "—" for missing/invalid. */
export function formatRelative(value: string | number | null | undefined): string {
	if (value === null || value === undefined || value === "") return "—";
	const t = new Date(value).getTime();
	if (Number.isNaN(t) || t < MIN_VALID_TS) return "—";
	const diff = Date.now() - t;
	if (diff < 0) return "scheduled";
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min} min ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
	const d = Math.floor(hr / 24);
	return `${d} day${d === 1 ? "" : "s"} ago`;
}

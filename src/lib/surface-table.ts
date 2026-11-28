// Words for the generic `table` / `stat` directives an app's own pages are
// built from (components/app-surface/directives.tsx). Pure and tested
// (surface-table.test.ts).
//
// Every research app's page is authored YAML over a JSON source, so whatever
// the source holds reaches the screen as-is unless the renderer says it in
// words: Quant Research's strategy list showed `qr_fwd_e3qi` and
// `silent_arm_demo` as names, "11/27/2026, 6:48:29 AM" beside Studio's
// "Nov 28, 01:42 PM", and a bare "30 hidden" (audit, 2026-11-28).

import { humanId } from "./research-map";
import { runRowWhen } from "./runs-list";

/** A column that names the row (shown humanised), as opposed to a value. */
export function isNameColumn(c: { key: string; type?: string }): boolean {
	return !c.type && /^(name|title|display_name|label)$|_name$/i.test(c.key.trim());
}

/** An identifier rather than words: no spaces, joined by `_` / `-`
 *  (`qr_fwd_e3qi`, `mean_reversion_demo`). Not a UUID, a hash or a number. */
export function looksLikeId(s: string): boolean {
	const v = s.trim();
	if (!v || /\s/.test(v)) return false;
	if (/^[0-9a-f]{8}-[0-9a-f-]{8,}$/i.test(v) || /^[0-9a-f]{16,}$/i.test(v) || /^[\d._-]+$/.test(v)) return false;
	return /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(v);
}

const EXAMPLE_RE = /(^|[_-])(demo|example|sample)$|^(demo|example|sample)[_-]/i;

/** A seeded example (`*_demo`) rather than something the reader made. */
export function isExampleName(s: string): boolean {
	return EXAMPLE_RE.test(s.trim());
}

export interface NameDisplay {
	/** What the row is called, in words. */
	label: string;
	/** The raw id, when the label was made from it (shown small, muted). */
	raw?: string;
	/** A seeded example — shown with an "example" badge, listed last. */
	example: boolean;
}

/** The row's name in words: its own title when it has one
 *  (`title` / `display_name`), else the id humanised with the id kept beside
 *  it; a name that is already words is left alone. */
export function nameDisplay(row: Record<string, unknown>, value: unknown): NameDisplay {
	const v = value == null ? "" : String(value).trim();
	const example = !!v && isExampleName(v);
	for (const k of ["title", "display_name"]) {
		const t = row[k];
		if (typeof t === "string" && t.trim() && t.trim() !== v) {
			return { label: t.trim(), raw: v || undefined, example };
		}
	}
	if (!v) return { label: "—", example: false };
	if (!looksLikeId(v)) return { label: v, example };
	// The badge already says "example"; "Silent arm demo — example" says it twice.
	const core = example ? v.replace(EXAMPLE_RE, "") || v : v;
	return { label: humanId(core), raw: v, example };
}

/** Rows with the reader's own first and seeded examples after, each group in
 *  its original order. */
export function examplesLast<T extends Record<string, unknown>>(rows: T[], nameOf: (r: T) => unknown): T[] {
	const own: T[] = [];
	const ex: T[] = [];
	for (const r of rows) {
		const n = nameOf(r);
		(n != null && isExampleName(String(n)) ? ex : own).push(r);
	}
	return ex.length ? [...own, ...ex] : rows;
}

/** A timestamp the way Studio writes one: "Nov 27, 06:48 AM" this year,
 *  "Aug 26, 2025" before it. `ms` is epoch milliseconds. "" when unusable. */
export function studioWhen(ms: number, now = Date.now()): string {
	if (!isFinite(ms) || ms <= 0) return "";
	const d = new Date(ms);
	if (d.getFullYear() !== new Date(now).getFullYear()) {
		return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
	}
	return runRowWhen(ms / 1000);
}

/** The noun a table's rows are, from its source path (`strategies` →
 *  strategy / strategies). A path that isn't one plain word gives "row". */
export function rowNoun(path: unknown): { one: string; many: string } {
	const p = typeof path === "string" ? path.trim().split(".").pop() ?? "" : "";
	if (!/^[a-z]{3,}$/i.test(p) || !/s$/i.test(p)) return { one: "row", many: "rows" };
	const many = p.toLowerCase();
	const one = /ies$/.test(many) ? many.slice(0, -3) + "y" : /(ches|shes|sses|xes)$/.test(many) ? many.slice(0, -2) : many.slice(0, -1);
	return { one, many };
}

/** "36 strategies" — the whole list, hidden rows included. */
export function tableCountLine(total: number, noun: { one: string; many: string }): string {
	return `${total.toLocaleString()} ${total === 1 ? noun.one : noun.many}`;
}

/** The hidden-rows toggle says what pressing it does. */
export function hiddenToggleLabel(hidden: number, showing: boolean): string {
	return showing ? `Hide those ${hidden.toLocaleString()} again` : `Show ${hidden.toLocaleString()} hidden`;
}

/** Why rows are hidden, for the toggle's tooltip. */
export const HIDDEN_ROWS_WHY =
	"Test rows and backtest records are hidden by default. They are real and still counted — press to show them.";

/** A stat's figure: whole numbers from 1,000 up get separators (1446 → 1,446). */
export function statFigure(value: unknown): string {
	if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 1000) return value.toLocaleString();
	return String(value);
}

/** Epoch ms from the two wire shapes a timestamp arrives in: numeric epochs
 *  (< 1e12 ⇒ seconds) and RFC3339 strings (every Go service — an RFC3339 value
 *  once rendered as "—" because only numbers were handled). Go's zero time
 *  (year 1) and 0 are "never": null. */
export function whenMs(value: unknown): number | null {
	if (value == null || value === "") return null;
	if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value.trim())) {
		const ms = Date.parse(value);
		if (!isFinite(ms) || new Date(ms).getUTCFullYear() <= 1) return null;
		return ms;
	}
	const n = Number(value);
	if (!isFinite(n) || n <= 0) return null;
	return n < 1e12 ? n * 1000 : n;
}

/** The full date and time, for a hover: "27 Nov 2026, 06:48". */
export function whenFull(value: unknown): string | undefined {
	const ms = whenMs(value);
	return ms == null ? undefined : new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

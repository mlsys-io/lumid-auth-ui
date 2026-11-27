// runs-list — Activity's run list (the Timeline's List view) in words: a run's
// plain name (the workflow's title, never `quant-research:stock_backtests`),
// its start on one line, the state and workflow filters, and whether the
// ticked rows can be compared. Pure — tested in runs-list.test.ts.

import type { MeRunRow, MeWorkflowRow } from "@/api/me";
import { loopOfRun, plainCause } from "@/lib/activity";
import { humanId } from "@/lib/research-map";
import { compareHref, parseScheduledRunId } from "@/lib/run-routes";

/** The workflow's title when the app gives one, else its id in words. */
export function runRowName(r: MeRunRow, title?: string | null): string {
	if (title && title.trim()) return title.trim();
	if (r.kind === "job") return r.name && !/^[a-z0-9_:.-]+$/.test(r.name) ? r.name : "Data job";
	const loop = loopOfRun(r);
	return loop ? humanId(loop) : "Run";
}

/** The Detail column in words: a failure's cause (plainCause), a bare code
 *  ("universe_refresh_queued") as words, anything else as the app wrote it. */
export function runRowDetail(r: MeRunRow): string {
	const t = (r.reason || "").trim();
	if (!t) return "";
	if (r.state === "failed") return plainCause(t);
	if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(t)) return humanId(t);
	return t;
}

/** Each app's name for the App column. Two apps the shell titles alike (an
 *  app and its test copy) are told apart by their ids in words. */
export function appLabels(apps: string[], title: (app: string) => string): Map<string, string> {
	const uniq = [...new Set(apps.filter(Boolean))];
	const byTitle = new Map<string, string[]>();
	for (const a of uniq) byTitle.set(title(a), [...(byTitle.get(title(a)) ?? []), a]);
	const out = new Map<string, string>();
	for (const [t, group] of byTitle) {
		if (group.length < 2) { out.set(group[0], t); continue; }
		// The shortest id is the app; the others are named by what they add ("E2E").
		const main = [...group].sort((x, y) => x.length - y.length)[0];
		for (const a of group) {
			const extra = a !== main && a.startsWith(main) ? a.slice(main.length).replace(/^[-_]+/, "") : a === main ? "" : a;
			out.set(a, extra ? `${t} (${humanId(extra.replace(/-/g, "_"))})` : t);
		}
	}
	return out;
}

/** "app:loop" → title, from the workflow rows (`title` is served by identity). */
export function workflowTitles(rows: MeWorkflowRow[]): Map<string, string> {
	const m = new Map<string, string>();
	for (const w of rows) if (w.slug && w.title && w.title.trim()) m.set(w.slug, w.title.trim());
	return m;
}

/** "27 Nov, 14:13" — a start time on one line, in the reader's zone. */
export function runRowWhen(sec: number): string {
	if (!isFinite(sec) || sec <= 0) return "";
	return new Date(sec * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Every state a run row can be in, in the order a reader looks for them. */
export const RUN_STATE_FILTERS: ReadonlyArray<{ value: MeRunRow["state"] | ""; label: string }> = [
	{ value: "", label: "Every state" },
	{ value: "succeeded", label: "Succeeded" },
	{ value: "failed", label: "Failed" },
	{ value: "running", label: "Running" },
	{ value: "queued", label: "Queued" },
	{ value: "skipped", label: "Skipped" },
	{ value: "canceled", label: "Canceled" },
];

/** The workflow filter's choices, grouped by app (the app's own order is the
 *  caller's), each named in words. `app` narrows to one app. */
export function workflowFilterOptions(rows: MeWorkflowRow[], app?: string): Array<{ app: string; options: Array<{ value: string; label: string }> }> {
	const by = new Map<string, Array<{ value: string; label: string }>>();
	for (const w of rows) {
		const a = w.app || "";
		if (!w.slug || (app && a !== app)) continue;
		const loop = a && w.slug.startsWith(`${a}:`) ? w.slug.slice(a.length + 1) : w.slug;
		const list = by.get(a) ?? [];
		if (!list.some((o) => o.value === w.slug)) list.push({ value: w.slug, label: w.title?.trim() || humanId(loop) });
		by.set(a, list);
	}
	return [...by.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([a, options]) => ({ app: a, options: options.sort((x, y) => x.label.localeCompare(y.label)) }));
}

export const COMPARE_MAX = 5;

/** Can the ticked runs be compared? `href` when they can; otherwise the
 *  reason, said where the disabled button is. */
export function compareSelection(rows: MeRunRow[]): { ok: boolean; label: string; reason: string; href?: string } {
	const n = rows.length;
	const label = `Compare ${n}`;
	if (n < 2) return { ok: false, label, reason: "Tick two to five runs to compare them." };
	if (n > COMPARE_MAX) return { ok: false, label, reason: `Compare up to ${COMPARE_MAX} runs at a time (${n} ticked).` };
	const parsed = rows.map((r) => parseScheduledRunId(r.run_id));
	const other = parsed.filter((p) => !p).length;
	if (other) return { ok: false, label, reason: `Only workflow runs can be compared — ${other} of these ${other === 1 ? "is a" : "are"} data job${other === 1 ? "" : "s"} or other run${other === 1 ? "" : "s"}.` };
	const apps = [...new Set(parsed.map((p) => p!.app))];
	if (apps.length > 1) return { ok: false, label, reason: `Compare runs of one app at a time — these are from ${apps.length} apps.` };
	return { ok: true, label, reason: "", href: compareHref(apps[0], { runs: parsed.map((p) => ({ loop: p!.loop, ts: p!.runId })) }) };
}

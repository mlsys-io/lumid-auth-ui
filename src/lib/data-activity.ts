// Words for table activity — what a run wrote and read, what a workflow reads
// and writes, who keeps a table up to date. Pure and tested (data-activity.test.ts);
// components only place them.

import type { AppUse, InstanceActivity, TableUse } from "@/api/dataLake";

/** When recording started. Activity before this simply was not kept. */
export const ACTIVITY_SINCE = "25 Nov";

const nf = new Intl.NumberFormat("en-US");

export function rowsWords(n: number): string {
	return `${nf.format(Math.max(0, Math.round(n)))} row${n === 1 ? "" : "s"}`;
}

/** "3m ago" / "2h ago" / "4d ago" from an ISO time (or "" if it doesn't parse). */
export function agoWords(iso: string, nowMs = Date.now()): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return "";
	const d = Math.max(0, (nowMs - t) / 1000);
	if (d < 60) return "just now";
	if (d < 3600) return `${Math.floor(d / 60)}m ago`;
	if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
	return `${Math.floor(d / 86400)}d ago`;
}

/** Deep link to a table in the Data Warehouse catalog. */
export function tableHref(instanceId: string, schema: string, table: string): string {
	const q = new URLSearchParams({ inst: instanceId, table: `${schema}.${table}` });
	return `/studio/data-warehouse?${q}`;
}

/** Parse the catalog deep link back: `?inst=&table=schema.table`. */
export function parseTableLink(params: URLSearchParams): { inst: string; schema: string; table: string } | null {
	const inst = params.get("inst") || "";
	const full = params.get("table") || "";
	const dot = full.indexOf(".");
	if (!inst || dot <= 0 || dot === full.length - 1) return null;
	return { inst, schema: full.slice(0, dot), table: full.slice(dot + 1) };
}

/** One line for a table a run/workflow touched: "Wrote 1,234 rows · 2h ago". */
export function tableUseLine(u: TableUse, verb: "wrote" | "read", nowMs = Date.now()): string {
	const what = verb === "wrote" ? `Wrote ${rowsWords(u.rows)}` : `Read ${rowsWords(u.rows)}`;
	const when = agoWords(u.last_at, nowMs);
	return when ? `${what} · ${when}` : what;
}

/** Who a table's activity came from, in words: "venue-link-matcher · match". */
export function appUseLabel(a: Pick<AppUse, "app" | "loop">): string {
	if (!a.app) return "Queries outside a workflow";
	return a.loop ? `${a.app} · ${a.loop}` : a.app;
}

/** "Last wrote 1,234 rows 2h ago" for one writer/reader of a table. */
export function appUseLine(a: AppUse, verb: "wrote" | "read", nowMs = Date.now()): string {
	const when = agoWords(a.last_at, nowMs);
	const what = verb === "wrote" ? `wrote ${rowsWords(a.rows)}` : `read ${rowsWords(a.rows)}`;
	return when ? `Last ${what} ${when}` : `Last ${what}`;
}

/** The "and others" line for a table, when other people use it too. */
export function othersLine(o: { writers: number; readers: number } | undefined): string {
	if (!o || (o.writers === 0 && o.readers === 0)) return "";
	const parts: string[] = [];
	if (o.writers) parts.push(`${o.writers} other ${o.writers === 1 ? "person writes" : "people write"} it`);
	if (o.readers) parts.push(`${o.readers} other ${o.readers === 1 ? "person reads" : "people read"} it`);
	return parts.join(" · ");
}

/** Shown when nothing was recorded — honest about when recording began. */
export function emptyActivityLine(what: "run" | "workflow" | "table"): string {
	const subject = what === "table" ? "No workflow has read or written this table" : `This ${what} hasn't read or written warehouse tables`;
	return `${subject} since ${ACTIVITY_SINCE}, when this started being recorded.`;
}

/** Flatten per-instance activity into rows the UI lists, writes first. */
export function activityRows(acts: InstanceActivity[]): { verb: "wrote" | "read"; instanceId: string; instanceLabel: string; use: TableUse }[] {
	const out: { verb: "wrote" | "read"; instanceId: string; instanceLabel: string; use: TableUse }[] = [];
	for (const verb of ["wrote", "read"] as const) {
		for (const a of acts) {
			for (const use of a[verb]) out.push({ verb, instanceId: a.instance.id, instanceLabel: a.instance.label, use });
		}
	}
	return out;
}

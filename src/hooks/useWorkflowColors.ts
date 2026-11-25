// useWorkflowColors — one colour per workflow, the same everywhere it shows:
// the sidebar row's bar, the map's branch (the edge from the app to each
// experiment the workflow runs, and that experiment's ring and panel edge), and
// a running box's bar. "Different workflows can be color coded" (user,
// 2026-11-25).
//
// A workflow's colour is its place in its app's workflow list, sorted by id,
// so it never depends on which view asked. Four hues × two shades, in a fixed
// order; brick and ember are left out — they mean failing and overdue.

import { useCallback, useEffect, useState } from "react";
import { me, type MeWorkflowRow } from "@/api/me";

export interface WfSwatch { bar: string; ring: string; stroke: string; border: string }

// Full class strings (Tailwind only emits classes it can see).
export const WF_SWATCHES: WfSwatch[] = [
	{ bar: "bg-lagoon-500", ring: "!ring-lagoon-300", stroke: "stroke-lagoon-400", border: "border-l-lagoon-500" },
	{ bar: "bg-gold-500", ring: "!ring-gold-300", stroke: "stroke-gold-400", border: "border-l-gold-500" },
	{ bar: "bg-plum-500", ring: "!ring-plum-300", stroke: "stroke-plum-400", border: "border-l-plum-500" },
	{ bar: "bg-ink-500", ring: "!ring-ink-300", stroke: "stroke-ink-400", border: "border-l-ink-500" },
	// Second round darker, not lighter: light tints read as "no colour" on the sidebar.
	{ bar: "bg-lagoon-700", ring: "!ring-lagoon-400", stroke: "stroke-lagoon-600", border: "border-l-lagoon-700" },
	{ bar: "bg-gold-700", ring: "!ring-gold-400", stroke: "stroke-gold-600", border: "border-l-gold-700" },
	{ bar: "bg-plum-700", ring: "!ring-plum-400", stroke: "stroke-plum-600", border: "border-l-plum-700" },
	{ bar: "bg-ink-700", ring: "!ring-ink-400", stroke: "stroke-ink-600", border: "border-l-ink-700" },
];

/** The workflow's loop id from a row ("<app>:<loop>" slug). */
export function loopOfRow(w: MeWorkflowRow): string {
	const app = w.app || "";
	if (app && w.slug.startsWith(app + ":")) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(":");
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

/** Pure: each app's loops sorted → index → swatch. */
export function swatchIndex(rows: Array<{ app: string; loop: string }>): Map<string, number> {
	const byApp = new Map<string, string[]>();
	for (const r of rows) byApp.set(r.app, [...(byApp.get(r.app) ?? []), r.loop]);
	const out = new Map<string, number>();
	for (const [app, loops] of byApp) [...new Set(loops)].sort().forEach((l, i) => out.set(`${app}:${l}`, i % WF_SWATCHES.length));
	return out;
}

// One fetch for every view; refreshed at most every 30 s.
let cache: { at: number; p: Promise<Map<string, number>> } | null = null;
function load(): Promise<Map<string, number>> {
	if (!cache || Date.now() - cache.at > 30_000) {
		const p = me.listWorkflows("scheduled").then((r) => swatchIndex((r.workflows || []).map((w) => ({ app: w.app || "", loop: loopOfRow(w) }))));
		cache = { at: Date.now(), p };
		p.catch(() => { cache = null; });
	}
	return cache.p;
}

/** colorOf(app, loop) → its swatch, or null while unknown (then draw neutral). */
export function useWorkflowColors(): (app: string, loop: string) => WfSwatch | null {
	const [idx, setIdx] = useState<Map<string, number> | null>(null);
	useEffect(() => {
		let live = true;
		load().then((m) => { if (live) setIdx(m); }).catch(() => {});
		return () => { live = false; };
	}, []);
	return useCallback((app: string, loop: string) => {
		const i = idx?.get(`${app}:${loop}`);
		return i === undefined ? null : WF_SWATCHES[i];
	}, [idx]);
}

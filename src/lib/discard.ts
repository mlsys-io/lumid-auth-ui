// discard — hide a run's results from an experiment without deleting them
// (round 10, 2026-11-28; generic). The platform keeps the ledger append-only
// and writes tombstones (LumidOS sdk/apps/discard.py, identity
// POST /me/apps/:app/experiments/:id/discard). Hidden rows still arrive,
// marked dims.discarded, so they can be listed and restored. Pure functions.

import type { MeCycleDetail, MeExperimentRow } from "@/api/me";

export interface DiscardMatch { variant_id?: string; cycle_ts?: string; stage?: string; row?: string }
export interface DiscardTarget { experiment: string; version: string; matches: DiscardMatch[] }

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** What discarding THIS run would hide: the experiment version it measured,
 *  and the run's own results (a chain's are its stages' runs). null when the
 *  run was not measuring an experiment version. */
export function runDiscardTarget(d: MeCycleDetail | null): DiscardTarget | null {
	const s = obj(d?.summary) ?? {};
	const variant = obj(obj(s.lineage)?.variant);
	const exps = Array.isArray(s.experiments) ? (s.experiments as unknown[]).map(obj).filter(Boolean) as Array<Record<string, unknown>> : [];
	const experiment = String(variant?.study ?? exps[0]?.id ?? "");
	const version = String(variant?.arm ?? (typeof s.experiment === "string" ? s.experiment : "") ?? "");
	if (!experiment || !version || !d?.ts) return null;
	const stageTs = (Array.isArray(s.stages) ? s.stages : []).map((st) => String(obj(st)?.ts ?? "")).filter(Boolean);
	const ts = stageTs.length ? stageTs : [d.ts];
	return { experiment, version, matches: ts.map((t) => ({ variant_id: version, cycle_ts: t })) };
}

export const isDiscarded = (r: Pick<MeExperimentRow, "dims">): boolean => r.dims?.discarded === "1";

/** Rows the numbers count (discarded ones skipped). */
export const countedRows = <T extends Pick<MeExperimentRow, "dims">>(rows: T[]): T[] => rows.filter((r) => !isDiscarded(r));

/** Discarded rows grouped by version + run, newest first, for the Restore list. */
export function discardedGroups(rows: MeExperimentRow[]): Array<{ version: string; cycle_ts: string; stage: string; reason: string; at: string; n: number }> {
	const by = new Map<string, { version: string; cycle_ts: string; stage: string; reason: string; at: string; n: number }>();
	for (const r of rows) {
		if (!isDiscarded(r)) continue;
		const key = `${r.variant_id}|${r.cycle_ts ?? r.ts}`;
		const g = by.get(key) ?? { version: r.variant_id, cycle_ts: String(r.cycle_ts ?? ""), stage: String(r.dims?.stage ?? ""), reason: String(r.dims?.discarded_reason ?? ""), at: String(r.dims?.discarded_at ?? ""), n: 0 };
		g.n++;
		by.set(key, g);
	}
	return [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** "Hidden from Serve 9.2's numbers — you can restore it." */
export function discardDoneWords(experimentLabel: string, restore: boolean): string {
	return restore ? `Restored — these results count in ${experimentLabel} again` : `Discarded — hidden from ${experimentLabel}'s numbers, never deleted; you can restore it`;
}

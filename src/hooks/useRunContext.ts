// useRunContext — what the run page needs to know about the app around a run:
// its experiments (so a run is judged on ITS experiment's metric — an energy
// experiment on energy, not the app's default goodput) and the pass rule each
// workflow's feedback declares (so the Limits block can say which numbers the
// gate used). Two GETs per app, shared by every run card on the page, kept for
// a minute. A source that fails is simply absent: the card falls back to what
// the run itself says.

import { useEffect, useState } from "react";
import { me } from "@/api/me";
import { readAppSpec } from "@/lib/app-spec";
import { humanId, versionLabel } from "@/lib/research-map";
import type { RunExperimentRef } from "@/lib/run-answer";

export interface RunContext {
	experiments: RunExperimentRef[];
	/** workflow id → the first gate its feedback steps declare. */
	gates: Record<string, string>;
	/** version (arm) id → its label, across the app's experiments ("0.6B · concurrency 12"). */
	versions: Record<string, string>;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<RunContext> }>();

function load(app: string): Promise<RunContext> {
	const hit = cache.get(app);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
	const p = Promise.allSettled([me.experiments(app), me.appConfig(app)]).then(([ex, cfg]) => {
		const all = ex.status === "fulfilled" ? (ex.value.experiments || []) : [];
		const experiments = all.map((e) => ({ id: e.id, title: e.title, metric: e.metric, higher_is_better: e.higher_is_better }));
		// The run page named a run's version by its raw id ("version
		// r4_e_06b_c12_b", sweep 2): the label every other surface uses instead.
		const versions: Record<string, string> = {};
		for (const e of all) for (const a of e.arms || []) if (a?.id && !(a.id in versions)) versions[a.id] = versionLabel(e, a.id);
		const gates: Record<string, string> = {};
		if (cfg.status === "fulfilled") {
			for (const w of readAppSpec(cfg.value.yaml || "").workflows) {
				const g = w.feedback.find((f) => f.gate)?.gate;
				if (g) gates[w.id] = g;
			}
		}
		return { experiments, gates, versions };
	});
	cache.set(app, { at: Date.now(), p });
	return p;
}

export function useRunContext(app: string, skip = false): RunContext | null {
	const [ctx, setCtx] = useState<RunContext | null>(null);
	useEffect(() => {
		if (skip || !app) return;
		let live = true;
		load(app).then((c) => { if (live) setCtx(c); }).catch(() => {});
		return () => { live = false; };
	}, [app, skip]);
	return ctx;
}

/** A version id in words: its label from the app's experiments, else the humanised id. */
export function versionWords(ctx: RunContext | null, id: string): string {
	return ctx?.versions[id] || humanId(id);
}

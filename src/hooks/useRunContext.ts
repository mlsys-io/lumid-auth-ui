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
import type { RunExperimentRef } from "@/lib/run-answer";

export interface RunContext {
	experiments: RunExperimentRef[];
	/** workflow id → the first gate its feedback steps declare. */
	gates: Record<string, string>;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<RunContext> }>();

function load(app: string): Promise<RunContext> {
	const hit = cache.get(app);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
	const p = Promise.allSettled([me.experiments(app), me.appConfig(app)]).then(([ex, cfg]) => {
		const experiments = ex.status === "fulfilled" ? (ex.value.experiments || []).map((e) => ({ id: e.id, title: e.title, metric: e.metric, higher_is_better: e.higher_is_better })) : [];
		const gates: Record<string, string> = {};
		if (cfg.status === "fulfilled") {
			for (const w of readAppSpec(cfg.value.yaml || "").workflows) {
				const g = w.feedback.find((f) => f.gate)?.gate;
				if (g) gates[w.id] = g;
			}
		}
		return { experiments, gates };
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

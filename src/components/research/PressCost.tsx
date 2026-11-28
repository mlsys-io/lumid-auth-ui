// PressCost — what a press that runs a workflow will spend, said BEFORE it
// spends (2026-11-28, review #5). Shared by the workflow header's Run now and
// the Re-run sheet ("Run with changes"); the experiment panel's RunVersions
// prices its own press the same way (lib/spend pressWords).
//
//   Run Screen once: about 3.9 GPU-min on RTX 5080 · 3 CPU-s · 108 GPU-min left
//     · 14 GPU measurements in the last 24 h (a daily cap applies)
//
// The estimate is the workflow's own history on /me/usage, else the estimates
// of the instruments its feedback steps measure with. The day's GPU count is
// identity's `limits` (cap and today's count) when /me/usage sends them, else
// the count since 24 h ago across apps (the cap is per account), said as a count.

import { useEffect, useMemo, useState } from "react";
import { me } from "@/api/me";
import { useAppGraph } from "@/hooks/useAppGraph";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { gpuToday as gpuTodayOf, pressWords, specServices, workflowRunEstimate, type MeUsage } from "@/lib/spend";
import { useAppUsage } from "./SpendLine";

/** Where this account's GPU measurements stand today ({used, limit?}); null until read (or when not wanted). */
export function useGpuToday(wanted: boolean): { used: number; limit?: number } | null {
	const [n, setN] = useState<{ used: number; limit?: number } | null>(null);
	const [tick, setTick] = useState(0);
	useStudioRefetch(["runs", "experiments"], () => setTick((t) => t + 1));
	useEffect(() => {
		if (!wanted) return;
		let live = true;
		// Rounded to the minute so the read is shared (inflight-deduped) across presses.
		const since = new Date(Math.floor((Date.now() - 86_400_000) / 60_000) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
		me.usage(undefined, { since }).then((u: MeUsage) => { if (live) setN(gpuTodayOf(u)); }).catch(() => {});
		return () => { live = false; };
	}, [wanted, tick]);
	return wanted ? n : null;
}

/** The press words for running `workflow` `runs` times, or null when nothing is metered. */
export function useWorkflowPress(app: string, workflow: string, runs: number, what: string): { text: string; spends: boolean; blocked: boolean } | null {
	const usage = useAppUsage(app);
	const spec = useAppGraph(app).graph?.spec ?? null;
	const services = useMemo(() => specServices(spec, workflow), [spec, workflow]);
	const instruments = useMemo(() => specServices(spec), [spec]);
	const est = useMemo(() => workflowRunEstimate(usage, workflow, services), [usage, workflow, services]);
	const gpuToday = useGpuToday(!!est && est.gpu_s > 0);
	return useMemo(() => {
		if (!est) return null;
		const p = pressWords({ runs, estimate: est, usage, what, instruments, gpuToday });
		return p.text === what ? null : p;
	}, [est, runs, usage, what, instruments, gpuToday]);
}

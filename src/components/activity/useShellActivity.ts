// The sidebar's view of Activity: how many workflows are failing, and which
// apps have a run going right now. One poll for the whole shell (the Activity
// nav row and every app row read it), every 2 min while the tab is visible.
//
// "Failing" counts WORKFLOWS whose latest finished run failed — not failed
// runs. The old pill said "34 failed" when one workflow had failed 30 times.

import { useEffect, useState } from "react";
import { me } from "@/api/me";
import { groupActivity } from "@/lib/activity";

export interface ShellActivity {
	failing: number;
	runningApps: string[];
}

const KEY = "studio_shell_activity_v1";
// One poll for the whole shell, every 2 min, over 3 days — enough to see each
// workflow's latest run. (/me/runs was ~6 s per call until identity v0.5.477.)
const POLL_MS = 120_000;

let state: ShellActivity | null = (() => {
	try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
})();
const subs = new Set<(s: ShellActivity | null) => void>();
let timer: number | undefined;

async function refresh() {
	try {
		const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
		const r = await me.listRuns({ since, limit: 500 });
		const act = groupActivity(r.runs || []);
		state = {
			failing: act.failing.length,
			runningApps: [...new Set(act.running.map((x) => x.wf.app).filter(Boolean))],
		};
		try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
		subs.forEach((f) => f(state));
	} catch { /* keep the last answer; the nav still works */ }
}

function start() {
	if (timer !== undefined) return;
	void refresh();
	timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, POLL_MS);
}

function stop() {
	if (subs.size || timer === undefined) return;
	window.clearInterval(timer);
	timer = undefined;
}

export function useShellActivity(): ShellActivity | null {
	const [s, setS] = useState(state);
	useEffect(() => {
		subs.add(setS);
		start();
		return () => { subs.delete(setS); stop(); };
	}, []);
	return s;
}

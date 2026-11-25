// useAppGraph — what the research graph is made of, for one app:
//   the spec (structure: workflows, variants, nodes, feedback — lib/app-spec)
//   and the workflow rows (status: latest run, running, run strip).
//
// Edits are spec edits (text → text in lib/app-spec), saved with the sha they
// were made against: a 409 means someone else changed the spec — reload and
// reapply. Saves wait until the scheduler has applied the write
// (me.updateAppConfig → ownerWriteApplied), so the graph re-reads real state.

import { useCallback, useEffect, useRef, useState } from "react";
import { me, type MeWorkflowRow } from "@/api/me";
import { readAppSpec, type AppSpec } from "@/lib/app-spec";
import { loopOfRow } from "@/hooks/useWorkflowColors";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";

export interface AppGraph {
	text: string;
	sha?: string;
	spec: AppSpec;
	rows: Map<string, MeWorkflowRow>;
	/** Owner can edit (false: operator-shared copy, or not loaded). */
	editable: boolean;
}

const cache = new Map<string, AppGraph>();

export function useAppGraph(app: string) {
	const [graph, setGraph] = useState<AppGraph | null>(() => cache.get(app) ?? null);
	const [error, setError] = useState<string | null>(null);
	const live = useRef(true);
	useEffect(() => () => { live.current = false; }, []);

	const load = useCallback(async () => {
		const [cfg, wf] = await Promise.allSettled([me.appConfig(app), me.listWorkflows("scheduled")]);
		const prev = cache.get(app);
		const text = cfg.status === "fulfilled" ? cfg.value.yaml ?? "" : prev?.text ?? "";
		const sha = cfg.status === "fulfilled" ? cfg.value.sha : prev?.sha;
		const rows = new Map<string, MeWorkflowRow>();
		if (wf.status === "fulfilled") {
			for (const r of wf.value.workflows || []) if ((r.app || "") === app) rows.set(loopOfRow(r), r);
		} else if (prev) {
			for (const [k, v] of prev.rows) rows.set(k, v);
		}
		const g: AppGraph = { text, sha, spec: readAppSpec(text), rows, editable: cfg.status === "fulfilled" };
		cache.set(app, g);
		if (live.current) {
			setGraph(g);
			setError(cfg.status === "rejected" ? "Couldn't read this app's spec" : null);
		}
		return g;
	}, [app]);

	useEffect(() => { setGraph(cache.get(app) ?? null); void load(); }, [app, load]);
	useStudioRefetch(["workflows", "loops", "apps", "runs"], () => { void load(); });

	/**
	 * Save an edit made by `edit(text)` (a lib/app-spec function), with any
	 * definition files. Re-reads first so the edit applies to the newest spec;
	 * on 409 it re-reads and tries once more.
	 */
	const save = useCallback(async (edit: (text: string) => string, files?: Array<{ path: string; content: string }>) => {
		for (let attempt = 0; attempt < 2; attempt++) {
			const cur = await load();
			const next = edit(cur.text);
			try {
				await me.updateAppConfig(app, next, cur.sha, files);
				window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["workflows", "loops"] } }));
				return await load();
			} catch (e) {
				const status = (e as { status?: number }).status;
				if (status === 409 && attempt === 0) continue;
				throw e;
			}
		}
		throw new Error("The spec kept changing while saving — try again");
	}, [app, load]);

	return { graph, error, reload: load, save };
}

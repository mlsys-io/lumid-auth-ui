// What every installed app suggests trying next — for the Inbox's "Needs you".
// Same sources and rules as the Research map: an app's proposals tool, minus
// any already running as an experiment and any put off for this session.

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/api/client";
import { me } from "@/api/me";
import type { Proposal } from "@/lib/research-map";
import { readNotNow, writeNotNow } from "./ApprovalCard";

export interface AppSuggestions { app: string; list: Proposal[] }

export function useSuggestions() {
	const [items, setItems] = useState<AppSuggestions[] | null>(null);
	const load = useCallback(async () => {
		try {
			const { apps } = await me.listApps();
			const names = (apps || []).filter((a) => a.status !== "failed").map((a) => a.name);
			const per = await Promise.all(names.map(async (app) => {
				const [pr, ex] = await Promise.allSettled([
					// The app's own tool: most apps have none, which is "no suggestions".
					apiClient.get(`/api/v1/me/apps/${encodeURIComponent(app)}/data?tool=proposals`),
					me.experiments(app),
				]);
				const raw = pr.status === "fulfilled" ? (pr.value.data?.data?.proposals ?? pr.value.data?.proposals) : null;
				if (!Array.isArray(raw)) return { app, list: [] };
				const running = new Set(ex.status === "fulfilled" ? (ex.value.experiments || []).map((e) => e.id) : []);
				const off = readNotNow(app);
				return { app, list: (raw as Proposal[]).filter((p) => p && typeof p.id === "string" && !running.has(p.id) && !off.includes(p.id)) };
			}));
			setItems(per.filter((x) => x.list.length > 0));
		} catch {
			setItems((cur) => cur ?? []);
		}
	}, []);
	useEffect(() => { void load(); }, [load]);

	const dismiss = (app: string, id: string) => {
		writeNotNow(app, [...readNotNow(app), id]);
		setItems((cur) => (cur ?? []).map((x) => (x.app === app ? { ...x, list: x.list.filter((p) => p.id !== id) } : x)).filter((x) => x.list.length > 0));
	};
	return { items, dismiss, reload: load };
}

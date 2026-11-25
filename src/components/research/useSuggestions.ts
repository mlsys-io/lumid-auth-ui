// What every installed app suggests trying next — for Activity's "Needs you"
// and the sidebar's count beside Activity. Same sources and rules as the
// Research map: an app's proposals tool, minus any already running as an
// experiment and any put off (Snooze). One fetch shared by every caller,
// reused for 5 minutes, so the sidebar can count without a request per page.

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/api/client";
import { me } from "@/api/me";
import type { Proposal } from "@/lib/research-map";
import { readNotNow, writeNotNow } from "./ApprovalCard";

export interface AppSuggestions { app: string; list: Proposal[] }

const TTL_MS = 5 * 60_000;
let shared: { at: number; p: Promise<AppSuggestions[]> } | null = null;

async function fetchAll(): Promise<AppSuggestions[]> {
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
		return { app, list: (raw as Proposal[]).filter((p) => p && typeof p.id === "string" && !running.has(p.id)) };
	}));
	return per.filter((x) => x.list.length > 0);
}

function loadShared(force = false): Promise<AppSuggestions[]> {
	if (force || !shared || Date.now() - shared.at > TTL_MS) {
		const p = fetchAll();
		shared = { at: Date.now(), p };
		p.catch(() => { shared = null; });
	}
	return shared.p;
}

// Snoozes are read at use, not cached: one put off elsewhere drops out here too.
const withoutSnoozed = (all: AppSuggestions[]) =>
	all.map((x) => { const off = readNotNow(x.app); return { ...x, list: x.list.filter((p) => !off.includes(p.id)) }; }).filter((x) => x.list.length > 0);

export function useSuggestions() {
	const [items, setItems] = useState<AppSuggestions[] | null>(null);
	const load = useCallback(async (force = false) => {
		try {
			setItems(withoutSnoozed(await loadShared(force)));
		} catch {
			setItems((cur) => cur ?? []);
		}
	}, []);
	useEffect(() => { void load(); }, [load]);

	const dismiss = (app: string, id: string) => {
		writeNotNow(app, [...readNotNow(app), id]);
		setItems((cur) => (cur ?? []).map((x) => (x.app === app ? { ...x, list: x.list.filter((p) => p.id !== id) } : x)).filter((x) => x.list.length > 0));
	};
	return { items, dismiss, reload: () => load(true) };
}

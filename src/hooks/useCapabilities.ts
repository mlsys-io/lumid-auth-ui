// useCapabilities — what the current user can actually run, used to gate
// the Studio starters so we never offer a workflow that will fail mid-compose
// (e.g. "email triage" without Google connected).
//
// Sources:
//   google     — GET /api/v1/identity/google-grants     (state === 'active')
//   microsoft  — GET /api/v1/identity/microsoft-grants   (state === 'connected')
//   role       — from useAuth()
//   installed  — me.listApps()
//
// Session-cached so the launcher (rendered on several pages + the empty chat)
// doesn't refetch on every mount.

import { useEffect, useState } from "react";
import apiClient from "@/api/client";
import { me } from "@/api/me";
import { useAuth } from "./useAuth";

export interface Capabilities {
	google: boolean;
	microsoft: boolean;
	role: string;
	installedApps: string[];
	loading: boolean;
}

type CapsData = Omit<Capabilities, "role" | "loading">;
let cache: CapsData | null = null;
// In-flight promise shared across concurrent first-mounts. The launcher renders
// on several pages + the empty chat; without this, two simultaneous mounts both
// pass the `if (cache)` guard (cache only fills AFTER the trio resolves) and
// each fires the google/microsoft/listApps burst. Awaiting one promise fixes it.
let inflight: Promise<CapsData> | null = null;

function loadCaps(): Promise<CapsData> {
	if (inflight) return inflight;
	inflight = Promise.allSettled([
		apiClient.get("/api/v1/identity/google-grants"),
		apiClient.get("/api/v1/identity/microsoft-grants"),
		me.listApps(),
	]).then(([g, m, a]) => {
		const gData = g.status === "fulfilled" ? (g.value.data?.data ?? {}) : {};
		const mData = m.status === "fulfilled" ? (m.value.data?.data ?? {}) : {};
		const next: CapsData = {
			// Google grant state is 'active'; Microsoft grant state is 'connected'.
			google: (gData.state ?? gData.google?.state) === "active",
			microsoft: (mData.state ?? mData.microsoft?.state) === "connected",
			installedApps: a.status === "fulfilled" ? (a.value.apps || []).map((x) => x.name) : [],
		};
		cache = next;
		return next;
	}).finally(() => { inflight = null; });
	return inflight;
}

export function useCapabilities(): Capabilities {
	const { user } = useAuth();
	const role = user?.role || "user";
	const [caps, setCaps] = useState<CapsData | null>(cache);
	const [loading, setLoading] = useState(cache === null);

	useEffect(() => {
		if (cache) return;
		let live = true;
		loadCaps().then((next) => {
			if (!live) return;
			setCaps(next);
			setLoading(false);
		});
		return () => { live = false; };
	}, []);

	return {
		google: caps?.google ?? false,
		microsoft: caps?.microsoft ?? false,
		role,
		installedApps: caps?.installedApps ?? [],
		loading,
	};
}

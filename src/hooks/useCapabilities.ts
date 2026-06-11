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

let cache: Omit<Capabilities, "role" | "loading"> | null = null;

export function useCapabilities(): Capabilities {
	const { user } = useAuth();
	const role = user?.role || "user";
	const [caps, setCaps] = useState<Omit<Capabilities, "role" | "loading"> | null>(cache);
	const [loading, setLoading] = useState(cache === null);

	useEffect(() => {
		if (cache) return;
		let live = true;
		Promise.allSettled([
			apiClient.get("/api/v1/identity/google-grants"),
			apiClient.get("/api/v1/identity/microsoft-grants"),
			me.listApps(),
		]).then(([g, m, a]) => {
			if (!live) return;
			const gData = g.status === "fulfilled" ? (g.value.data?.data ?? {}) : {};
			const mData = m.status === "fulfilled" ? (m.value.data?.data ?? {}) : {};
			const next = {
				// Google grant state is 'active'; Microsoft grant state is 'connected'.
				google: (gData.state ?? gData.google?.state) === "active",
				microsoft: (mData.state ?? mData.microsoft?.state) === "connected",
				installedApps: a.status === "fulfilled" ? (a.value.apps || []).map((x) => x.name) : [],
			};
			cache = next;
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

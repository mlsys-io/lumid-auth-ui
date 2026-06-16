// Typed client for GET /api/v1/me/apps/:app/trajectory — the variant
// trajectory tree behind the Runs view. Each node is a variant (a config
// point an autoresearch loop explored); the tree is a baseline root, each
// cycle's variants branching off the running champion, the champion forming
// the trunk. Degrades to a linear run chain for apps without experiments.
//
// Independent of me.ts (same lum.id envelope + cookie idiom); callers treat
// any failure as "empty trajectory".

const ME_BASE =
	(import.meta.env.VITE_ME_API_BASE as string | undefined) || "https://lum.id";

export interface TrajectoryNode {
	id: string;
	kind: "baseline" | "variant" | "run";
	variant_id?: string;
	cycle_ts?: string;
	run_ts?: string; // cycle dir id → me.cycleDetail for the pipeline drill-in
	depth: number;
	parent_id?: string;
	label: string;
	config?: Record<string, string | number | boolean>;
	score?: number;
	scored?: boolean;
	delta_vs_baseline?: number;
	is_champion?: boolean;
	duration_s?: number;
	needs_decision?: boolean;
}

export interface TrajectoryCycle {
	ts: string;
	n_variants: number;
	champion_id?: string;
	champion_score?: number;
	learned?: number;
	best_delta?: number;
}

export interface Trajectory {
	app: string;
	loop: string;
	experiment_id?: string;
	metric?: string;
	higher_is_better?: boolean;
	baseline?: number | null;
	has_variants?: boolean;
	nodes: TrajectoryNode[];
	cycles?: TrajectoryCycle[];
	cycle_scan_cap?: number;
}

export async function fetchTrajectory(app: string, loop: string): Promise<Trajectory> {
	const qs = loop ? `?loop=${encodeURIComponent(loop)}` : "";
	const r = await fetch(
		`${ME_BASE}/api/v1/me/apps/${encodeURIComponent(app)}/trajectory${qs}`,
		{ credentials: "include" },
	);
	let json: { ret_code?: number; message?: string; data?: Trajectory } = {};
	try {
		json = await r.json();
	} catch {
		/* empty / non-JSON */
	}
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) {
		throw new Error(json.message ?? r.statusText);
	}
	return json.data ?? { app, loop, nodes: [], cycles: [] };
}

// ── Control signals (right-click a node → "branch from here") ──────────
export interface TrajectorySignal {
	ts?: string;
	action: string;
	loop?: string;
	from_id?: string;
	from_variant_id?: string;
	config?: Record<string, unknown>;
	note?: string;
	by?: string;
	status?: string;
}

export async function postTrajectorySignal(
	app: string,
	body: { loop?: string; action: string; from_id?: string; from_variant_id?: string; config?: Record<string, unknown>; note?: string },
): Promise<{ recorded: TrajectorySignal; pending: number }> {
	const r = await fetch(`${ME_BASE}/api/v1/me/apps/${encodeURIComponent(app)}/trajectory/signal`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	let json: { ret_code?: number; message?: string; data?: { recorded: TrajectorySignal; pending: number } } = {};
	try { json = await r.json(); } catch { /* empty */ }
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0) || !json.data) {
		throw new Error(json.message ?? r.statusText);
	}
	return json.data;
}

export async function fetchTrajectorySignals(app: string, loop: string): Promise<TrajectorySignal[]> {
	const qs = loop ? `?loop=${encodeURIComponent(loop)}` : "";
	const r = await fetch(`${ME_BASE}/api/v1/me/apps/${encodeURIComponent(app)}/trajectory/signals${qs}`, { credentials: "include" });
	let json: { ret_code?: number; data?: { signals?: TrajectorySignal[] } } = {};
	try { json = await r.json(); } catch { /* empty */ }
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) return [];
	return json.data?.signals ?? [];
}

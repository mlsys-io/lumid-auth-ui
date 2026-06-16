// Typed client for GET /api/v1/me/apps/:app/casebook — the Data tab as a
// first-class evolving CASEBOOK (the eval-set an app's goal metrics are scored
// on, with per-case scores + the casebook's own evolution).
//
// This is a NEW file deliberately kept independent of me.ts: it reuses the same
// lumid-identity envelope ({ ret_code, message, data }) and cross-origin cookie
// auth idiom, but the casebook view is a cold, one-shot read per Data-tab open,
// so it skips me.ts's hot-path TTL cache / in-flight dedup machinery.

const ME_BASE =
	(import.meta.env.VITE_ME_API_BASE as string | undefined) || "https://lum.id";

export interface CasebookScorePoint {
	ts: string;
	score: number;
}

export interface CasebookCase {
	id: string;
	label: string;
	fields?: Record<string, string | number | boolean>;
	latest_score?: number;
	score_history?: CasebookScorePoint[];
}

export interface CasebookVersionPoint {
	ts: string;
	note?: string;
	n_cases: number;
}

export interface CasebookMetricEvolution {
	metric: string;
	points: { ts: string; v: number }[];
}

export interface Casebook {
	app: string;
	loop: string;
	cases: CasebookCase[];
	version_history?: CasebookVersionPoint[];
	metrics_evolution?: CasebookMetricEvolution[];
}

// The data↔metric mapping log for one case: every scoring/labeling record the
// loop's experiments wrote for it (per run / cycle / sub-question), newest first.
export interface CaseLogRecord {
	ts: string;
	cycle_ts?: string;
	variant_id?: string;
	experiment?: string;
	metrics?: Record<string, number | string | boolean>;
	dims?: Record<string, unknown>;
}

export async function fetchCaseLog(app: string, loop: string, caseId: string): Promise<CaseLogRecord[]> {
	const qs = `?loop=${encodeURIComponent(loop)}&case_id=${encodeURIComponent(caseId)}`;
	const r = await fetch(`${ME_BASE}/api/v1/me/apps/${encodeURIComponent(app)}/casebook/case-log${qs}`, { credentials: "include" });
	let json: { ret_code?: number; data?: { records?: CaseLogRecord[] } } = {};
	try { json = await r.json(); } catch { /* empty */ }
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) return [];
	return json.data?.records ?? [];
}

// Fetch the casebook for an app + loop. Mirrors me.ts's unwrap-or-throw, but
// the caller (CasebookPanel) already treats any failure as "empty", so callers
// can simply `.catch(() => emptyCasebook)`.
export async function fetchCasebook(app: string, loop: string): Promise<Casebook> {
	const qs = loop ? `?loop=${encodeURIComponent(loop)}` : "";
	const r = await fetch(
		`${ME_BASE}/api/v1/me/apps/${encodeURIComponent(app)}/casebook${qs}`,
		{ credentials: "include" }, // send lm_session cookie cross-origin
	);
	let json: { ret_code?: number; message?: string; data?: Casebook } = {};
	try {
		json = await r.json();
	} catch {
		/* empty / non-JSON body */
	}
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) {
		throw new Error(json.message ?? r.statusText);
	}
	return (
		json.data ?? { app, loop, cases: [], version_history: [], metrics_evolution: [] }
	);
}

// fleet-view — Research Fleet jobs and sites in plain words. Pure and tested
// (fleet-view.test.ts); RunningNow and admin/fm/* only place them.
//
// The Running rail reads identity's GET /me/fleet/jobs, whose statuses are a
// CACHE: the last status identity saw (models/me_fleet_job.go). The list
// re-reads at most 8 stale unfinished rows per call, inside one 4-second budget
// (internal/handler/me_fleet_jobs.go fleetRefreshRows), and a re-read that fails
// leaves the row as it was — so a finished job could read "Waiting at Office"
// for hours (2026-11-28 sweep: 11 GPU sandbox jobs, 2 h 14 min after they ran,
// while Jobs → Your runs, which reads each job's status, said Done). The rail
// now asks each unfinished job for its status itself (railToConfirm) and, when
// that read fails too, stops calling a job waiting once it is older than any
// fleet job can wait and run (FLEET_SETTLE_S).

import type { FleetJob, FleetStatus } from "../api/fleet";
import { runRowWhen } from "./runs-list";

/** Every site by its name on screen. */
const SITE_NAMES: Record<string, string> = { home: "Home", office: "Office", nus: "NUS", vast: "Vast", cloud: "Cloud" };

/** "office" → "Office", "nus" → "NUS"; an unknown site keeps its own name. */
export function siteName(site?: string | null): string {
	const s = (site || "").trim();
	if (!s) return "";
	return SITE_NAMES[s.toLowerCase()] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/** "home and office" · "home, office and NUS" (lower case, as sites read mid-sentence). */
export function siteList(sites: string[]): string {
	const names = [...new Set(sites.filter(Boolean))].map((s) => (s.toLowerCase() === "nus" ? "NUS" : s.toLowerCase()));
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "1 live worker" · "10 live workers" — never "worker(s)". */
export function countOf(n: number, one: string, many = `${one}s`): string {
	const k = Math.max(0, Math.round(n || 0));
	return `${k} ${k === 1 ? one : many}`;
}

// ── The Running rail ─────────────────────────────────────────────────────

/**
 * How long after it was sent a fleet job can still honestly be waiting or
 * running: a GPU measurement waits at most 15 min for a GPU (identity
 * me_measure.go, queue_timeout_s default 900) and runs at most 60 min
 * (measureMaxTimeoutS 3600). Past that, a status nobody could confirm is not
 * shown as "Waiting".
 */
export const FLEET_SETTLE_S = 75 * 60;
/** At most this many unfinished jobs are asked for their status per poll. */
export const RAIL_CONFIRM_MAX = 6;

/** A status read straight from the job (GET /me/fleet/jobs/:id). */
export interface FleetFresh { status: FleetStatus; terminal: boolean }

const ACTIVE = (s: FleetStatus) => s === "queued" || s === "running";
const createdSec = (j: Pick<FleetJob, "created_at">): number | null => {
	const t = j.created_at ? Date.parse(j.created_at) : NaN;
	return Number.isFinite(t) ? t / 1000 : null;
};

/** The unfinished jobs worth re-reading this poll, newest first (the list is). */
export function railToConfirm(listed: FleetJob[], max = RAIL_CONFIRM_MAX): string[] {
	return listed.filter((j) => !j.terminal && ACTIVE(j.status)).slice(0, max).map((j) => j.id);
}

/**
 * What the rail shows: jobs still waiting or running by the freshest status
 * there is. A job whose own status was read is shown as that status says; one
 * whose status could not be confirmed is shown from the list's cache only while
 * it is younger than FLEET_SETTLE_S.
 */
export function railFleetJobs(listed: FleetJob[], fresh: ReadonlyMap<string, FleetFresh>, nowSec: number): FleetJob[] {
	const out: FleetJob[] = [];
	for (const j of listed) {
		const f = fresh.get(j.id);
		if (f) {
			if (!f.terminal && ACTIVE(f.status)) out.push({ ...j, status: f.status, terminal: false });
			continue;
		}
		if (j.terminal || !ACTIVE(j.status)) continue;
		const t = createdSec(j);
		if (t != null && nowSec - t > FLEET_SETTLE_S) continue;
		out.push(j);
	}
	return out;
}

/** The tile's action line: "Running at Office" · "Waiting at Home". */
export function railAction(job: Pick<FleetJob, "status" | "site">): string {
	const where = siteName(job.site);
	return `${job.status === "running" ? "Running" : "Waiting"}${where ? ` at ${where}` : ""}`;
}

// ── Jobs tab ─────────────────────────────────────────────────────────────

/** "33 workflows on home" · "1 workflow on home" · "120 workflows across home, office and NUS". */
export function workflowsLine(count: number, sites: string[]): string {
	const n = Math.max(0, Math.round(count || 0));
	const what = n === 0 ? "No workflows" : `${n} ${n === 1 ? "workflow" : "workflows"}`;
	const list = siteList(sites);
	if (!list) return what;
	return `${what} ${sites.length > 1 ? "across" : "on"} ${list}`;
}

/** How long a site took to answer: "0.3 s" · "under 0.1 s" · "2 s" · "no answer". */
export function answerTime(ms?: number | null): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return "no answer";
	if (ms < 100) return "under 0.1 s";
	if (ms < 10_000) return `${Math.round(ms / 100) / 10} s`;
	return `${Math.round(ms / 1000)} s`;
}

/** A site chip's tooltip: "home answered in 0.3 s with 33 rows" · "office did not answer: <why>". */
export function siteAnswerTitle(s: { site: string; ok: boolean; count?: number; ms?: number; error?: string }): string {
	if (!s.ok) return `${s.site} did not answer${s.error ? `: ${s.error}` : ""}`;
	const n = s.count ?? 0;
	return `${s.site} answered in ${answerTime(s.ms)} with ${n} ${n === 1 ? "row" : "rows"}`;
}

/** When a run was sent, in the app's format ("28 Nov, 19:45"); "—" when unknown. */
export function fleetWhen(createdAt?: string | null): string {
	const t = createdAt ? Date.parse(createdAt) : NaN;
	return Number.isFinite(t) ? runRowWhen(t / 1000) : "—";
}

/** Under a run's name: where it ran, in words — "on Office". The id stays copyable. */
export function runPlace(job: Pick<FleetJob, "site" | "kind">): string {
	const where = siteName(job.site);
	return where ? `on ${where}` : job.kind === "ll" ? "Lumilake run" : "FlowMesh run";
}

// ── Nodes & workers: what a non-admin is shown, and where their work runs ─

/** "office (23) and home (7)" — the sites of a person's runs, busiest first. */
export function runSites(jobs: Array<Pick<FleetJob, "site">>): Array<{ site: string; runs: number }> {
	const by = new Map<string, number>();
	for (const j of jobs) if (j.site) by.set(j.site, (by.get(j.site) ?? 0) + 1);
	return [...by.entries()].map(([site, runs]) => ({ site, runs })).sort((a, b) => b.runs - a.runs || a.site.localeCompare(b.site));
}

/**
 * The note above a non-admin's machine list. Only home's machines are listed
 * for them, but their work is not limited to home: platform GPU measurements
 * (the GPU sandbox instrument) run on office GPUs for everyone, and a sandbox
 * may be opened on every site in `sandboxSites`. `jobs` are their latest runs
 * (GET /me/fleet/jobs), so the note can say where those actually ran.
 */
export function fleetAccessNote(opts: { listed: string; hidden: string[]; sandboxSites: string[]; jobs?: Array<Pick<FleetJob, "site">> | null }): string[] {
	const lines = [`These are the ${opts.listed} machines. Only admins see the machine lists for ${siteList(opts.hidden)}.`];
	const sbx = opts.sandboxSites.filter((s) => s !== opts.listed);
	lines.push(
		`Your work still runs beyond ${opts.listed}: GPU measurements (the GPU sandbox instrument) run on office GPUs for everyone` +
			(sbx.length ? `, and you can open a sandbox on ${siteList([opts.listed, ...sbx])} from Sandboxes.` : "."),
	);
	const sites = runSites(opts.jobs ?? []);
	if (sites.length) {
		const n = sites.reduce((a, s) => a + s.runs, 0);
		const parts = sites.map((s) => `${s.site === "nus" ? "NUS" : s.site} (${s.runs})`);
		const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
		lines.push(`Your latest ${n === 1 ? "run" : `${n} runs`} ran on ${joined} — see Jobs → Your runs.`);
	}
	return lines;
}

/** The Sandboxes tab's "where": " Every site." for admins, " On home and office." otherwise. */
export function sandboxSitesWords(isAdmin: boolean, sites: string[]): string {
	return isAdmin ? "Every site." : `On ${siteList(sites) || "home"}.`;
}

// ── Research Fleet machines in words (quant audit 6 gap 12, 2026-11-28) ─────
// The machine boxes said "nde-855", "cpu_0 —" and "IDLE", and nothing answered
// the one question a researcher has here: can my run start now, and where?

/** A worker's status in plain words. */
export function workerStatusWords(status?: string | null): string {
	const s = String(status ?? "").toUpperCase();
	return s === "IDLE" ? "free" : s === "BUSY" ? "busy" : s === "STARTING" ? "starting" : s === "STOPPING" ? "stopping" : s === "STOPPED" ? "stopped" : s ? s.toLowerCase() : "unknown";
}

/** "cpu_0" → "CPU worker 1", "gpu_1" → "GPU worker 2"; any other name is kept. */
export function workerName(name: string): string {
	const m = /^(cpu|gpu)[_-]?(\d+)$/i.exec(name.trim());
	return m ? `${m[1].toUpperCase()} worker ${Number(m[2]) + 1}` : name;
}

export interface SiteWorkers { site: string; workers: Array<{ status?: string | null; gpu: boolean }> }

/** The first line of Research Fleet: can a run start now, and where. */
export function startNowLine(sites: SiteWorkers[]): string {
	const tally = (gpu: boolean) => {
		const per: Array<{ site: string; free: number; all: number }> = [];
		for (const s of sites) {
			const ws = s.workers.filter((w) => w.gpu === gpu);
			if (!ws.length) continue;
			per.push({ site: s.site, free: ws.filter((w) => workerStatusWords(w.status) === "free").length, all: ws.length });
		}
		return { per, free: per.reduce((a, p) => a + p.free, 0), all: per.reduce((a, p) => a + p.all, 0) };
	};
	const where = (per: Array<{ site: string; free: number }>) => per.filter((p) => p.free).map((p) => `${siteName(p.site)} ${p.free}`).join(", ");
	const g = tally(true), c = tally(false);
	if (!g.all && !c.all) return "No machine is answering right now, so a run would wait.";
	const gpu = !g.all ? "No GPU machine is answering, so a GPU run would wait."
		: g.free ? `A GPU run can start now: ${countOf(g.free, "GPU worker")} free (${where(g.per)}).`
			: `A GPU run waits: all ${countOf(g.all, "GPU worker")} are busy.`;
	const cpu = !c.all ? "" : c.free ? ` A CPU run can start too: ${c.free} free.` : ` CPU runs wait: all ${countOf(c.all, "CPU worker")} are busy.`;
	return gpu + cpu;
}

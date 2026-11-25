// data-jobs — the pure half of Studio → Data → Jobs (lum.id/data /jobs/v1/*).
//
// Everything here takes the wire payload as UNTRUSTED: the service is Rust
// (serde never sends a null list today) but the federation layer may later
// fan in from hubs that do, and one unguarded `.map()` on a null unmounts the
// whole Data page (reference_null_slice_blank_page). Normalise at the
// boundary, render from the normalised shape only.
//
// No React, no fetch — unit-tested in data-jobs.test.ts.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RunStatus } from "@/lib/runStatus";
import type { ToneKey } from "@/lib/tones";

// ── shapes (normalised) ─────────────────────────────────────────────────────

export type SourceScope = "mine" | "shared" | "public";
export type Visibility = "private" | "shared" | "public";

export interface HubStatus {
	id: string;
	ok: boolean;
	ms?: number;
	error?: string;
}

export interface DataSource {
	source_id: string;
	name: string;
	owner: string;
	hub: string;
	kind: string;
	ref: string;
	description: string;
	site: string;
	visibility: Visibility | string;
	size_bytes_est: number | null;
}

export interface SourceDecl {
	ref: string;
	max_bytes?: number;
	window?: string;
}

export type Runtime = "auto" | "flowmesh" | "lumilake" | "sandbox";
export const RUNTIMES: Runtime[] = ["auto", "flowmesh", "lumilake", "sandbox"];

export interface JobSpec {
	app: string;
	runtime: Runtime | string;
	name?: string;
	sources: SourceDecl[];
	sinks: SourceDecl[];
	payload?: unknown;
	parent_job_id?: string;
}

export interface PlanReason {
	code: string;
	msg: string;
}

export interface PlanSource {
	ref: string;
	/** local | lan | tailnet | proxy | egress | public | model | internet */
	via: string;
	site: string;
	url: string;
	bytes: number | null;
	/** exact | declared | upper_bound | unknown */
	sizeKind: string;
	local: boolean;
}

export interface PlanAlternative {
	site: string;
	blocking: PlanReason[];
}

export interface Plan {
	planId: string;
	placed: boolean;
	site: string;
	owningHub: string;
	runtime: string;
	sources: PlanSource[];
	localBytes: number | null;
	remoteBytes: number | null;
	reasons: PlanReason[];
	alternatives: PlanAlternative[];
}

export interface JobSourceRow {
	ref: string;
	access: string;
	site: string;
	via: string;
	est_bytes: number | null;
	actual_bytes: number | null;
}

export interface Job {
	job_id: string;
	hub: string;
	app: string;
	name: string;
	runtime: string;
	site: string;
	status: string;
	error: string;
	created_at: string;
	started_at: string;
	ended_at: string;
	est_bytes: number | null;
	sources: JobSourceRow[];
	spec: unknown;
}

export interface JobEvent {
	id: number;
	at: string;
	kind: string;
	status: string;
	message: string;
	by: string;
}

// ── coercion helpers ────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function reasons(v: unknown): PlanReason[] {
	return arr(v).map((r) => {
		if (typeof r === "string") return { code: "", msg: r };
		const o = obj(r);
		return { code: str(o.code), msg: str(o.msg ?? o.message) || str(o.code) };
	}).filter((r) => r.msg);
}

/** `hubs:[{id, ok, ms, error}]` — present on list responses; partial results
 *  name the hub that failed. Missing → []. */
export function normalizeHubs(v: unknown): HubStatus[] {
	return arr(v).map((h) => {
		const o = obj(h);
		return {
			id: str(o.id) || "unknown",
			ok: o.ok !== false,
			ms: num(o.ms) ?? undefined,
			error: str(o.error) || undefined,
		};
	});
}

export function normalizeSource(v: unknown): DataSource | null {
	const o = obj(v);
	const id = str(o.source_id);
	if (!id) return null;
	const def = obj(o.definition);
	return {
		source_id: id,
		name: str(o.name) || id,
		owner: str(o.owner ?? o.owner_sub),
		hub: str(o.hub ?? o.home_hub) || "home",
		kind: str(o.kind),
		ref: str(o.ref ?? def.ref),
		description: str(o.description ?? def.description),
		site: str(o.site),
		visibility: str(o.visibility) || "private",
		size_bytes_est: num(o.size_bytes_est),
	};
}

export function normalizeSources(resp: unknown): { sources: DataSource[]; hubs: HubStatus[] } {
	const o = obj(resp);
	return {
		sources: arr(o.sources).map(normalizeSource).filter((s): s is DataSource => s !== null),
		hubs: normalizeHubs(o.hubs),
	};
}

/** Sources grouped by the hub that holds them, hubs in first-seen order. */
export function groupByHub(sources: DataSource[]): { hub: string; sources: DataSource[] }[] {
	const m = new Map<string, DataSource[]>();
	for (const s of sources) {
		const k = s.hub || "home";
		if (!m.has(k)) m.set(k, []);
		m.get(k)!.push(s);
	}
	return [...m].map(([hub, list]) => ({ hub, sources: list }));
}

/** A planner Size `{kind, bytes}`, or a bare number (est_bytes). */
function size(v: unknown): { bytes: number | null; kind: string } {
	if (typeof v === "number") return { bytes: num(v), kind: "exact" };
	const o = obj(v);
	return { bytes: num(o.bytes), kind: str(o.kind) || "unknown" };
}

/** The plan response: `{plan_id, plan: {outcome, site, runtime, sources, …}}`.
 *  Also accepts the flatter `{site, owning_hub, sources:[{route_kind, est_bytes,
 *  local}]}` shape, so a later hub version can't blank the card. */
export function normalizePlan(resp: unknown, fallbackHub = ""): Plan {
	const top = obj(resp);
	const p = Object.keys(obj(top.plan)).length ? obj(top.plan) : top;
	const outcome = str(p.outcome);
	const sources = arr(p.sources).map((s): PlanSource => {
		const o = obj(s);
		const sz = o.size !== undefined ? size(o.size) : size(o.est_bytes);
		const via = str(o.via ?? o.route_kind) || (o.local === true ? "local" : "");
		return {
			ref: str(o.ref),
			via,
			site: str(o.source_site ?? o.site ?? o.hub),
			url: str(o.url),
			bytes: sz.bytes,
			sizeKind: sz.kind,
			local: via === "local" || o.local === true,
		};
	});
	return {
		planId: str(top.plan_id ?? p.plan_id),
		placed: outcome ? outcome === "placed" : !!str(p.site),
		site: str(p.site),
		owningHub: str(p.owning_hub ?? top.owning_hub ?? p.hub ?? top.hub) || fallbackHub,
		runtime: str(p.runtime),
		sources,
		localBytes: num(p.local_bytes),
		remoteBytes: num(p.remote_bytes),
		reasons: reasons(p.reasons),
		alternatives: arr(p.alternatives).map((a) => {
			const o = obj(a);
			return { site: str(o.site), blocking: reasons(o.blocking ?? o.reasons) };
		}).filter((a) => a.site),
	};
}

function errorText(v: unknown): string {
	if (v == null) return "";
	if (typeof v === "string") return v;
	const o = obj(v);
	return str(o.message ?? o.msg ?? o.error ?? o.code);
}

export function normalizeJob(v: unknown): Job | null {
	const o = obj(v);
	const id = str(o.job_id);
	if (!id) return null;
	const spec = obj(o.spec);
	return {
		job_id: id,
		hub: str(o.hub ?? o.home_hub),
		app: str(o.app ?? spec.app),
		name: str(spec.name ?? o.name),
		runtime: str(o.runtime),
		site: str(o.site),
		status: str(o.status) || "planned",
		error: errorText(o.error),
		created_at: str(o.created_at),
		started_at: str(o.started_at),
		ended_at: str(o.ended_at),
		est_bytes: num(o.est_bytes),
		sources: arr(o.sources).map((s) => {
			const r = obj(s);
			return {
				ref: str(r.ref),
				access: str(r.access),
				site: str(r.site),
				via: str(r.via ?? r.route_kind),
				est_bytes: num(r.est_bytes),
				actual_bytes: num(r.actual_bytes),
			};
		}),
		spec: o.spec ?? null,
	};
}

export function normalizeJobs(resp: unknown): { jobs: Job[]; hubs: HubStatus[] } {
	const o = obj(resp);
	return {
		jobs: arr(o.jobs).map(normalizeJob).filter((j): j is Job => j !== null),
		hubs: normalizeHubs(o.hubs),
	};
}

export function normalizeEvents(resp: unknown): JobEvent[] {
	return arr(obj(resp).events).map((e, i) => {
		const o = obj(e);
		const p = obj(o.payload);
		return {
			id: num(o.id) ?? i,
			at: str(o.at),
			kind: str(o.kind),
			status: str(o.status),
			message: str(p.message) || errorText(p.error),
			by: str(p.by),
		};
	});
}

// ── status ──────────────────────────────────────────────────────────────────

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "canceled", "refused"]);
export const isTerminal = (status: string) => TERMINAL.has(status.toLowerCase());

/** The job lifecycle on the one run vocabulary (lib/runStatus). */
export function jobRunStatus(status: string): RunStatus {
	switch (status.toLowerCase()) {
		case "planned":
		case "submitted":
			return "queued";
		case "running":
			return "running";
		case "succeeded":
			return "succeeded";
		case "failed":
		case "refused":
			return "failed";
		case "cancelled":
		case "canceled":
			return "cancelled";
		default:
			return "skipped";
	}
}

/** Plain words for a job's status. */
/** Seconds a job has been going: since it started, or since it was created
 *  when it hasn't started yet. 0 when neither time parses. */
export function jobElapsedS(j: Pick<Job, "started_at" | "created_at">, nowSec: number): number {
	const t = Date.parse(j.started_at || j.created_at || "");
	return Number.isFinite(t) ? Math.max(0, nowSec - t / 1000) : 0;
}

export function jobStatusLabel(status: string): string {
	switch (status.toLowerCase()) {
		case "planned": return "Waiting to start";
		case "submitted": return "Starting";
		case "running": return "Running";
		case "succeeded": return "Succeeded";
		case "failed": return "Failed";
		case "refused": return "Couldn't be placed";
		case "cancelled":
		case "canceled": return "Cancelled";
		default: return status || "Unknown";
	}
}

// ── routes ──────────────────────────────────────────────────────────────────

/** How a source reaches the site the job runs at, in words (plan card chip). */
export function routeChip(via: string): { label: string; tone: ToneKey; hint: string } {
	switch (via) {
		case "local": return { label: "Same site", tone: "ok", hint: "The data is where the job runs; nothing crosses a network." };
		case "lan": return { label: "Local network", tone: "ok", hint: "Read over the site's own network." };
		case "tailnet": return { label: "Private link", tone: "running", hint: "Read over the private network between sites (tailnet)." };
		case "proxy": return { label: "Via proxy", tone: "attention", hint: "Read through a relay in between." };
		case "egress": return { label: "Cloud egress", tone: "attention", hint: "Leaves the cloud over its paid egress." };
		case "public": return { label: "Public internet", tone: "attention", hint: "Read over the public internet (encrypted)." };
		case "model": return { label: "Model cache", tone: "idle", hint: "A model, loaded from a worker's cache." };
		case "internet": return { label: "Outside API", tone: "idle", hint: "A live external service; recorded, not moved." };
		default: return { label: via || "Unknown route", tone: "idle", hint: "" };
	}
}

// ── spec ↔ YAML ─────────────────────────────────────────────────────────────

export const STARTER_SPEC: JobSpec = {
	app: "my-app",
	runtime: "auto",
	name: "first job",
	sources: [{ ref: "findata://reference.symbols" }],
	sinks: [],
	payload: {},
};

const SLUG = /^[A-Za-z0-9._-]{1,64}$/;

function decls(v: unknown, what: string, errors: string[]): SourceDecl[] {
	if (v == null) return [];
	if (!Array.isArray(v)) {
		errors.push(`${what} should be a list`);
		return [];
	}
	const out: SourceDecl[] = [];
	v.forEach((d, i) => {
		// A bare string is shorthand for {ref: "..."}.
		const o = typeof d === "string" ? { ref: d } : obj(d);
		const ref = str(o.ref).trim();
		if (!ref) {
			errors.push(`${what} #${i + 1} needs a ref`);
			return;
		}
		const decl: SourceDecl = { ref };
		const mb = num(o.max_bytes);
		if (o.max_bytes != null && (mb == null || mb <= 0)) errors.push(`${what} #${i + 1}: max_bytes must be a positive number`);
		else if (mb != null) decl.max_bytes = mb;
		if (str(o.window)) decl.window = str(o.window);
		out.push(decl);
	});
	return out;
}

/** Check a spec the way the service will, so the obvious mistakes are caught
 *  before a round-trip. The service stays the authority. */
export function validateSpec(raw: unknown): { spec: JobSpec | null; errors: string[] } {
	const errors: string[] = [];
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { spec: null, errors: ["The spec should be a set of fields (app, runtime, sources, …)"] };
	const o = raw as Obj;
	const known = new Set(["app", "runtime", "name", "sources", "sinks", "payload", "parent_job_id"]);
	for (const k of Object.keys(o)) if (!known.has(k)) errors.push(`Unknown field "${k}"`);
	const app = str(o.app).trim();
	if (!SLUG.test(app)) errors.push("app: letters, digits, dot, dash or underscore (1–64)");
	const runtime = str(o.runtime).trim() || "auto";
	if (!(RUNTIMES as string[]).includes(runtime)) errors.push(`runtime: one of ${RUNTIMES.join(", ")}`);
	const sources = decls(o.sources, "source", errors);
	const sinks = decls(o.sinks, "sink", errors);
	if (!sources.length && !sinks.length) errors.push("Add at least one source (or sink)");
	if (sources.length + sinks.length > 64) errors.push("At most 64 sources and sinks together");
	const spec: JobSpec = { app, runtime, sources, sinks };
	if (str(o.name)) spec.name = str(o.name);
	if (o.payload !== undefined) spec.payload = o.payload;
	if (str(o.parent_job_id)) spec.parent_job_id = str(o.parent_job_id);
	return { spec: errors.length ? null : spec, errors };
}

export function specFromYaml(text: string): { spec: JobSpec | null; errors: string[] } {
	let raw: unknown;
	try {
		raw = parseYaml(text);
	} catch (e) {
		const m = e instanceof Error ? e.message.split("\n")[0] : String(e);
		return { spec: null, errors: [`Not valid YAML: ${m}`] };
	}
	return validateSpec(raw);
}

export function specToYaml(spec: JobSpec): string {
	const out: Obj = { app: spec.app, runtime: spec.runtime };
	if (spec.name) out.name = spec.name;
	out.sources = spec.sources;
	if (spec.sinks?.length) out.sinks = spec.sinks;
	if (spec.payload !== undefined) out.payload = spec.payload;
	if (spec.parent_job_id) out.parent_job_id = spec.parent_job_id;
	return stringifyYaml(out);
}

/** Add a source ref to the YAML text, keeping the rest as written. Returns the
 *  text unchanged when it doesn't parse (the editor shows why). */
export function addSourceToYaml(text: string, ref: string): string {
	let raw: unknown;
	try {
		raw = parseYaml(text);
	} catch {
		return text;
	}
	const o: Obj = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Obj) } : { ...STARTER_SPEC, sources: [] };
	const list = Array.isArray(o.sources) ? [...o.sources] : [];
	if (list.some((d) => (typeof d === "string" ? d : str(obj(d).ref)) === ref)) return text;
	list.push({ ref });
	o.sources = list;
	return stringifyYaml(o);
}

// ── errors ──────────────────────────────────────────────────────────────────

/** `{"error": {"code", "message"}}` → its parts. Anything else → the text. */
export function parseApiError(body: string): { code: string; message: string } {
	try {
		const e = obj(obj(JSON.parse(body)).error);
		if (str(e.message) || str(e.code)) return { code: str(e.code), message: str(e.message) || str(e.code) };
	} catch {
		/* not JSON */
	}
	const t = body.trim();
	// An HTML error page (nginx) says nothing useful; don't paste it on screen.
	return { code: "", message: t.startsWith("<") ? "" : t.slice(0, 300) };
}

/** Run-list address for a job (Studio → Data → Jobs, that job open). */
export function jobHref(jobId: string): string {
	return `/studio/data-warehouse?tab=jobs&job=${encodeURIComponent(jobId)}`;
}

/** A jobs API error in plain words. The service's messages are sentences
 *  already; the codes below get a better one, and a code never reaches the
 *  screen on its own. */
export function jobsErrorWords(status: number, code: string, message: string): string {
	switch (code) {
		case "plan_not_found": return "This plan has expired (plans last 15 minutes). Check the plan again.";
		case "job_not_found": return "That job isn't there, or it isn't yours.";
		case "source_not_found": return "That source isn't there, or it isn't yours.";
		case "source_exists": return message || "You already have a source with that name.";
		case "job_already_ended": return "This job has already ended.";
		case "source_not_entitled": return message ? `You don't have access to a source: ${message}` : "You don't have access to one of these sources.";
		case "job_tokens_cannot_manage_jobs": return "A job's own token can't do this — sign in as yourself.";
	}
	if (message && !/^[a-z0-9_]+$/.test(message)) return message;
	if (status === 401) return "Your session has ended. Sign in again.";
	if (status === 403) return "You don't have permission to do that.";
	if (status === 404) return "Jobs aren't switched on for lum.id/data yet.";
	if (status === 429) return "Too many requests — wait a moment and try again.";
	if (status >= 500) return `lum.id/data is having trouble (HTTP ${status}). Try again in a moment.`;
	return status ? `The request failed (HTTP ${status}).` : "The request failed.";
}

/** /me/runs `sources.jobs` → a line for the Activity page when lum.id/data
 *  jobs couldn't be read (identity adds them best-effort). null = say nothing:
 *  read fine, switched off, or not configured on this deployment. */
export function jobsSourceNotice(status: string | null | undefined): string | null {
	switch (status) {
		case "unreachable":
		case "timeout":
		case "error":
			return "Data jobs couldn't be loaded just now, so they're missing from this list.";
		case "unauthenticated":
			return "lum.id/data declined to list your data jobs, so they're missing from this list.";
		default:
			return null;
	}
}

// What a Research Fleet run produced, and why it failed, in plain words. Pure
// and tested (fleet-result.test.ts); the "Your runs" panel (admin/fm/my-runs.tsx)
// only places them.
//
// Two backends answer GET /me/fleet/jobs/<id>?view=result (identity,
// internal/handler/me_fleet_jobs.go):
//
//  - FlowMesh ("fm"): `outputs` is a list of steps, `{task_id, name, result}` or
//    `{task_id, name, error}` for a step that failed.
//  - Lumilake ("ll"): `outputs` is the stored LumilakeResponse,
//    `{outputs: {<graph>: {<output>: [item, …]}}, error_info: [...], chat_histories}`.
//    An item is a STRING, usually `{"df": "<pandas to_json(orient=columns)>"}`
//    — JSON inside JSON inside JSON (measured 2026-11-25, nus:ll:req-…).
//    A failed Lumilake run says only `batch_error: "Output task tsk-… failed"`;
//    a sibling error_info entry's `task_node_map` names that task's op.
//
// The status view (`?view=status`) adds `error` and, for FlowMesh, `failed_step`.

import { plainCause } from "./activity";
import type { FleetJob, FleetStatus } from "../api/fleet";

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ── internals kept off the screen ─────────────────────────────────────────

const PRIVATE_ADDR = new RegExp(
	String.raw`(?:https?://)?(?:\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}|\b192\.168\.\d{1,3}\.\d{1,3}|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|\blocalhost\b)(?::\d+)?(?:/[^\s"'<>,;)]*)?`,
	"gi",
);
const MACHINE_PATH = /(?<![\w.:/~-])(?:file:\/\/)?\/(?:home|root|tmp|data|var|opt|mnt|srv|workspace|app|usr|etc|proc|run|scratch|nfs|lustre|private|Users|results|models|cache)(?:\/[^\s"'<>,;)]*)?/g;

/** A machine's private address or file path, replaced by words. */
export function hideInternals(text: string): string {
	return text.replace(PRIVATE_ADDR, "(internal address)").replace(MACHINE_PATH, "(internal path)");
}

/** Keys that only describe where a machine keeps things: `_artifacts`, `base_dir`, `base_url`, any `_x`, any `x_dir`. */
function internalKey(k: string): boolean {
	return k.startsWith("_") || k.endsWith("_dir") || k === "base_url";
}

/** A result with machine internals removed: internal keys dropped, private addresses and paths hidden. */
export function publicResult(v: unknown): unknown {
	if (typeof v === "string") return hideInternals(v);
	if (Array.isArray(v)) return v.map(publicResult);
	const r = asRecord(v);
	if (!r) return v;
	const out: Record<string, unknown> = {};
	for (const [k, val] of Object.entries(r)) if (!internalKey(k)) out[k] = publicResult(val);
	return out;
}

// ── Lumilake tables ───────────────────────────────────────────────────────

export interface ResultTable {
	caption: string;
	columns: string[];
	/** Per column: every value is a number (so it reads right-aligned). */
	numeric: boolean[];
	/** Row labels, only when the frame's index is not just 0, 1, 2, … */
	index: string[] | null;
	rows: string[][];
	/** Rows in the result; `rows` holds at most MAX_TABLE_ROWS of them. */
	totalRows: number;
}

export interface ResultText {
	caption: string;
	texts: string[];
}

export interface LumilakeView {
	tables: ResultTable[];
	texts: ResultText[];
}

export const MAX_TABLE_ROWS = 200;

interface Frame {
	columns: string[];
	index: string[];
	cells: unknown[][];
}

function parseJSON(s: string): unknown {
	const t = s.trim();
	if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
	try {
		return JSON.parse(t);
	} catch {
		return undefined;
	}
}

function orderedIndex(keys: string[]): string[] {
	return keys.every((k) => /^-?\d+$/.test(k)) ? [...keys].sort((a, b) => Number(a) - Number(b)) : keys;
}

/** A pandas frame from to_json's columns, split or records orient; null for anything else. */
function toFrame(v: unknown): Frame | null {
	if (typeof v === "string") return toFrame(parseJSON(v));
	if (Array.isArray(v)) {
		// orient=records: [{col: value}, …]
		if (v.length === 0 || !v.every((r) => asRecord(r))) return null;
		const columns: string[] = [];
		for (const r of v) for (const k of Object.keys(r as object)) if (!columns.includes(k)) columns.push(k);
		return {
			columns,
			index: v.map((_, i) => String(i)),
			cells: v.map((r) => columns.map((c) => (r as Record<string, unknown>)[c])),
		};
	}
	const r = asRecord(v);
	if (!r) return null;
	// orient=split: {columns, index, data}
	if (Array.isArray(r.columns) && Array.isArray(r.data)) {
		const columns = r.columns.map(String);
		const data = r.data.filter(Array.isArray) as unknown[][];
		const index = Array.isArray(r.index) && r.index.length === data.length ? r.index.map(String) : data.map((_, i) => String(i));
		return { columns, index, cells: data.map((row) => columns.map((_, i) => row[i])) };
	}
	// orient=columns: {col: {index: value}}
	const columns = Object.keys(r);
	if (columns.length === 0 || !columns.every((c) => asRecord(r[c]))) return null;
	const seen: string[] = [];
	for (const c of columns) for (const k of Object.keys(r[c] as object)) if (!seen.includes(k)) seen.push(k);
	const index = orderedIndex(seen);
	return { columns, index, cells: index.map((i) => columns.map((c) => (r[c] as Record<string, unknown>)[i])) };
}

/** One Lumilake output item as a frame: `{"df": "<frame json>"}` (string or object), or a frame itself. */
function itemFrame(item: unknown): Frame | null {
	const v = typeof item === "string" ? parseJSON(item) : item;
	const r = asRecord(v);
	if (r && "df" in r) return toFrame(r.df);
	return toFrame(v);
}

function defaultIndex(index: string[]): boolean {
	return index.every((k, i) => k === String(i));
}

/** One table cell in words. */
export function cellText(v: unknown): string {
	if (v === null || v === undefined || v === "") return "—";
	if (typeof v === "boolean") return v ? "yes" : "no";
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
	if (typeof v === "string") return hideInternals(v);
	return hideInternals(JSON.stringify(publicResult(v)));
}

function frameTable(caption: string, frames: Frame[]): ResultTable {
	const columns = frames[0].columns;
	const index = frames.flatMap((f) => f.index);
	const cells = frames.flatMap((f) => f.cells);
	const showIndex = frames.some((f) => !defaultIndex(f.index));
	const numeric = columns.map((_, c) => {
		const vals = cells.map((row) => row[c]).filter((x) => x !== null && x !== undefined);
		return vals.length > 0 && vals.every((x) => typeof x === "number");
	});
	const kept = cells.slice(0, MAX_TABLE_ROWS);
	return {
		caption,
		columns,
		numeric,
		index: showIndex ? index.slice(0, MAX_TABLE_ROWS).map(hideInternals) : null,
		rows: kept.map((row) => row.map(cellText)),
		totalRows: cells.length,
	};
}

/** "graph_0" → "graph 0". */
function graphWords(g: string): string {
	return g.replace(/_/g, " ");
}

/**
 * A Lumilake result's outputs as tables (one per output; an output whose items
 * share columns is one table) and plain text. Shapes it does not recognize are
 * left out — the caller shows the raw result for those.
 */
export function lumilakeView(outputs: unknown): LumilakeView {
	const view: LumilakeView = { tables: [], texts: [] };
	const graphs = asRecord(asRecord(outputs)?.outputs);
	if (!graphs) return view;
	const graphNames = Object.keys(graphs);
	for (const g of graphNames) {
		const outs = asRecord(graphs[g]);
		if (!outs) continue;
		for (const [name, items] of Object.entries(outs)) {
			if (!Array.isArray(items) || items.length === 0) continue;
			const base = graphNames.length > 1 ? `${name} · ${graphWords(g)}` : name;
			const frames: Frame[] = [];
			const texts: string[] = [];
			for (const it of items) {
				const f = itemFrame(it);
				if (f && f.columns.length > 0) frames.push(f);
				else if (typeof it === "string" && parseJSON(it) === undefined) texts.push(hideInternals(it));
				else if (typeof it === "number" || typeof it === "boolean") texts.push(String(it));
				// anything else stays in the raw result only
			}
			// Frames with the same columns read as one table; different ones, one each.
			const groups: Frame[][] = [];
			for (const f of frames) {
				const same = groups.find((gr) => gr[0].columns.join("\u0000") === f.columns.join("\u0000"));
				if (same) same.push(f);
				else groups.push([f]);
			}
			groups.forEach((gr, i) =>
				view.tables.push(frameTable(groups.length > 1 ? `${base} (${i + 1} of ${groups.length})` : base, gr)));
			if (texts.length > 0) view.texts.push({ caption: base, texts });
		}
	}
	return view;
}

/** "Showing the first 200 of 1,234 rows", or null when every row is shown. */
export function tableCapLine(t: ResultTable): string | null {
	return t.totalRows > t.rows.length ? `Showing the first ${t.rows.length} of ${t.totalRows} rows` : null;
}

/** "3 rows" / "1 row". */
export function rowsLabel(n: number): string {
	return `${n} row${n === 1 ? "" : "s"}`;
}

// ── why a run failed ──────────────────────────────────────────────────────

export interface RunProblem {
	/** The step (FlowMesh task name / Lumilake op) that failed, when known. */
	step: string | null;
	/** Why, in words. */
	why: string;
}

/** An `error` value (string, or an object with a message) as text. */
function errorText(e: unknown): string {
	if (typeof e === "string") return e.trim();
	const r = asRecord(e);
	if (r) {
		for (const k of ["message", "detail", "error", "reason"]) if (typeof r[k] === "string" && r[k]) return (r[k] as string).trim();
		return JSON.stringify(publicResult(r));
	}
	return e === null || e === undefined ? "" : String(e);
}

/** Error text a person can read: internals hidden, first meaningful line, bounded. */
function readableError(raw: string): string {
	const s = hideInternals(raw).trim();
	// A Python traceback: its last line is the error.
	const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
	const line = /^Traceback \(most recent call last\)/.test(lines[0] ?? "") ? lines[lines.length - 1] : lines[0] ?? "";
	return line.length > 300 ? line.slice(0, 299) + "…" : line;
}

const LL_OPAQUE = "Lumilake didn't say why";

/** One Lumilake batch_error in words, naming the op when task_node_map knows the task. */
function lumilakeBatchProblem(raw: string, nodeOf: Record<string, string>): RunProblem {
	const out = raw.match(/^Output task (\S+) failed\.?$/i);
	if (out) return { step: nodeOf[out[1]] ?? null, why: nodeOf[out[1]] ? LL_OPAQUE : `A step failed; ${LL_OPAQUE}` };
	const abort = raw.match(/^Task (\S+) failed; aborting workflow \((\d+) task\(s\) failed in total\)/i);
	if (abort) {
		const n = Number(abort[2]);
		const more = n > 1 ? ` (${n} steps failed in all)` : "";
		const step = nodeOf[abort[1]] ?? null;
		return { step, why: step ? `${LL_OPAQUE}${more}` : `A step failed and the run stopped${more}; ${LL_OPAQUE}` };
	}
	const timeout = raw.match(/^Timeout waiting for output nodes to complete after ([\d.]+)s/i);
	if (timeout) return { step: null, why: `Timed out after ${Math.round(Number(timeout[1]))} s waiting for the last steps to finish` };
	return { step: null, why: readableError(raw) };
}

/**
 * Why a run failed, best reason first: FlowMesh's failed steps, Lumilake's
 * error_info (with the op named), then the status view's `error` /
 * `failed_step` when it says something the result did not.
 */
export function runProblems(input: {
	outputs?: unknown;
	status?: { error?: unknown; failed_step?: string } | null;
}): RunProblem[] {
	const out: RunProblem[] = [];
	const seenRaw = new Set<string>();
	const add = (p: RunProblem, raw: string) => {
		if (raw) seenRaw.add(raw);
		if (!out.some((o) => o.step === p.step && o.why === p.why)) out.push(p);
	};

	// FlowMesh: a list of steps; a failed one carries `error`.
	if (Array.isArray(input.outputs)) {
		for (const s of input.outputs) {
			const r = asRecord(s);
			if (!r || typeof r.error !== "string" || !r.error.trim()) continue;
			add({ step: typeof r.name === "string" && r.name ? r.name : null, why: readableError(r.error) }, r.error.trim());
		}
	}

	// Lumilake: error_info entries.
	const info = asRecord(input.outputs)?.error_info;
	if (Array.isArray(info)) {
		const nodeOf: Record<string, string> = {};
		for (const e of info) {
			const m = asRecord(asRecord(e)?.task_node_map);
			if (m) for (const [tid, node] of Object.entries(m)) if (typeof node === "string") nodeOf[tid] = node;
		}
		for (const e of info) {
			const r = asRecord(e);
			if (!r) {
				if (typeof e === "string" && e.trim()) add({ step: null, why: readableError(e) }, e.trim());
				continue;
			}
			if (typeof r.batch_error === "string" && r.batch_error.trim()) {
				add(lumilakeBatchProblem(r.batch_error.trim(), nodeOf), r.batch_error.trim());
			} else if (typeof r.missing_output === "string") {
				add({ step: null, why: "Part of the run finished without producing its output" }, "");
			} else if (typeof r.error === "string" && r.error.trim()) {
				add({ step: null, why: readableError(r.error) }, r.error.trim());
			}
		}
	}

	// The status view: FlowMesh's first failed step, or Lumilake's summary error.
	const st = input.status;
	if (st) {
		const raw = errorText(st.error);
		if (raw && !seenRaw.has(raw)) {
			const step = st.failed_step || null;
			add(/^(Output )?task \S+ failed/i.test(raw) ? { ...lumilakeBatchProblem(raw, {}), step: step ?? null } : { step, why: readableError(raw) }, raw);
		}
	}
	return out;
}

/** One problem as a sentence: `The step “count” failed: <why>`. */
export function problemLine(p: RunProblem): string {
	return p.step ? `The step “${hideInternals(p.step)}” failed: ${p.why}` : p.why;
}

/** What to say when a failed run's result could not be read. */
export function resultUnavailableLine(status: FleetStatus, error: string): string {
	if (status === "failed" && /\b409\b|not finished/i.test(error)) return "This run saved no result.";
	return plainCause(hideInternals(error));
}

/** The line when a failed run explains nothing at all. */
export const NO_REASON = "It failed without saying why.";

// ── the row ───────────────────────────────────────────────────────────────

/** A run's main label: its name, else what and where it ran. */
export function runLabel(job: Pick<FleetJob, "name" | "kind" | "site">): string {
	const name = job.name?.trim();
	if (name) return name;
	return `${job.kind === "ll" ? "Lumilake" : "FlowMesh"} compute graph on ${job.site || "an unknown site"}`;
}

const STATUS_WORDS: Record<FleetStatus, string> = {
	queued: "Waiting",
	running: "Running",
	succeeded: "Done",
	failed: "Failed",
	canceled: "Canceled",
};

/** The status in words: Waiting · Running · Done · Failed · Canceled. */
export function fleetStatusWord(s: FleetStatus): string {
	return STATUS_WORDS[s] ?? "Unknown";
}

/** The row's open-the-result button: "Why it failed" for a failed run, else "Result". */
export function resultButtonLabel(s: FleetStatus, open: boolean): string {
	if (open) return "Hide";
	return s === "failed" ? "Why it failed" : "Result";
}

/** "Showing your latest 100 runs" when the list hit the cap — identity's list has no older page. */
export function latestRunsNote(count: number, limit: number): string | null {
	return count >= limit ? `Showing your latest ${limit} runs` : null;
}

// ── pictures ──────────────────────────────────────────────────────────────

export interface PicturesContext {
	model?: string;
	prompt?: string;
}

/** The model and prompt behind a run's pictures, when its result names them. */
export function picturesContext(outputs: unknown): PicturesContext | null {
	if (!Array.isArray(outputs)) return null;
	for (const s of outputs) {
		const r = asRecord(asRecord(s)?.result);
		if (!r || !Array.isArray(r.images) || r.images.length === 0) continue;
		const ctx: PicturesContext = {};
		if (typeof r.model === "string" && r.model.trim()) ctx.model = hideInternals(r.model.trim());
		const prompts = Array.isArray(r.prompts) ? r.prompts.filter((p): p is string => typeof p === "string" && !!p.trim()) : [];
		const prompt = typeof r.prompt === "string" && r.prompt.trim() ? r.prompt.trim() : prompts.join(" · ");
		if (prompt) ctx.prompt = hideInternals(prompt);
		return ctx.model || ctx.prompt ? ctx : null;
	}
	return null;
}

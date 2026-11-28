// modules — an app's compute modules, in words (round 10, 2026-11-28).
//
// An app declares small CPU-only compute in its spec (`modules:`), and lum.id's
// central measurement service runs it under hard limits, AS THE CALLER, with
// content-keyed reuse (identity internal/handler/me_measure_module.go; the
// contract: public/docs/xpio_autoresearch_canonical.md → "Modules"):
//
//   modules:
//   - id: trace_stats
//     title: Trace statistics
//     image: ghcr.io/<org>/<repo>@sha256:<64 hex>   # pinned; a tag alone is refused
//     run: python -m pkg.job                       # ONE JSON object on stdin → ONE on stdout
//     inputs: {trace: "words"}
//     limits: {cpu: 1, memory: 2Gi, timeout_s: 120} # clamped: cpu ≤ 2, 64Mi ≤ memory ≤ 4Gi, timeout ≤ 600
//     share: you | everyone
//     public: false
//
// Everything here is pure and tested (modules.test.ts):
//   · reading the modules out of a spec, and the listing identity serves;
//   · identity's save-time rules, mirrored IN ITS WORDS (`moduleProblem`,
//     `specModulesProblem`) so the form says what the save would say;
//   · limits / share / public in plain words;
//   · the spec edits — add, update, remove (refused while a workflow uses it),
//     and "use in a workflow" — built on lib/app-spec's comment-preserving
//     document helpers and saved through useAppGraph's `save` (base_sha);
//   · the Try-it input check and the measure reply → what to say, incl. the
//     poll loop (`runModuleOnce`, with an injected clock so it is testable).

import { isMap, isSeq, parse, type YAMLMap, type YAMLSeq } from "yaml";
import { addWorkflows, nodeIdFrom, specDocument, specSeqAt } from "@/lib/app-spec";
import { deviceWords, usageOf, usageWords, type Spend, type Usage } from "@/lib/spend";
import { saveErrorWords } from "@/lib/variant-form";

// ── identity's limits (me_measure_module.go) ─────────────────────────────

export const MODULE_MAX_CPU = 2;
export const MODULE_MAX_MEMORY_MI = 4096;
export const MODULE_MIN_MEMORY_MI = 64;
export const MODULE_MAX_TIMEOUT_S = 600;
export const MODULE_DEFAULTS = { cpu: 1, memoryMi: 1024, timeoutS: 120 } as const;
/** POST /me/measure refuses inputs over this (measureMaxInputBytes). */
export const MODULE_MAX_INPUT_BYTES = 256 << 10;

export const MODULE_ID_RE = /^[a-z][a-z0-9_-]{0,47}$/;
export const MODULE_IMAGE_RE = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/;
const MEMORY_RE = /^\s*([0-9]+)\s*([KkMmGgTt][Ii]?[Bb]?)?\s*$/;

export interface ModuleLimits { cpu: number; memoryMi: number; timeoutS: number }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (v == null ? "" : String(v));
/** Go's %q, near enough: a double-quoted string. */
const q = (v: string) => JSON.stringify(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "2Gi", "512Mi", "1G" (binary units) or a bare byte count, in MiB rounded up. */
export function parseMemoryMi(v: unknown): { mi?: number; problem?: string } {
	let bytes: number;
	if (isNum(v)) bytes = v;
	else if (typeof v === "string") {
		const m = MEMORY_RE.exec(v);
		if (!m) return { problem: `limits.memory ${q(v)} is not a size (write e.g. 512Mi or 2Gi)` };
		const unit = (m[2] ?? "").toLowerCase()[0] ?? "";
		const mult = unit === "k" ? 2 ** 10 : unit === "m" ? 2 ** 20 : unit === "g" ? 2 ** 30 : unit === "t" ? 2 ** 40 : 1;
		bytes = Number(m[1]) * mult;
	} else return { problem: "limits.memory must be a size like 2Gi" };
	if (bytes <= 0) return { problem: "limits.memory must be more than zero" };
	return { mi: Math.ceil(bytes / 2 ** 20) };
}

/** identity's clampModuleLimits: defaults, ceilings (said in `notes`), refusals. */
export function clampLimits(raw: Obj): { limits: ModuleLimits; notes: string[]; problem?: string } {
	const l: ModuleLimits = { cpu: MODULE_DEFAULTS.cpu, memoryMi: MODULE_DEFAULTS.memoryMi, timeoutS: MODULE_DEFAULTS.timeoutS };
	const notes: string[] = [];
	if ("cpu" in raw) {
		const v = raw.cpu;
		if (!isNum(v) || v <= 0) return { limits: l, notes: [], problem: "limits.cpu must be a positive number of cores" };
		l.cpu = Math.ceil(v);
		if (l.cpu > MODULE_MAX_CPU) { notes.push(`asked for ${v} CPUs; a module gets at most ${MODULE_MAX_CPU}`); l.cpu = MODULE_MAX_CPU; }
	}
	if ("memory" in raw) {
		const v = raw.memory;
		const m = parseMemoryMi(v);
		if (m.problem) return { limits: l, notes: [], problem: m.problem };
		let mi = m.mi!;
		if (mi > MODULE_MAX_MEMORY_MI) { notes.push(`asked for ${str(v)} memory; a module gets at most 4Gi`); mi = MODULE_MAX_MEMORY_MI; }
		l.memoryMi = Math.max(mi, MODULE_MIN_MEMORY_MI);
	}
	if ("timeout_s" in raw) {
		const v = raw.timeout_s;
		if (!isNum(v) || v <= 0) return { limits: l, notes: [], problem: "limits.timeout_s must be a positive number of seconds" };
		l.timeoutS = Math.ceil(v);
		if (l.timeoutS > MODULE_MAX_TIMEOUT_S) { notes.push(`asked for ${v} s; a module runs at most ${MODULE_MAX_TIMEOUT_S} s`); l.timeoutS = MODULE_MAX_TIMEOUT_S; }
	}
	for (const k of Object.keys(raw)) {
		if (k !== "cpu" && k !== "memory" && k !== "timeout_s") {
			return { limits: l, notes: [], problem: `limits.${k} is not a module limit (cpu, memory, timeout_s; modules never get a GPU)` };
		}
	}
	return { limits: l, notes };
}

/** One module as identity reads it once valid. */
export interface CheckedModule {
	id: string; title: string; about: string; image: string; run: string;
	inputs: Record<string, string>; limits: ModuleLimits; share: "you" | "everyone"; public: boolean; notes: string[];
}

/** identity's parseModuleEntry: the module, or the first problem in its words. */
export function checkModule(e: Obj): { module?: CheckedModule; problem?: string } {
	const id = str(e.id).trim();
	if (!MODULE_ID_RE.test(id)) return { problem: `module ${q(id)}: id must be a short slug (lowercase letters, digits, _ or -)` };
	const image = str(e.image).trim();
	const run = str(e.run).trim();
	const share = str(e.share).trim();
	if (!image) return { problem: `module ${id}: image is required, pinned by digest (…@sha256:<64 hex>)` };
	if (!MODULE_IMAGE_RE.test(image)) {
		return { problem: `module ${id}: image ${q(image)} is not pinned by digest; write it as <repo>@sha256:<64 hex> (a tag can change under everyone who reuses its results)` };
	}
	if (!run) return { problem: `module ${id}: run is required (the command that reads ONE JSON object on stdin and writes ONE on stdout)` };
	if (run.length > 512 || /[\n\r\0]/.test(run)) return { problem: `module ${id}: run must be one command line of at most 512 characters` };
	if (share !== "" && share !== "you" && share !== "everyone") return { problem: `module ${id}: share is everyone or you, not ${q(share)}` };
	let pub = false;
	if (e.public != null) {
		if (typeof e.public !== "boolean") return { problem: `module ${id}: public is true or false` };
		pub = e.public;
	}
	const inputs: Record<string, string> = {};
	if (e.inputs != null) {
		if (!isObj(e.inputs)) return { problem: `module ${id}: inputs is a mapping of input name to words` };
		for (const [k, v] of Object.entries(e.inputs)) inputs[k] = str(v);
	}
	let raw: Obj = {};
	if (e.limits != null) {
		if (!isObj(e.limits)) return { problem: `module ${id}: limits is a mapping {cpu, memory, timeout_s}` };
		raw = e.limits;
	}
	const c = clampLimits(raw);
	if (c.problem) return { problem: `module ${id}: ${c.problem}` };
	return {
		module: { id, title: str(e.title), about: str(e.about), image, run, inputs, limits: c.limits, share: share === "everyone" ? "everyone" : "you", public: pub, notes: c.notes },
	};
}

/** The spec's `modules:` entries, as written (non-mappings kept as null). */
export function specModuleEntries(text: string): Array<Obj | null> {
	const d = specJS(text);
	return Array.isArray(d.modules) ? d.modules.map((e) => (isObj(e) ? e : null)) : [];
}

function specJS(text: string): Obj {
	try { return obj(parse(text || "")); } catch { return {}; }
}

/** A workflow of this app whose whole step is a module. */
export interface ModuleUse { workflow: string; title: string; module: string }

/** Every workflow (or older loop) whose `steps.module` names a module. */
export function moduleUses(text: string): ModuleUse[] {
	const d = specJS(text);
	const out: ModuleUse[] = [];
	for (const key of ["workflows", "loops"]) {
		for (const w of Array.isArray(d[key]) ? (d[key] as unknown[]) : []) {
			const wm = obj(w);
			const steps = obj(wm.steps);
			if (!("module" in steps)) continue;
			const id = str(wm.id) || str(wm.name);
			out.push({ workflow: id, title: str(wm.title) || id, module: str(steps.module).trim() });
		}
	}
	return out;
}

/**
 * identity's specModulesError: every module valid, ids unique, every
 * workflow's steps.module naming a declared one (owner-qualified names are
 * resolved at run time). null = the save would pass this check.
 */
export function specModulesProblem(text: string): string | null {
	const d = specJS(text);
	if (d.modules != null && !Array.isArray(d.modules)) return "modules must be a list";
	const ids = new Set<string>();
	const entries = specModuleEntries(text);
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (!e) return `modules[${i}] must be a mapping`;
		const c = checkModule(e);
		if (c.problem) return c.problem;
		if (ids.has(c.module!.id)) return `module ${c.module!.id} is declared twice`;
		ids.add(c.module!.id);
	}
	for (const key of ["workflows", "loops"]) {
		for (const w of Array.isArray(d[key]) ? (d[key] as unknown[]) : []) {
			const wm = obj(w);
			const steps = obj(wm.steps);
			if (!("module" in steps)) continue;
			const wid = str(wm.id) || str(wm.name);
			const mod = str(steps.module).trim();
			if (mod.includes("/")) continue;
			if (!ids.has(mod)) return `workflow ${q(wid)}: steps.module ${q(mod)} is not a module of this app`;
			for (const other of ["python", "dag", "skills", "workflows"]) {
				if (other in steps) return `workflow ${q(wid)}: steps.module cannot be combined with steps.${other}`;
			}
			if (steps.inputs != null && !isObj(steps.inputs)) return `workflow ${q(wid)}: steps.inputs is a mapping`;
		}
	}
	return null;
}

/** identity's words with its key names said plainly — for the screen. A save
 *  refusal from the server is shown verbatim instead. */
export function plainModuleWords(s: string): string {
	return s
		.replace(/\(cpu, memory, timeout_s; modules never get a GPU\)/g, "(CPU, memory and time limit; modules never get a GPU)")
		.replace(/\{cpu, memory, timeout_s\}/g, "of CPU, memory and time limit")
		.replace(/\blimits\.timeout_s\b/g, "The time limit")
		.replace(/\blimits\.cpu\b/g, "The CPU limit")
		.replace(/\blimits\.memory\b/g, "The memory limit")
		.replace(/\blimits\.(\w+) is not a module limit/g, (_m, k: string) => `"${k}" is not a module limit`)
		.replace(/\bsteps\.module\b/g, "its module step")
		.replace(/\bsteps\.inputs\b/g, "its step inputs")
		.replace(/\bsteps\.(python|dag|skills|workflows)\b/g, (_m, k: string) => ({ python: "a Python step", dag: "a compute graph", skills: "skills", workflows: "a chain of workflows" })[k] ?? k)
		.replace(/^module ("?)([a-z][a-z0-9_-]*)\1: /, "")
		.replace(/: The /g, ": the ")
		.replace(/^[a-z]/, (c) => c.toUpperCase());
}

/** The save button's line while the form still has problems (each is shown at its field). */
export function fixCountWords(n: number): string {
	return n === 1 ? "One thing to fix above before it can be saved." : `${n} things to fix above before it can be saved.`;
}

// ── words ────────────────────────────────────────────────────────────────

const round1 = (x: number) => Math.round(x * 10) / 10;

export function memoryWords(mi: number): string {
	if (mi >= 1024) return `${round1(mi / 1024)} GiB`;
	return `${mi} MiB`;
}

export function durationWords(s: number): string {
	if (s < 60) return `${s} s`;
	return `${round1(s / 60)} min`;
}

/** "1 CPU · 2 GiB · stops after 2 min" */
export function limitsWords(l: ModuleLimits): string {
	return `${l.cpu} ${l.cpu === 1 ? "CPU" : "CPUs"} · ${memoryWords(l.memoryMi)} · stops after ${durationWords(l.timeoutS)}`;
}

/** A clamp note as a sentence: "It asks for 8 CPUs; a module gets at most 2." */
export function clampNoteWords(note: string): string {
	const t = note.replace(/^asked for/i, "It asks for");
	return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
}

/** What else the platform guarantees, said once. */
export const GUARANTEE_WORDS = "No GPU, no network; inputs up to 256 KiB, output up to 1 MiB.";

/** `share` from the spec ("you" | "everyone") or the listing ("tenant" | "global"). */
export function shareWords(share: string | undefined): string {
	return share === "everyone" || share === "global"
		? "Identical inputs are computed once; the result is reused for everyone."
		: "Identical inputs are computed once; the result is reused only by whoever ran it.";
}

export function publicWords(pub: boolean | undefined, app: string): string {
	return pub
		? "Public: any lum.id user's app can use it — it runs as them, on their budget."
		: `Only ${app} can use it.`;
}

/** An input name for the screen: "short_max_tokens" → "Short max tokens". */
export function inputLabel(name: string): string {
	const s = name.replace(/[_-]+/g, " ").trim();
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

/** "ghcr.io/org/repo@sha256:…" → { repo, digest: the first 12 hex }. */
export function imageParts(image: string): { repo: string; digest: string } {
	const at = image.indexOf("@");
	if (at < 0) return { repo: image, digest: "" };
	const hex = image.slice(at + 1).replace(/^sha256:/, "");
	return { repo: image.slice(0, at), digest: hex.slice(0, 12) };
}

/** The command that prints an image's digest — with the reader's own image
 *  when they typed a tag, else the placeholder. */
export function digestCommand(image: string): string {
	const s = image.trim();
	if (s && !s.includes("@") && /^[a-z0-9][a-z0-9._/-]*(:[\w.-]+)?$/.test(s)) {
		return `docker buildx imagetools inspect ${s.includes(":", s.lastIndexOf("/") + 1) ? s : `${s}:latest`}`;
	}
	return "docker buildx imagetools inspect <image>:<tag>";
}

/** What a module usually uses, from identity's estimate. */
export function estimateWords(e: { from_runs?: number; cpu_s?: number } | undefined): string | null {
	if (!e || !e.from_runs || !e.cpu_s || e.cpu_s <= 0) return null;
	const s: Pick<Spend, "gpu_s" | "cpu_s" | "gpu_by_type"> = { gpu_s: 0, cpu_s: e.cpu_s, gpu_by_type: {} };
	return `Usually about ${deviceWords(s)} a run (from ${e.from_runs} ${e.from_runs === 1 ? "run" : "runs"})`;
}

/** A module id from a title: a slug identity accepts, unique among `taken`. */
export function moduleIdFrom(title: string, taken: Iterable<string>): string {
	let base = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
	if (!base) base = "module";
	if (!/^[a-z]/.test(base)) base = `m_${base}`.slice(0, 40);
	const used = new Set(taken);
	let id = base, i = 2;
	while (used.has(id)) id = `${base}_${i++}`;
	return id;
}

// ── the listing: GET /me/measure/instruments?app=<app>[&public=1] ───────────

export interface ModuleListItem {
	name: string;
	kind: string;
	title?: string;
	about?: string;
	inputs?: Record<string, string>;
	/** "tenant" | "global" */
	share?: string;
	public?: boolean;
	image?: string;
	digest?: string;
	run?: string;
	limits?: { cpu?: number; memory?: string; timeout_s?: number };
	notes?: string[];
	/** Why identity won't run it, in its words (only `name` and this are set). */
	refused?: string;
	/** Set on another owner's public module. */
	owner?: string;
	app?: string;
	app_title?: string;
	estimate?: { from_runs?: number; cpu_s?: number; cost_usd?: number };
}

export interface PublicModulesStatus {
	count?: number; ttl_s?: number; built_at?: string; age_s?: number;
	stale?: boolean; refresh_error?: string; note?: string;
	unreadable_apps?: number; truncated?: boolean; shadowed?: number;
}

export interface ModuleListing { instruments: ModuleListItem[]; public_modules?: PublicModulesStatus }

function listedLimits(l: ModuleListItem["limits"]): ModuleLimits | null {
	if (!l || !isNum(l.cpu) || !isNum(l.timeout_s)) return null;
	const mi = parseMemoryMi(l.memory ?? "").mi;
	return mi ? { cpu: l.cpu, memoryMi: mi, timeoutS: l.timeout_s } : null;
}

/** One of the app's own modules, ready to show. */
export interface ModuleRow {
	/** The spec id ("" when the entry has none). */
	id: string;
	/** Position in `modules:` (-1: only in the listing). */
	index: number;
	/** The instrument name: "<app>.<id>". */
	name: string;
	title: string;
	about: string;
	image: string;
	repo: string;
	digest: string;
	limits: ModuleLimits | null;
	limitsText: string;
	notes: string[];
	share: "you" | "everyone";
	public: boolean;
	inputs: Array<{ name: string; label: string; words: string }>;
	/** Why it can't run, in plain words. */
	refused?: string;
	usedBy: ModuleUse[];
	estimate?: string;
}

const inputRows = (inputs: Record<string, string> | undefined) =>
	Object.entries(inputs ?? {}).map(([name, words]) => ({ name, label: inputLabel(name), words: str(words) }));

/**
 * The app's own modules: the spec's entries (so every one can be edited, the
 * refused ones too), checked with identity's rules, with the listing's word
 * winning where it has one (its refusal, its usual usage). A module only the
 * listing knows (the spec couldn't be read) is still shown.
 */
export function moduleRows(app: string, specText: string, listing?: ModuleListItem[] | null): ModuleRow[] {
	const listed = new Map<string, ModuleListItem>();
	for (const it of listing ?? []) if (it.kind === "module" && !it.owner && it.name.startsWith(`${app}.`)) listed.set(it.name.slice(app.length + 1), it);
	const uses = moduleUses(specText);
	const rows: ModuleRow[] = [];
	const seen = new Set<string>();
	specModuleEntries(specText).forEach((e, index) => {
		const raw = e ?? {};
		const id = str(raw.id).trim();
		const key = id || `#${index + 1}`;
		seen.add(key);
		const c = e ? checkModule(e) : { problem: `modules[${index}] must be a mapping` };
		const li = listed.get(key);
		const m = c.module;
		const image = m?.image ?? str(raw.image).trim();
		const { repo, digest } = imageParts(image);
		const limits = m?.limits ?? listedLimits(li?.limits);
		const refused = li?.refused ?? c.problem;
		rows.push({
			id, index, name: `${app}.${key}`,
			title: str(raw.title) || id || `Module ${index + 1}`,
			about: str(raw.about),
			image, repo, digest, limits,
			limitsText: limits ? limitsWords(limits) : "",
			notes: (m?.notes ?? li?.notes ?? []).map(plainModuleWords),
			share: m?.share ?? (str(raw.share) === "everyone" ? "everyone" : "you"),
			public: m?.public ?? raw.public === true,
			inputs: inputRows(m?.inputs ?? (isObj(raw.inputs) ? (raw.inputs as Record<string, string>) : {})),
			...(refused ? { refused: plainModuleWords(refused) } : {}),
			usedBy: id ? uses.filter((u) => u.module === id) : [],
			...(estimateWords(li?.estimate) ? { estimate: estimateWords(li?.estimate)! } : {}),
		});
	});
	// The spec is the source: the listing's own rows only stand in when the
	// spec couldn't be read (a just-removed module must not linger from it).
	if (specText.trim()) return rows;
	for (const [key, li] of listed) {
		if (seen.has(key)) continue;
		const limits = listedLimits(li.limits);
		const { repo, digest } = imageParts(li.image ?? "");
		rows.push({
			id: key.startsWith("#") ? "" : key, index: -1, name: li.name, title: li.title || key, about: li.about ?? "",
			image: li.image ?? "", repo, digest, limits, limitsText: limits ? limitsWords(limits) : "",
			notes: (li.notes ?? []).map(plainModuleWords), share: li.share === "global" ? "everyone" : "you", public: !!li.public,
			inputs: inputRows(li.inputs), ...(li.refused ? { refused: plainModuleWords(li.refused) } : {}), usedBy: [],
			...(estimateWords(li.estimate) ? { estimate: estimateWords(li.estimate)! } : {}),
		});
	}
	return rows;
}

/** A public module of another owner's published app. */
export interface PublicModuleRow {
	name: string; title: string; about: string;
	/** The app it comes from, by its title. */
	by: string;
	/** The publisher's account id (an id, not a name: admins only). */
	owner: string;
	limitsText: string; share: "you" | "everyone"; inputs: ModuleRow["inputs"]; estimate?: string;
}

export function publicModuleRows(listing?: ModuleListItem[] | null): PublicModuleRow[] {
	return (listing ?? [])
		.filter((it) => it.kind === "module" && it.public && !!it.owner && !it.refused)
		.map((it) => {
			const limits = listedLimits(it.limits);
			const id = it.name.slice(it.name.lastIndexOf(".") + 1);
			return {
				name: it.name, title: it.title || inputLabel(id), about: it.about ?? "",
				by: it.app_title || inputLabel(it.app ?? ""), owner: it.owner ?? "",
				limitsText: limits ? limitsWords(limits) : "", share: it.share === "global" ? "everyone" : "you",
				inputs: inputRows(it.inputs), ...(estimateWords(it.estimate) ? { estimate: estimateWords(it.estimate)! } : {}),
			};
		});
}

const agoWords = (s: number) => (s < 90 ? "a minute ago" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${round1(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`);

/** The public list's state, when it is worth a line (null = fresh). */
export function publicStatusWords(st: PublicModulesStatus | undefined | null): string | null {
	if (!st) return null;
	if (st.stale) {
		return st.built_at
			? `Couldn't refresh the list of public modules just now, so this is the list from ${agoWords(st.age_s ?? 0)}.`
			: "Couldn't load the list of public modules right now. A public module whose name you know can still be used.";
	}
	if (!st.built_at && st.note) return "The list of public modules is still being gathered — look again in a few seconds.";
	if (st.truncated) return "Only the first public modules are listed; there are more.";
	return null;
}

// ── the register / edit form ─────────────────────────────────────────────

export interface ModuleForm {
	id: string; title: string; about: string; image: string; run: string;
	inputs: Array<{ name: string; words: string }>;
	cpu: string; memory: string; memoryUnit: "Mi" | "Gi"; timeout: string;
	share: "you" | "everyone"; public: boolean;
}

export function blankModuleForm(): ModuleForm {
	return {
		id: "", title: "", about: "", image: "", run: "", inputs: [{ name: "", words: "" }],
		cpu: String(MODULE_DEFAULTS.cpu), memory: "1", memoryUnit: "Gi", timeout: String(MODULE_DEFAULTS.timeoutS),
		share: "you", public: false,
	};
}

/** The form for an existing entry (raw, as written — not clamped). */
export function formFromEntry(e: Obj): ModuleForm {
	const lim = obj(e.limits);
	const mi = "memory" in lim ? parseMemoryMi(lim.memory).mi : MODULE_DEFAULTS.memoryMi;
	const gi = mi != null && mi % 1024 === 0;
	return {
		id: str(e.id), title: str(e.title), about: str(e.about), image: str(e.image), run: str(e.run),
		inputs: Object.entries(obj(e.inputs)).map(([name, words]) => ({ name, words: str(words) })),
		cpu: "cpu" in lim ? str(lim.cpu) : String(MODULE_DEFAULTS.cpu),
		memory: mi == null ? str(lim.memory) : gi ? String(mi / 1024) : String(mi),
		memoryUnit: gi ? "Gi" : "Mi",
		timeout: "timeout_s" in lim ? str(lim.timeout_s) : String(MODULE_DEFAULTS.timeoutS),
		share: str(e.share) === "everyone" ? "everyone" : "you",
		public: e.public === true,
	};
}

const numOrRaw = (s: string): unknown => {
	const t = s.trim();
	return t !== "" && Number.isFinite(Number(t)) ? Number(t) : t;
};

/** The spec entry a form writes (keys in the contract's order). */
export function entryFromForm(f: ModuleForm): Obj {
	const e: Obj = { id: f.id.trim() };
	if (f.title.trim()) e.title = f.title.trim();
	if (f.about.trim()) e.about = f.about.trim();
	e.image = f.image.trim();
	e.run = f.run.trim();
	const inputs: Record<string, string> = {};
	for (const r of f.inputs) if (r.name.trim()) inputs[r.name.trim()] = r.words.trim();
	if (Object.keys(inputs).length) e.inputs = inputs;
	const limits: Obj = {};
	if (f.cpu.trim()) limits.cpu = numOrRaw(f.cpu);
	if (f.memory.trim()) {
		const t = f.memory.trim();
		limits.memory = /^[0-9]+$/.test(t) ? `${t}${f.memoryUnit}` : t;
	}
	if (f.timeout.trim()) limits.timeout_s = numOrRaw(f.timeout);
	if (Object.keys(limits).length) e.limits = limits;
	e.share = f.share;
	e.public = f.public;
	return e;
}

/** Problems the form can name before saving, field by field, in identity's words. */
export function formProblems(f: ModuleForm, takenIds: Iterable<string>): { field: keyof ModuleForm | "limits"; words: string }[] {
	const out: { field: keyof ModuleForm | "limits"; words: string }[] = [];
	const taken = new Set(takenIds);
	const id = f.id.trim();
	if (id && taken.has(id)) out.push({ field: "id", words: `There is already a module called "${id}" in this app.` });
	const names = f.inputs.map((r) => r.name.trim()).filter(Boolean);
	const dup = names.find((n, i) => names.indexOf(n) !== i);
	if (dup) out.push({ field: "inputs", words: `Two inputs are both called "${dup}".` });
	const c = checkModule(entryFromForm(f));
	if (c.problem) {
		const p = c.problem;
		const field: keyof ModuleForm | "limits" = /: id must/.test(p) ? "id" : /: image /.test(p) ? "image" : /: run /.test(p) ? "run" : /: share /.test(p) ? "share" : /: inputs /.test(p) ? "inputs" : /limits/.test(p) ? "limits" : "id";
		out.push({ field, words: plainModuleWords(p) });
	}
	return out;
}

/** The limits as they will be applied, while typing: words + what got clamped. */
export function limitsPreview(f: Pick<ModuleForm, "cpu" | "memory" | "memoryUnit" | "timeout">): { words: string; notes: string[]; problem?: string } {
	const raw = obj(entryFromForm({ ...blankModuleForm(), ...f, id: "x", image: "", run: "" }).limits);
	const c = clampLimits(raw);
	if (c.problem) return { words: "", notes: [], problem: plainModuleWords(c.problem) };
	const notes = [...c.notes.map(plainModuleWords)];
	const cpu = Number(f.cpu);
	if (Number.isFinite(cpu) && cpu > 0 && cpu !== Math.ceil(cpu) && Math.ceil(cpu) <= MODULE_MAX_CPU) notes.push(`a part of a CPU counts as a whole one: ${Math.ceil(cpu)}`);
	const mi = parseMemoryMi(raw.memory ?? "").mi;
	if (mi != null && mi < MODULE_MIN_MEMORY_MI) notes.push(`a module gets at least ${MODULE_MIN_MEMORY_MI} MiB`);
	return { words: limitsWords(c.limits), notes };
}

// ── spec edits (text → text, comments kept; saved with base_sha) ──────────

export interface ModuleRef { id: string; index: number }

function modulesSeq(d: ReturnType<typeof specDocument>): YAMLSeq | null {
	const seq = d.get("modules", true);
	return isSeq(seq) ? (seq as YAMLSeq) : null;
}

function findModuleAt(seq: YAMLSeq, ref: ModuleRef): number {
	if (ref.id) {
		const i = seq.items.findIndex((it) => isMap(it) && str((it as YAMLMap).get("id")).trim() === ref.id);
		if (i >= 0) return i;
	}
	const at = seq.items[ref.index];
	if (ref.index >= 0 && at !== undefined && (!ref.id || (isMap(at) && str((at as YAMLMap).get("id")).trim() === ref.id))) return ref.index;
	return -1;
}

/** Refuse an edit the save would refuse. A problem in ANOTHER module than
 *  the one edited (identity checks the whole list on every save) names it. */
function guarded(next: string, target?: string): string {
	const p = specModulesProblem(next);
	if (!p) return next;
	const other = /^module "?([a-z][a-z0-9_-]*)"?:? /.exec(p)?.[1];
	if (other && other !== target) {
		throw new Error(`Module ${other} can't run: ${plainModuleWords(p).replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase())}. lum.id won't save this app's spec until that module is fixed or removed.`.replace(/\.\. lum/, ". lum"));
	}
	throw new Error(plainModuleWords(p));
}

/** Add a module (refused, in identity's words, when the save would be). */
export function addModule(text: string, entry: Obj): string {
	const ids = specModuleEntries(text).map((e) => str(e?.id).trim());
	const id = str(entry.id).trim();
	if (ids.includes(id)) throw new Error(`There is already a module called "${id}" in this app.`);
	const d = specDocument(text);
	specSeqAt(d, "modules").add(d.createNode(entry));
	return guarded(String(d), id);
}

const usedWords = (uses: ModuleUse[]) =>
	uses.length === 1 ? `the workflow "${uses[0].title}" still uses it` : `the workflows ${uses.map((u) => `"${u.title}"`).join(", ")} still use it`;

/**
 * Replace a module's entry in place: keys keep their position and comments; a
 * key the form leaves empty is removed. Changing the id is refused while a
 * workflow uses the old one (the workflow would stop working).
 */
export function updateModule(text: string, ref: ModuleRef, entry: Obj): string {
	const newId = str(entry.id).trim();
	if (ref.id && newId !== ref.id) {
		const uses = moduleUses(text).filter((u) => u.module === ref.id);
		if (uses.length) throw new Error(`Can't change the id from "${ref.id}": ${usedWords(uses)}. Keep the id, or change ${uses.length === 1 ? "that workflow" : "those workflows"} first.`);
		if (specModuleEntries(text).some((e) => str(e?.id).trim() === newId)) throw new Error(`There is already a module called "${newId}" in this app.`);
	}
	const d = specDocument(text);
	const seq = modulesSeq(d);
	const i = seq ? findModuleAt(seq, ref) : -1;
	if (!seq || i < 0) throw new Error(`There is no module "${ref.id || ref.index + 1}" in this app's spec any more — reload and try again.`);
	const it = seq.items[i];
	if (!isMap(it)) {
		seq.items[i] = d.createNode(entry);
		return guarded(String(d), newId);
	}
	const m = it as YAMLMap;
	for (const key of ["id", "title", "about", "image", "run", "inputs", "limits", "share", "public"]) {
		const v = entry[key];
		if (v === undefined) { m.delete(key); continue; }
		if (key === "limits" && isObj(v)) {
			const cur = m.get("limits", true);
			if (isMap(cur)) {
				const lm = cur as YAMLMap;
				for (const k of lm.items.map((p) => str((p.key as { value?: unknown })?.value ?? p.key))) if (!(k in v)) lm.delete(k);
				for (const [k, x] of Object.entries(v)) if (lm.get(k) !== x) lm.set(k, x);
				continue;
			}
		}
		if (key === "inputs" || key === "limits") {
			const was = obj(m.toJSON())[key];
			if (JSON.stringify(was) !== JSON.stringify(v)) m.set(key, d.createNode(v));
			continue;
		}
		if (m.get(key) !== v) m.set(key, v);
	}
	return guarded(String(d), newId);
}

/** Remove a module — refused, naming the workflow, while one still uses it. */
export function removeModule(text: string, ref: ModuleRef): string {
	const uses = ref.id ? moduleUses(text).filter((u) => u.module === ref.id) : [];
	if (uses.length) {
		const title = str(specModuleEntries(text).find((e) => str(e?.id).trim() === ref.id)?.title) || ref.id;
		throw new Error(`Can't remove "${title}": ${usedWords(uses)}. Remove ${uses.length === 1 ? "that workflow" : "those workflows"} or change ${uses.length === 1 ? "its" : "their"} step first.`);
	}
	const d = specDocument(text);
	const seq = modulesSeq(d);
	const i = seq ? findModuleAt(seq, ref) : -1;
	if (!seq || i < 0) throw new Error(`There is no module "${ref.id || ref.index + 1}" in this app's spec any more.`);
	seq.items.splice(i, 1);
	if (!seq.items.length) d.delete("modules");
	return guarded(String(d));
}

/** Why a module can't be removed now (null: it can). */
export function removeBlocker(text: string, id: string): string | null {
	try { removeModule(text, { id, index: -1 }); return null; } catch (e) {
		const msg = (e as Error).message;
		return /still use/.test(msg) ? msg : null;
	}
}

/** The step a workflow names: the bare id for this app's own module, the
 *  owner-qualified instrument name for another app's public one. */
export function stepModuleRef(app: string, instrument: string): string {
	return instrument.startsWith(`${app}.`) && !instrument.includes("/") ? instrument.slice(app.length + 1) : instrument;
}

/** A workflow id from a title (what addWorkflows accepts), unique. */
export function workflowIdFrom(title: string, taken: Iterable<string>): string {
	let id = nodeIdFrom(title, taken);
	if (!/^[a-z]/.test(id)) id = nodeIdFrom(`w ${title}`, taken);
	return id.slice(0, 48);
}

/**
 * "Use in a workflow": one new workflow whose whole step is the module —
 * `{id, title, run: manual, steps: {module, inputs}}`. Nothing starts on its
 * own (round 8): it runs when someone presses Run. Built by app-spec's
 * addWorkflows, then checked with identity's module rules.
 */
export function addModuleWorkflow(text: string, w: { id: string; title: string; module: string; inputs?: Record<string, unknown> }): string {
	const steps = { module: w.module, ...(w.inputs && Object.keys(w.inputs).length ? { inputs: w.inputs } : {}) };
	return guarded(addWorkflows(text, [{ id: w.id, title: w.title.trim() || undefined, steps }]));
}

// ── Try it once ──────────────────────────────────────────────────────────

/** A starting value for one input, from its words: "(default 1024)" → 1024,
 *  "rows of …" → [], "number of …" → 0, "whether …" → false, else "". */
export function inputGuess(words: string): unknown {
	const w = words.trim();
	const def = /\(?\bdefault(?:s to)?\s*:?\s*([^)\s,;]+)\)?/i.exec(w);
	if (def) {
		const v = def[1].replace(/^["']|["']$/g, "");
		if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
		if (v === "true" || v === "false") return v === "true";
		return v;
	}
	if (/^(rows|a list|list|an array|array|items|records)\b|\b(rows|list) of\b/i.test(w)) return [];
	if (/^(a |an )?(json )?(object|mapping|dict)\b/i.test(w) || /^\{/.test(w)) return {};
	if (/^(whether|true or false|if )\b/i.test(w)) return false;
	if (/^(a |the )?(number|count|how many|max|min|maximum|minimum|limit|size)\b/i.test(w)) return 0;
	return "";
}

/** The Try-it editor's starting text: one entry per declared input. */
export function inputTemplate(inputs: Record<string, string> | undefined): string {
	const o: Obj = {};
	for (const [k, words] of Object.entries(inputs ?? {})) o[k] = inputGuess(words);
	return JSON.stringify(o, null, 2);
}

/** Check the Try-it inputs: ONE JSON object, at most 256 KiB. `notes` are
 *  not problems (a module may default an input it isn't given). */
export function parseTryInputs(text: string, declared?: Record<string, string>): { value?: Obj; problem?: string; notes: string[] } {
	const t = text.trim();
	if (!t) return { problem: "Write the inputs as one JSON object — {} when it takes none.", notes: [] };
	let v: unknown;
	try { v = JSON.parse(t); } catch (e) {
		return { problem: `That isn't JSON yet: ${String((e as Error).message).replace(/^JSON\.parse: /, "").split("\n")[0]}`, notes: [] };
	}
	if (!isObj(v)) {
		const what = Array.isArray(v) ? "a list" : v === null ? "null" : typeof v === "string" ? "a string" : `a ${typeof v}`;
		return { problem: `The inputs must be ONE JSON object ({ … }), not ${what}.`, notes: [] };
	}
	const bytes = new TextEncoder().encode(JSON.stringify(v)).length;
	if (bytes > MODULE_MAX_INPUT_BYTES) {
		return { problem: `The inputs are ${Math.ceil(bytes / 1024)} KiB; a module takes at most 256 KiB — pass a dataset reference instead of the rows.`, notes: [] };
	}
	const notes: string[] = [];
	const names = Object.keys(declared ?? {});
	const missing = names.filter((n) => !(n in v));
	if (missing.length) notes.push(`Not given: ${missing.map(inputLabel).join(", ")} — the module may use its own default.`);
	const extra = declared ? Object.keys(v).filter((k) => !(k in declared)) : [];
	if (extra.length) notes.push(`Not ${extra.length === 1 ? "an input it declares" : "inputs it declares"}: ${extra.join(", ")} (sent anyway).`);
	return { value: v, notes };
}

/** POST /me/measure and GET /me/measure/:key answer with this. */
export interface MeasureReply {
	key?: string;
	instrument?: string;
	status: string;
	reason?: string;
	retry_after?: number;
	error?: string;
	usage?: Usage;
	budget?: boolean;
	executor_ref?: string;
	hits?: number;
	result?: { value?: unknown; reused?: boolean; share?: string; measured_at?: string; measured_on?: string; usage?: Usage };
}

export interface MeasureRequest { instrument: string; app: string; workflow?: string; inputs: Obj }

export type TryPhase =
	| { phase: "waiting"; words: string; retryS: number }
	| { phase: "running"; words: string; retryS: number; key: string }
	| { phase: "done"; output: unknown; reused: boolean; usage: string; tookWords: string; key?: string }
	| { phase: "failed"; words: string; usage?: string; key?: string }
	| { phase: "not_run"; words: string }
	| { phase: "slow"; words: string; key?: string };

const secs = (n: number) => Math.max(1, Math.round(n));

/** What a reply means, in words. `elapsedS`: since Run was pressed. */
export function tryPhase(r: MeasureReply, elapsedS: number, timeoutS?: number): TryPhase {
	const retryS = Math.min(30, Math.max(1, Number(r.retry_after) || 5));
	switch (r.status) {
		case "waiting":
			return { phase: "waiting", words: `Waiting for a free slot${r.reason ? `: ${r.reason}` : ""}. Asking again in ${retryS} s.`, retryS };
		case "queued":
		case "running": {
			const limit = timeoutS ? ` (it stops after ${durationWords(timeoutS)})` : "";
			const words = r.status === "queued"
				? `Waiting for a CPU on lum.id's fleet… ${durationWords(secs(elapsedS))} so far${limit}.`
				: `Running… ${durationWords(secs(elapsedS))} so far${limit}.`;
			return { phase: "running", words, retryS, key: r.key ?? "" };
		}
		case "succeeded": {
			const res = r.result ?? {};
			const u = usageOf(res.usage ?? null);
			const reused = !!res.reused || u?.metered === "reused";
			return {
				phase: "done", output: res.value, reused,
				usage: reused ? usageWords(u ?? { metered: "reused" }) : usageWords(u),
				tookWords: reused ? `Answered in ${durationWords(secs(elapsedS))} from an identical earlier run.` : `Took ${durationWords(secs(elapsedS))}.`,
				...(r.key ? { key: r.key } : {}),
			};
		}
		case "failed":
			return { phase: "failed", words: r.error?.trim() || "It failed without saying why.", ...(r.usage ? { usage: usageWords(usageOf(r.usage)) } : {}), ...(r.key ? { key: r.key } : {}) };
		case "not_measured":
			return { phase: "not_run", words: `It didn't run: ${r.reason?.trim() || "lum.id gave no reason"}.`.replace(/\.\.$/, ".") };
		default:
			return { phase: "failed", words: `lum.id answered "${r.status}", which this page doesn't know.` };
	}
}

/** A thrown request error, in words (identity's refusals are already words). */
export function tryErrorWords(e: unknown): string {
	const status = (e as { status?: number })?.status;
	const msg = e instanceof Error ? e.message : String(e ?? "");
	if (status === 429) return "Too many requests to lum.id just now — try again in a minute.";
	if (status === 401) return "You're signed out — sign in and try again.";
	if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Couldn't reach lum.id — try again in a moment.";
	if (status && status >= 500 && !msg) return `lum.id couldn't run it (HTTP ${status}).`;
	return msg ? msg.charAt(0).toUpperCase() + msg.slice(1) : "It couldn't run.";
}

export interface MeasureClient {
	measure: (body: MeasureRequest) => Promise<MeasureReply>;
	get: (key: string) => Promise<MeasureReply>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

/**
 * Run a module once and follow it to an answer: POST; while it runs, GET the
 * measurement every retry_after; while lum.id says "waiting" (nothing was
 * claimed yet), POST again after retry_after. Gives up following — not the
 * run — after the module's own limit plus a margin, and says the result is
 * kept (asking again with the same inputs answers it, free).
 */
export async function runModuleOnce(c: MeasureClient, body: MeasureRequest, onPhase: (p: TryPhase) => void, opts: { timeoutS?: number; cancelled?: () => boolean } = {}): Promise<TryPhase> {
	const t0 = c.now();
	const giveUpS = (opts.timeoutS ?? MODULE_DEFAULTS.timeoutS) + 180;
	const elapsed = () => (c.now() - t0) / 1000;
	let r: MeasureReply;
	try { r = await c.measure(body); } catch (e) { const p: TryPhase = { phase: "failed", words: tryErrorWords(e) }; onPhase(p); return p; }
	for (;;) {
		const p = tryPhase(r, elapsed(), opts.timeoutS);
		if (opts.cancelled?.()) return p;
		if (p.phase !== "waiting" && p.phase !== "running") { onPhase(p); return p; }
		if (elapsed() + p.retryS > giveUpS) {
			const slow: TryPhase = { phase: "slow", words: `Still not finished after ${durationWords(secs(elapsed()))}. It keeps going: press Run again with the same inputs later and it answers with this result, free.`, ...(p.phase === "running" && p.key ? { key: p.key } : {}) };
			onPhase(slow);
			return slow;
		}
		onPhase(p);
		await c.sleep(p.retryS * 1000);
		if (opts.cancelled?.()) return p;
		try {
			r = p.phase === "running" && p.key ? await c.get(p.key) : await c.measure(body);
		} catch (e) {
			const f: TryPhase = { phase: "failed", words: tryErrorWords(e) };
			onPhase(f);
			return f;
		}
	}
}

/** The module's output for the screen, clipped so a 1 MiB answer can't hang the page. */
export function outputText(v: unknown, max = 200_000): { text: string; clipped: boolean } {
	let s: string;
	try { s = JSON.stringify(v, null, 2) ?? "null"; } catch { s = String(v); }
	return s.length > max ? { text: s.slice(0, max), clipped: true } : { text: s, clipped: false };
}

/** What a press that writes the spec does, said on the button's line. */
export function savesWords(app: string, what: "module" | "workflow" | "remove"): string {
	if (what === "workflow") return `Saves a new workflow to ${app}'s spec. It runs only when you press Run.`;
	if (what === "remove") return `Removes it from ${app}'s spec; nothing runs.`;
	return `Saves to ${app}'s spec; nothing runs.`;
}

/**
 * Why a save didn't happen. `verbatim`: lum.id refused the spec — its words
 * are shown exactly as it said them. Otherwise the check here refused it
 * before sending (already plain words), or the request failed (in words).
 */
export function saveErrorText(e: unknown): { words: string; verbatim: boolean } {
	const status = (e as { status?: number })?.status;
	const msg = e instanceof Error ? e.message : String(e ?? "");
	if (typeof status === "number" && (status === 400 || status === 422 || (status === 0 && (e as { ret_code?: number }).ret_code === 1500)) && msg) return { words: msg, verbatim: true };
	if (status === undefined && msg) return { words: msg, verbatim: false };
	return { words: saveErrorWords(e), verbatim: false };
}

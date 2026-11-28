// version-form — the "Add versions" sheet as pure functions.
//
// A new version of an experiment starts as a copy of its first version: one
// field per setting, labelled in words (the same labels as the version panel's
// "What it changes"), the value pre-filled and editable. What the reader
// changes is marked against the first version; a version whose settings equal
// one already there is caught before it is added. The result goes through the
// same parseNewVersions → addVersions path as the YAML box (lib/app-spec).
//
// Values keep their YAML type: a number stays a number, a list stays a list,
// a nested object (a strategy spec's costs) is written back nested.

import { parse, stringify } from "yaml";
import { chainStages, type AppSpec, type NewVersion } from "./app-spec";
import { humanId, settingName } from "./research-map";

type Obj = Record<string, unknown>;

/** Fields of a version that describe it rather than set anything. */
export const VERSION_META = ["id", "description", "about", "title", "arm", "label"];

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** A version's settings: everything but its meta fields. A version written
 *  `{id, about, inputs: {...}}` and one served flat (`{id, spec: {...}}`)
 *  read the same. */
export function versionSettings(arm: Obj | undefined | null): Obj {
	const out: Obj = {};
	for (const [k, v] of Object.entries(arm || {})) {
		if (VERSION_META.includes(k)) continue;
		if (k === "inputs" && isObj(v)) Object.assign(out, v);
		else out[k] = v;
	}
	return out;
}

export type SettingKind = "number" | "text" | "yesno" | "list" | "json";

export interface SettingField {
	/** "spec.costs.bps" — stable React key and edit address. */
	key: string;
	path: string[];
	/** "Costs · half spread (bps)" */
	label: string;
	kind: SettingKind;
	/** The first version's value; undefined for a setting the reader added. */
	original: unknown;
	/** What the field shows before any edit. */
	initial: string | boolean;
	/** A long text gets a box, not a line. */
	long: boolean;
}

const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

function kindOf(v: unknown): SettingKind {
	if (typeof v === "number") return "number";
	if (typeof v === "boolean") return "yesno";
	if (typeof v === "string" || v === null || v === undefined) return "text";
	// A list edits as "a, b, c" only when every item is a plain value without a comma.
	if (Array.isArray(v) && v.every((x) => (typeof x === "number") || (typeof x === "string" && !x.includes(",")))) return "list";
	return "json";
}

/** A value as the reader reads it (and as a field shows it). */
export function showValue(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "boolean") return v ? "yes" : "no";
	if (Array.isArray(v) && kindOf(v) === "list") return v.join(", ");
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}

function labelOf(path: string[]): string {
	if (path.length === 1) return humanId(path[0]);
	return `${humanId(path[path.length - 2])} · ${settingName(path[path.length - 1])}`;
}

function field(path: string[], v: unknown): SettingField {
	const kind = kindOf(v);
	const initial = kind === "yesno" ? v === true : showValue(v);
	return { key: path.join("."), path, label: labelOf(path), kind, original: v, initial, long: typeof initial === "string" && initial.length > 60 };
}

/** One field per setting, nested objects flattened into their leaves
 *  (`spec: {costs: {bps}}` → "Costs · bps"). An empty object stays one field. */
export function settingFields(settings: Obj): SettingField[] {
	const out: SettingField[] = [];
	const walk = (path: string[], v: unknown) => {
		if (isObj(v) && Object.keys(v).length) for (const [k, v2] of Object.entries(v)) walk([...path, k], v2);
		else out.push(field(path, v));
	};
	for (const [k, v] of Object.entries(settings)) walk([k], v);
	return out;
}

/** A field for an input the first version doesn't set, starting from the
 *  workflow's default for it. */
export function addedField(name: string, fallback: unknown): SettingField {
	return { ...field([name], fallback), original: undefined };
}

/** The workflow's own value for each input a version can set (a chain: the
 *  first stage that declares it). */
export function inputDefaults(spec: AppSpec, wfId: string): Obj {
	const out: Obj = {};
	const wf = spec.workflows.find((w) => w.id === wfId);
	if (!wf) return out;
	const take = (inputs: Obj) => { for (const [k, v] of Object.entries(inputs)) if (!(k in out)) out[k] = v; };
	take(wf.inputs);
	for (const st of chainStages(wf.steps)) take(spec.workflows.find((w) => w.id === st.use)?.inputs ?? {});
	return out;
}

/** What the reader typed, back in the setting's type. */
export function readField(f: SettingField, edit: string | boolean): { value: unknown } | { problem: string } {
	if (f.kind === "yesno") return { value: edit === true };
	const t = String(edit);
	switch (f.kind) {
		case "number": {
			const n = Number(t.trim());
			return t.trim() && Number.isFinite(n) ? { value: n } : { problem: `${f.label}: write a number.` };
		}
		case "list": {
			const items = t.split(",").map((x) => x.trim()).filter(Boolean);
			const nums = Array.isArray(f.original) && f.original.length > 0 && f.original.every((x) => typeof x === "number");
			if (nums) {
				const vals = items.map(Number);
				return vals.every(Number.isFinite) ? { value: vals } : { problem: `${f.label}: write numbers, separated by commas.` };
			}
			return { value: items };
		}
		case "json": {
			try { return { value: parse(t) }; } catch { return { problem: `${f.label}: that isn't valid JSON or YAML.` }; }
		}
		default:
			return { value: f.original === null && !t.trim() ? null : t };
	}
}

/** Order-insensitive deep equality over YAML values. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
	}
	if (isObj(a) && isObj(b)) {
		const ka = Object.keys(a), kb = Object.keys(b);
		return ka.length === kb.length && ka.every((k) => k in b && sameValue(a[k], b[k]));
	}
	return false;
}

/** "changed from 2005-01-03", "added", or null when unchanged. */
export function changeWords(f: SettingField, value: unknown): string | null {
	if (f.original === undefined) return "added — the first version leaves it at the workflow's value";
	if (sameValue(value, f.original)) return null;
	const was = showValue(f.original);
	return was ? `changed from ${was.length > 48 ? `${was.slice(0, 47)}…` : was}` : "changed from empty";
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function setAt(o: Obj, path: string[], v: unknown) {
	let cur = o;
	for (const k of path.slice(0, -1)) {
		if (!isObj(cur[k])) cur[k] = {};
		cur = cur[k] as Obj;
	}
	cur[path[path.length - 1]] = v;
}

/** The form's settings, nested as the first version nests them, with every
 *  problem in words and the number of settings changed. */
export function buildSettings(base: Obj, fields: SettingField[], edits: Record<string, string | boolean>): { settings: Obj; problems: string[]; changed: number } {
	const settings = clone(base) as Obj;
	const problems: string[] = [];
	let changed = 0;
	for (const f of fields) {
		const r = readField(f, f.key in edits ? edits[f.key] : f.initial);
		if ("problem" in r) { problems.push(r.problem); continue; }
		if (changeWords(f, r.value)) changed++;
		setAt(settings, f.path, r.value);
	}
	return { settings, problems, changed };
}

/** A version id from its name: lower snake case, starts with a letter, at most
 *  48 characters, unique among `taken` (parseNewVersions' rule). */
export function versionIdFrom(name: string, taken: Iterable<string>): string {
	let base = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	if (base && !/^[a-z]/.test(base)) base = `v_${base}`;
	base = (base || "version").slice(0, 44).replace(/_+$/, "");
	const used = new Set(taken);
	let id = base, i = 2;
	while (used.has(id)) id = `${base}_${i++}`;
	return id;
}

export interface ExistingVersion { id: string; label: string; settings: Obj }

/** The version already there with exactly these settings, if any. */
export function sameSettingsAs(settings: Obj, existing: ExistingVersion[]): ExistingVersion | null {
	return existing.find((v) => sameValue(settings, v.settings)) ?? null;
}

export function sameSettingsWords(label: string): string {
	return `Same settings as ${label} — change something to make it a new try.`;
}

/** Problems for versions (from the form or the text box) that repeat a
 *  version already there, or each other. */
export function duplicateProblems(versions: NewVersion[], existing: ExistingVersion[]): string[] {
	const out: string[] = [];
	const seen: ExistingVersion[] = [...existing];
	for (const v of versions) {
		const hit = sameSettingsAs(v.inputs, seen);
		if (hit) out.push(versions.length > 1 ? `${humanId(v.id)}: ${sameSettingsWords(hit.label)}` : sameSettingsWords(hit.label));
		seen.push({ id: v.id, label: humanId(v.id), settings: v.inputs });
	}
	return out;
}

/** The form as one version, in the shape addVersions takes. */
export function formVersion(form: { id: string; name: string; about: string; settings: Obj }): NewVersion {
	return {
		id: form.id,
		...(form.name.trim() ? { title: form.name.trim() } : {}),
		...(form.about.trim() ? { about: form.about.trim() } : {}),
		inputs: form.settings,
	};
}

/** The form as text, for "Edit as text" (a list of one, ready for more). */
export function versionsYaml(versions: NewVersion[]): string {
	return stringify(versions.map((v) => ({ id: v.id, ...(v.title ? { title: v.title } : {}), ...(v.about ? { about: v.about } : {}), ...(Object.keys(v.inputs).length ? { inputs: v.inputs } : {}) })), { lineWidth: 0 });
}

/** "Starts from Baseline 12-1 momentum — one of 13 versions here." */
export function startsFromWords(firstLabel: string, count: number): string {
	if (count <= 1) return `Starts from ${firstLabel}, the only version so far. Change what this one should try differently.`;
	return `Starts from ${firstLabel} — one of ${count} versions here. Change what this one should try differently.`;
}

/** The first version's settings: the served one, else the spec's own (the
 *  YAML template), so the form has a real example either way. */
export function firstVersionSettings(arms: Obj[] | undefined, templateYaml: string): Obj {
	if (arms && arms.length) return versionSettings(arms[0]);
	try {
		const t = parse(templateYaml || "");
		return versionSettings(Array.isArray(t) && isObj(t[0]) ? t[0] : {});
	} catch {
		return {};
	}
}

/** Why Add waits on the name, or null. */
export function nameHint(name: string): string | null {
	return name.trim() ? null : "Give it a name first — that is what the map and the panel show.";
}

/** The mark under a field: what the reader typed, against the first version
 *  (null while unchanged, or while it doesn't read — the problem says why). */
export function fieldChange(f: SettingField, edit: string | boolean): string | null {
	const r = readField(f, edit);
	return "problem" in r ? null : changeWords(f, r.value);
}

/** "Adds 1: Six-month momentum (2 settings changed). Nothing runs until you press Run." */
export function addsLine(names: string[], changed?: number): string {
	const more = changed ? ` (${changed} setting${changed === 1 ? "" : "s"} changed)` : "";
	return `Adds ${names.length}: ${names.join(", ")}${more}. Nothing runs until you press Run.`;
}

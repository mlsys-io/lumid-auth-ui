// registry/types.ts — the schema a parameter panel is generated from.
//
// This is the one idea worth taking from n8n: a node's form is DATA, not a
// hand-written component per node type. What is NOT worth taking is the size
// of n8n's version of it — 22 property types, an expression language, resource
// locators and resource mappers, all of which exist to serve 400+ SaaS
// integrations. We have ~26 node kinds that are all our own runtime.
//
// So: EIGHT field types, and exactly ONE conditional primitive — `when`, a
// plain predicate over the node's params. That is the deliberate line between
// this and n8n. A predicate covers everything we actually need ("show gpu.count
// only once gpu.type is set", "show training.* only for the training kinds")
// without inventing a DSL that then needs its own editor, parser and docs.
//
// Schemas are hand-written (see registry/lumilake.ts). They are not generated,
// because the labels, hints and ordering ARE the product — a form generated
// from a JSON schema is exactly the stock-demo look we are trying to avoid.
// The safety valve that makes hand-writing safe is in the inspector: any kind
// with no schema, and any parameter not named by one, still renders and is
// still editable as raw YAML. A stale registry degrades; it never blocks.

import type { LucideIcon } from "lucide-react";
import type { WfNodeKind, WfPort } from "../model";
import type { AccentKey } from "../theme";

export type FieldType =
	| "text"      // one line
	| "number"
	| "boolean"
	| "enum"      // a fixed set
	| "code"      // Monaco — prompts, lambda bodies, SQL, templates
	| "keyValue"  // Record<string, string> — args, env, format_kwargs
	| "list"      // string[] — inputs, symbols, skills
	| "resource"; // async options: models, workers, datasets, skills

export type Params = Record<string, unknown>;

export interface EnumOption {
	value: string;
	label: string;
	hint?: string;
}

/**
 * Where a `resource` field's options come from. A name rather than a function,
 * so the registry stays free of network concerns and the inspector decides how
 * to fetch (and can render a plain text input when nothing is wired yet).
 */
export type ResourceLoader = "models" | "workers" | "datasets" | "skills" | "knowledgeAgents";

export interface Field {
	/** Path RELATIVE to the node's params, e.g. ["config", "model"]. */
	path: (string | number)[];
	label: string;
	type: FieldType;
	/**
	 * One sentence, and it is not optional in spirit: the hint is most of what
	 * makes a generated form feel authored rather than dumped.
	 */
	hint?: string;
	required?: boolean;
	placeholder?: string;
	default?: unknown;
	options?: EnumOption[];
	loader?: ResourceLoader;
	/** Monaco language for `code` fields. */
	language?: string;
	min?: number;
	max?: number;
	step?: number;
	/** The one conditional primitive. */
	when?: (p: Params) => boolean;
	/** Returns an error string, or undefined when the value is fine. */
	validate?: (v: unknown, p: Params) => string | undefined;
}

export interface Section {
	title: string;
	collapsed?: boolean;
	fields: Field[];
}

export interface NodeSpec {
	/** Catalog key — the op name, task kind, or "xpio.step". */
	key: string;
	family: WfNodeKind["family"];
	label: string;
	icon?: LucideIcon;
	accent?: AccentKey;
	/** One line at the top of the inspector, explaining what this node does. */
	summary: string;
	/** The node card's second line. Generalises Lumilake's opDetail(). */
	subtitleFrom?: (p: Params) => string;
	ports?: (p: Params) => { inputs: WfPort[]; outputs: WfPort[] };
	sections: Section[];
	docsHref?: string;
}

export type NodeRegistry = Record<string, NodeSpec>;

/** Read a value at a relative path out of a node's params. */
export function getAt(params: Params, path: (string | number)[]): unknown {
	let cur: unknown = params;
	for (const k of path) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string | number, unknown>)[k];
	}
	return cur;
}

/** Every field in a spec that `when` says is currently applicable. */
export function visibleFields(spec: NodeSpec, params: Params): Field[] {
	const out: Field[] = [];
	for (const s of spec.sections) {
		for (const f of s.fields) {
			if (!f.when || f.when(params)) out.push(f);
		}
	}
	return out;
}

/**
 * Parameter keys the schema does NOT name.
 *
 * The inspector renders these in an "Advanced" group as raw YAML. This is not
 * a nicety — without it, a registry that lags the Python silently hides fields
 * the user set, and the next save writes a document with those fields' meaning
 * quietly lost to whoever reads the form instead of the file.
 */
export function unmodelledKeys(spec: NodeSpec | undefined, params: Params): string[] {
	const known = new Set<string>();
	if (spec) {
		for (const s of spec.sections) for (const f of s.fields) known.add(String(f.path[0]));
	}
	return Object.keys(params).filter((k) => !known.has(k));
}

/** Collect the validation errors for a node's current params. */
export function validateParams(spec: NodeSpec, params: Params): Array<{ field: Field; message: string }> {
	const out: Array<{ field: Field; message: string }> = [];
	for (const f of visibleFields(spec, params)) {
		const v = getAt(params, f.path);
		if (f.required && (v === undefined || v === null || v === "")) {
			out.push({ field: f, message: `${f.label} is required.` });
			continue;
		}
		const msg = f.validate?.(v, params);
		if (msg) out.push({ field: f, message: msg });
	}
	return out;
}

// detect.ts — which dialect is this document?
//
// THE DISCRIMINATOR LIVES IN THE DOCUMENT, never in a sidecar column. The Java
// backend stores every workflow as an opaque `definition_json` LONGTEXT it
// never parses, which is what lets four formats share one table with no schema
// change — and is also the trap: a `format` column beside those bytes can drift
// from them, and then two clients disagree about what a row contains. Sniffing
// the bytes cannot drift, because the bytes are the only claim.
//
// Detection is deliberately shallow and cheap. Each dialect has one structural
// tell that no other dialect has:
//
//   flowmesh  apiVersion: flowmesh/v1      (or any apiVersion + kind + spec)
//   lumilake  a top-level `ops:` list
//   n8n       `nodes` array + `connections` object   (JSON)
//   dify      `workflow.graph.nodes` + a quoted `version`  (YAML)
//   xpio      `loops:` or a loop's own `steps:` / `engine:`
//
// Unknown is a real answer, not a failure: the caller falls back to a raw text
// view rather than an error page, because a document we cannot classify is
// still a document somebody wants to see.

import { parse as parseYaml } from "yaml";
import type { WfAnyFormat } from "./model";

export type DetectResult = {
	format: WfAnyFormat | "unknown";
	/** 0..1. Below ~0.5 the caller should offer the raw view. */
	confidence: number;
	why: string;
};

const UNKNOWN: DetectResult = {
	format: "unknown",
	confidence: 0,
	why: "No structural marker of any dialect we know.",
};

export function detectFormat(text: string, hint?: WfAnyFormat): DetectResult {
	const trimmed = text.trim();
	if (!trimmed) return { ...UNKNOWN, why: "Empty document." };

	let doc: Record<string, unknown>;
	try {
		// YAML is a JSON superset, so one parse covers both n8n's JSON and the
		// YAML dialects.
		const parsed = parseYaml(trimmed);
		if (!parsed || typeof parsed !== "object") return UNKNOWN;
		doc = parsed as Record<string, unknown>;
	} catch {
		return { ...UNKNOWN, why: "Not parseable as YAML or JSON." };
	}

	// flowmesh — the apiVersion is explicit and unambiguous.
	const apiVersion = typeof doc.apiVersion === "string" ? doc.apiVersion : undefined;
	if (apiVersion?.startsWith("flowmesh/")) {
		return { format: "flowmesh", confidence: 1, why: `apiVersion: ${apiVersion}` };
	}
	if (apiVersion && doc.kind && doc.spec) {
		return { format: "flowmesh", confidence: 0.8, why: "apiVersion + kind + spec, though not the flowmesh/ prefix." };
	}

	// dify — `workflow.graph.nodes` with a quoted version at the top.
	const workflow = doc.workflow as { graph?: { nodes?: unknown } } | undefined;
	if (workflow?.graph?.nodes) {
		return { format: "dify", confidence: 1, why: "workflow.graph.nodes" };
	}

	// n8n — a nodes ARRAY plus a connections OBJECT. Both halves matter: dify
	// has nodes too, and something else could have connections.
	if (Array.isArray(doc.nodes) && doc.connections && typeof doc.connections === "object" && !Array.isArray(doc.connections)) {
		return { format: "n8n", confidence: 1, why: "nodes[] + connections{}" };
	}

	// lumilake — a top-level ops list.
	if (Array.isArray(doc.ops)) {
		return { format: "lumilake", confidence: 1, why: "top-level ops[]" };
	}

	// xpio — either the whole manifest, or one loop lifted out of it.
	if (Array.isArray(doc.loops)) {
		return { format: "xpio", confidence: 1, why: "loops[]" };
	}
	if (Array.isArray(doc.steps) || (doc.engine && typeof doc.engine === "object")) {
		return { format: "xpio", confidence: 0.7, why: "a loop's steps[] or engine{}" };
	}

	// A caller that already knows (the row it came from, the tab it is on) beats
	// a guess, but only where the bytes say nothing.
	if (hint) return { format: hint, confidence: 0.3, why: `No structural marker; using the caller's hint (${hint}).` };
	return UNKNOWN;
}

/** Convenience: just the format, for call sites that do not care why. */
export function formatOf(text: string, hint?: WfAnyFormat): WfAnyFormat | "unknown" {
	return detectFormat(text, hint).format;
}

// preview.ts — which dialect is this stored workflow, and can we draw it?
//
// Kept out of the component on purpose: this is logic, not rendering, so it is
// testable without pulling React into the test bundle — and it is the piece
// most likely to be reused by anything else that has to show a stored
// definition (a card, a diff, a hover card).
//
// Marketplace rows hold `definition_json`, an opaque LONGTEXT the Java backend
// never parses. In practice that column contains several unlabelled dialects,
// so this sniffs the bytes and degrades: an unrecognised row is an ordinary
// occurrence here, not a fault.

import { detectFormat } from "./detect";
import { parseLumilake } from "./adapters/lumilake";
import { parseFlowMesh } from "./adapters/flowmesh";
import { parseXpio } from "./adapters/xpio";
import { parseN8n } from "./import/n8n";
import { parseDify } from "./import/dify";
import type { WorkflowGraph } from "./model";

export interface PreviewResult {
	graph: WorkflowGraph | null;
	/** What to show in the corner chip: the dialect, or why there is nothing. */
	label: string;
}

export function graphFor(text: string): PreviewResult {
	const trimmed = (text ?? "").trim();
	if (!trimmed || trimmed === "{}") return { graph: null, label: "empty" };
	switch (detectFormat(trimmed).format) {
		case "lumilake": return { graph: parseLumilake(trimmed), label: "Lumilake" };
		case "flowmesh": return { graph: parseFlowMesh(trimmed), label: "FlowMesh" };
		case "xpio":     return { graph: parseXpio(trimmed), label: "xpio loop" };
		case "n8n":      return { graph: parseN8n(trimmed), label: "n8n" };
		case "dify":     return { graph: parseDify(trimmed), label: "Dify" };
		default:         return { graph: null, label: "unrecognised" };
	}
}

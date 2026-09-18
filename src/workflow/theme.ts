// theme.ts — every colour the workflow surfaces use, in one place.
//
// This file exists because three canvases disagreed about what "succeeded"
// looks like. RunDagCanvas had `succeeded: "rgb(16 185 129)"` with the comment
// `// gold-500` (it is emerald) and `running: "rgb(245 158 11)"` also commented
// `// gold-500` (it is amber); LumilakeWorkflowCanvas used ring-emerald-500;
// only WorkflowCanvas used the actual brand gold. Same product, same state,
// three colours — so status colour is defined once, here, and imported.
//
// THE RULE: three independent channels, never overloaded.
//   type     -> accent rail + icon tint     (what this node IS)
//   status   -> a RING and a dot            (what happened when it ran)
//   relation -> edge styling                (how two nodes relate)
// LumilakeWorkflowCanvas's own comment argued this correctly and it is the
// best existing decision in the tree: the border and background are already
// spent encoding type, so repainting them for status trades one axis of
// information for another instead of adding one.
//
// Colours are exported both as raw CSS values (for SVG edges and inline
// styles, which cannot use Tailwind classes) and as CSS custom properties, so
// a future dark pass is a one-file change.

import type { WfStatus, WfNodeKind } from "./model";

// ---------------------------------------------------------------------------
// Status — the site-wide language
// ---------------------------------------------------------------------------

// Healthy/ok is brand GOLD, not green. The whole site does this already: run
// dots, sparklines and status pills are gold. Running is sky (a transient
// state, matching the runs list); failed is rose.
export const GOLD = "rgb(176 143 69)";        // gold-500 — the brand accent
export const GOLD_DEEP = "rgb(150 119 58)";   // gold-600 — borders on gold
export const GOLD_SOFT = "rgb(197 167 94)";   // gold-400 — traced executed path

export const STATUS_COLOR: Record<WfStatus, string> = {
	succeeded: GOLD,
	failed: "rgb(225 29 72)",      // rose-600
	running: "rgb(14 165 233)",    // sky-500
	skipped: "rgb(148 163 184)",   // slate-400
	declared: "rgb(148 163 184)",
	pending: "rgb(203 213 225)",   // slate-300
};

export const STATUS_BORDER: Record<WfStatus, string> = {
	succeeded: GOLD_DEEP,
	failed: "rgb(190 18 60)",
	running: "rgb(2 132 199)",
	skipped: "rgb(148 163 184)",
	declared: "rgb(148 163 184)",
	pending: "rgb(203 213 225)",
};

/**
 * Status as a Tailwind ring — never a border or background repaint, so the
 * type channel survives. `skipped` is the one exception: it has no ring
 * because "didn't run" is better said by draining the node than by adding to
 * it.
 */
export function statusRing(status?: WfStatus): string {
	switch (status) {
		case "running":   return "ring-2 ring-sky-500 ring-offset-1";
		case "succeeded": return "ring-1 ring-[rgb(176_143_69)]";
		case "failed":    return "ring-2 ring-rose-600 ring-offset-1";
		case "skipped":   return "opacity-50 grayscale";
		case "declared":  return "ring-1 ring-dashed ring-slate-300";
		default:          return "";
	}
}

/** Selection is gold and offset, so it reads as distinct from every status ring. */
export const SELECTED_RING = "ring-2 ring-[rgb(176_143_69)] ring-offset-2";

// ---------------------------------------------------------------------------
// Type — the accent channel
// ---------------------------------------------------------------------------

/**
 * Add an alpha channel to one of the colours in this file.
 *
 * Every colour here is written in the space-separated `rgb(r g b)` form, which
 * is what Tailwind arbitrary values want. Appending a hex alpha to that — the
 * habit that works on `#rrggbb` — produces `rgb(14 165 233)22`, which is
 * INVALID CSS. That is worse than it sounds: an invalid entry in a
 * comma-separated `box-shadow` list invalidates the whole declaration, so a
 * running node silently lost its ring AND its base shadow. tsc and the unit
 * tests cannot see this; only a browser can, and one did.
 */
export function withAlpha(color: string, alpha: number): string {
	const m = /^rgb\(([^)]+)\)$/.exec(color.trim());
	if (m) return `rgb(${m[1]} / ${alpha})`;
	// Already rgba(), a hex, or a named colour — leave it alone rather than
	// produce something subtly broken.
	return color;
}

export type AccentKey =
	| "compute" | "data" | "serve" | "io" | "util" | "vision" | "image" | "unknown";

/** Raw accent values, for the node's left rail and icon tint. */
export const ACCENT: Record<AccentKey, string> = {
	compute: "rgb(139 92 246)",   // violet-500  — LLM, training, inference
	data:    "rgb(59 130 246)",   // blue-500    — retrieval, datasets
	serve:   "rgb(20 184 166)",   // teal-500    — serve, API
	io:      "rgb(148 163 184)",  // slate-400   — inputs, triggers, sinks
	util:    "rgb(16 185 129)",   // emerald-500 — format, message, lambda
	vision:  "rgb(236 72 153)",   // pink-500
	image:   "rgb(217 70 239)",   // fuchsia-500
	unknown: "rgb(203 213 225)",  // slate-300   — imported, unmapped
};

const LUMILAKE_ACCENT: Record<string, AccentKey> = {
	LLMChatOp: "compute",
	LLMOp: "compute",
	EmbeddingOp: "compute",
	LLMVisionOp: "vision",
	ImageGenerationOp: "image",
	LambdaOp: "util",
	FormatOp: "util",
	MessageOp: "util",
	DataRetrievalOp: "data",
	DataOp: "data",
	InputOp: "io",
};

// FlowMesh's 15 kinds collapse into FOUR buckets on purpose. Fifteen hues is
// noise, not information — the kind name is already on the node.
const FLOWMESH_ACCENT: Record<string, AccentKey> = {
	InferenceTask: "compute",
	TrainingTask: "compute",
	SFTTask: "compute",
	LoRASFTTask: "compute",
	OmniTask: "compute",
	AgentTask: "compute",
	EmbeddingTask: "compute",
	DiffusersTask: "image",
	ImageClassificationTask: "vision",
	RetrievalTask: "data",
	DataProfilingTask: "data",
	ServeTask: "serve",
	APITask: "serve",
	SSHTask: "util",
	EchoTask: "util",
};

export function accentOf(kind: WfNodeKind): AccentKey {
	switch (kind.family) {
		case "lumilake-op":  return LUMILAKE_ACCENT[kind.op] ?? "unknown";
		case "flowmesh-task": return FLOWMESH_ACCENT[kind.taskType] ?? "unknown";
		case "xpio-step":    return "compute";
		case "xpio-engine":  return "compute";
		case "io":           return "io";
		case "note":         return "util";
		default:             return "unknown";
	}
}

export function accentColor(kind: WfNodeKind): string {
	return ACCENT[accentOf(kind)];
}

// ---------------------------------------------------------------------------
// xpio stage bands
// ---------------------------------------------------------------------------

export const STAGE_TINT: Record<string, string> = {
	observe:     "rgba(56, 189, 248, 0.07)",   // sky
	hypothesize: "rgba(167, 139, 250, 0.08)",  // violet
	act:         "rgba(251, 191, 36, 0.09)",   // amber
	analyze:     "rgba(45, 212, 191, 0.08)",   // teal
	learn:       "rgba(176, 143, 69, 0.10)",   // gold — a banked outcome is on-brand
};

export const STAGE_LABEL_COLOR: Record<string, string> = {
	observe: "rgb(2 132 199)",
	hypothesize: "rgb(124 58 237)",
	act: "rgb(180 83 9)",
	analyze: "rgb(13 148 136)",
	learn: "rgb(123 98 48)",
};

// ---------------------------------------------------------------------------
// Edges — the relation channel
// ---------------------------------------------------------------------------

export const EDGE_IDLE = "rgb(148 163 184)";   // slate-400
export const EDGE_MUTED = "rgb(203 213 225)";  // slate-300 — input bindings

/**
 * Edge stroke by relation and status. The executed path is traced in GOLD
 * (both ends succeeded), which is what makes a finished run readable at a
 * glance without clicking anything.
 */
export function edgeStroke(rel: string, status?: WfStatus): string {
	if (status === "running") return STATUS_COLOR.running;
	if (status === "failed") return STATUS_COLOR.failed;
	if (status === "succeeded") return GOLD_SOFT;
	if (rel === "declared") return EDGE_IDLE;
	if (rel === "attach") return EDGE_MUTED;
	return EDGE_IDLE;
}

export function edgeWidth(rel: string, status?: WfStatus): number {
	if (status === "succeeded" || status === "running") return 2;
	if (rel === "attach") return 1;
	return 1.5;
}

export function edgeDash(rel: string): string | undefined {
	if (rel === "declared") return "6 4";
	if (rel === "attach") return "2 3";
	return undefined;
}

// ---------------------------------------------------------------------------
// Canvas chrome
// ---------------------------------------------------------------------------

export const CANVAS_DOT = "rgb(226 232 240)";   // slate-200
export const CANVAS_GRID = "rgb(241 245 249)";  // slate-100 — the major grid

/**
 * Emitted onto the canvas root so edge SVGs and node cards read from the same
 * values, and so a dark pass is one file.
 */
export function themeVars(): Record<string, string> {
	return {
		"--wf-gold": GOLD,
		"--wf-gold-soft": GOLD_SOFT,
		"--wf-running": STATUS_COLOR.running,
		"--wf-failed": STATUS_COLOR.failed,
		"--wf-edge": EDGE_IDLE,
		"--wf-edge-muted": EDGE_MUTED,
		"--wf-dot": CANVAS_DOT,
		"--wf-grid": CANVAS_GRID,
	};
}

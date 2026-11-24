// theme.ts — every colour the workflow surfaces use, in one place.
//
// This file exists because three canvases disagreed about what "succeeded"
// looks like. RunDagCanvas had `succeeded: "rgb(16 185 129)"` with the comment
// `// gold-500` (it is emerald) and `running: "rgb(245 158 11)"` also commented
// `// gold-500` (it is amber); LumilakeWorkflowCanvas used ring-gold-500;
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
import { ink, gold, brick, lagoon, plum, ember, chart } from "@/styles/palette";

/** `#rrggbb` -> the space-separated `rgb(r g b)` form every colour here uses. */
function rgb(hex: string): string {
	const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
	return `rgb(${n(1)} ${n(3)} ${n(5)})`;
}
/** `#rrggbb` + alpha -> `rgba(r, g, b, a)` (stage tints). */
function rgba(hex: string, a: number): string {
	const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
	return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${a})`;
}

// ---------------------------------------------------------------------------
// Status — the site-wide language
// ---------------------------------------------------------------------------

// Healthy/ok is brand GOLD, not green. The whole site does this already: run
// dots, sparklines and status pills are gold. Running is lagoon (a transient
// state, matching the runs list); failed is brick. All values come from
// src/styles/palette.json (Lumen) — the same tones as src/lib/tones.ts.
export const GOLD = rgb(gold["500"]);        // the brand accent
export const GOLD_DEEP = rgb(gold["600"]);   // borders on gold
export const GOLD_SOFT = rgb(gold["400"]);   // traced executed path

export const STATUS_COLOR: Record<WfStatus, string> = {
	succeeded: GOLD,
	failed: rgb(brick["600"]),
	running: rgb(lagoon["500"]),
	skipped: rgb(ink["400"]),
	declared: rgb(ink["400"]),
	pending: rgb(ink["300"]),
};

export const STATUS_BORDER: Record<WfStatus, string> = {
	succeeded: GOLD_DEEP,
	failed: rgb(brick["700"]),
	running: rgb(lagoon["600"]),
	skipped: rgb(ink["400"]),
	declared: rgb(ink["400"]),
	pending: rgb(ink["300"]),
};

/**
 * Status as a Tailwind ring — never a border or background repaint, so the
 * type channel survives. `skipped` is the one exception: it has no ring
 * because "didn't run" is better said by draining the node than by adding to
 * it.
 */
export function statusRing(status?: WfStatus): string {
	switch (status) {
		case "running":   return "ring-2 ring-lagoon-500 ring-offset-1";
		case "succeeded": return "ring-1 ring-gold-500";
		case "failed":    return "ring-2 ring-brick-600 ring-offset-1";
		case "skipped":   return "opacity-50 grayscale";
		case "declared":  return "ring-1 ring-dashed ring-ink-300";
		default:          return "";
	}
}

/** Selection is gold and offset, so it reads as distinct from every status ring. */
export const SELECTED_RING = "ring-2 ring-gold-500 ring-offset-2";

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

/**
 * Raw accent values, for the node's left rail and icon tint. Node TYPE is a
 * categorical channel, so it draws from the validated chart palette (Lumen
 * chart-1…8), never from the status tones: a violet "compute" rail must not
 * be mistaken for a state.
 */
export const ACCENT: Record<AccentKey, string> = {
	compute: rgb(chart[6]),   // violet      — LLM, training, inference
	data:    rgb(chart[4]),   // blue        — retrieval, datasets
	serve:   rgb(chart[0]),   // teal        — serve, API
	io:      rgb(ink["400"]), // neutral     — inputs, triggers, sinks
	util:    rgb(chart[7]),   // moss        — format, message, lambda
	vision:  rgb(chart[2]),   // rose
	image:   rgb(chart[5]),   // terracotta
	unknown: rgb(ink["300"]), // imported, unmapped
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

// FlowMesh's 16 kinds collapse into FOUR buckets on purpose. Sixteen hues is
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
	PythonTask: "util",
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
	observe:     rgba(lagoon["400"], 0.08),
	hypothesize: rgba(plum["400"], 0.08),
	act:         rgba(ember["400"], 0.09),
	analyze:     rgba(chart[7], 0.08),          // moss
	learn:       rgba(gold["500"], 0.10),       // gold — a banked outcome is on-brand
};

// Band labels sit on their tint: the 700 step clears 4.5:1 there.
export const STAGE_LABEL_COLOR: Record<string, string> = {
	observe: rgb(lagoon["700"]),
	hypothesize: rgb(plum["700"]),
	act: rgb(ember["700"]),
	analyze: "rgb(66 104 40)",                  // moss, darkened for text
	learn: rgb(gold["700"]),
};

// ---------------------------------------------------------------------------
// Edges — the relation channel
// ---------------------------------------------------------------------------

export const EDGE_IDLE = rgb(ink["400"]);
export const EDGE_MUTED = rgb(ink["300"]);   // input bindings

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

export const CANVAS_DOT = rgb(ink["200"]);
export const CANVAS_GRID = rgb(ink["100"]);  // the major grid
export const EDGE_LABEL = rgb(ink["600"]);   // edge label text (>= 4.5:1 on paper)

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

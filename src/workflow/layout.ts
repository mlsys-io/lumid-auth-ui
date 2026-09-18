// layout.ts — turn a WorkflowGraph into positions.
//
// Three strategies, because one size genuinely does not fit:
//
//   dagre        — real DAGs (Lumilake ops, FlowMesh spec.graph, imports).
//   column       — a vertical trunk with a CENTRED fan-out. This is the xpio
//                  Pattern B shape, and it is better than dagre for it: dagre
//                  left-aligns a partial last row, which made odd skill counts
//                  look jagged. Ported from the original WorkflowCanvas.
//   column-bands — the column, plus horizontal stage bands behind it.
//
// POSITIONS NEVER ENTER A NATIVE DOCUMENT. None of the three dialects we
// author has x/y and none should grow one: a diff full of coordinate churn
// makes a YAML file unreviewable. A manual drag is a local nudge persisted per
// workflow in localStorage; "Auto-layout" clears it. Imported graphs (n8n,
// Dify) DO carry authored positions, which we honour by seeding that same
// local store — so an import opens looking like it did in the tool it came
// from, without the coordinates ever reaching a document we write.

import dagre from "@dagrejs/dagre";
import type { WorkflowGraph } from "./model";

export interface Positioned {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Band {
	key: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutResult {
	positions: Map<string, Positioned>;
	bands: Band[];
	/** Total content height — callers size the canvas to it. */
	contentH: number;
	contentW: number;
}

export interface LayoutOpts {
	direction?: "LR" | "TB";
	density?: "comfortable" | "compact";
	/** Per-node manual nudges, by id. Applied last, over the computed position. */
	pinned?: Record<string, { x: number; y: number }>;
}

const SIZE = {
	comfortable: { w: 216, h: 72 },
	compact: { w: 168, h: 48 },
};

// Column geometry, from the original canvas. GUTTER leaves a left column for
// the stage labels; STEP_Y is centre-to-centre between stacked nodes.
const STEP_Y = 108;
const GUTTER = 96;
const COL_X = GUTTER + 18;
const TOP = 16;

export function layoutGraph(g: WorkflowGraph, opts: LayoutOpts = {}): LayoutResult {
	const density = opts.density ?? "comfortable";
	const { w, h } = SIZE[density];
	const direction = opts.direction ?? g.direction;

	let result: LayoutResult;
	switch (g.layout) {
		case "column":
		case "column-bands":
			result = layoutColumn(g, w, h, g.layout === "column-bands");
			break;
		case "authored":
			result = layoutAuthored(g, w, h);
			break;
		default:
			result = layoutDagre(g, w, h, direction);
	}

	// Manual nudges win over whatever the strategy computed.
	if (opts.pinned) {
		for (const [id, p] of Object.entries(opts.pinned)) {
			const cur = result.positions.get(id);
			if (cur) result.positions.set(id, { ...cur, x: p.x, y: p.y });
		}
	}
	return result;
}

// ---------------------------------------------------------------------------

function layoutDagre(g: WorkflowGraph, w: number, h: number, direction: "LR" | "TB"): LayoutResult {
	const dg = new dagre.graphlib.Graph();
	dg.setGraph({ rankdir: direction, nodesep: 22, ranksep: 60 });
	dg.setDefaultEdgeLabel(() => ({}));

	for (const n of g.nodes) dg.setNode(n.id, { width: w, height: h });
	for (const e of g.edges) {
		// `attach` edges are a plug-in relation, not flow — ranking by them
		// would push a model node into its own column and stretch the graph.
		if (e.rel === "attach") continue;
		if (dg.hasNode(e.source) && dg.hasNode(e.target)) dg.setEdge(e.source, e.target);
	}
	dagre.layout(dg);

	const positions = new Map<string, Positioned>();
	let maxX = 0;
	let maxY = 0;
	for (const n of g.nodes) {
		const p = dg.node(n.id);
		if (!p) continue;
		const x = p.x - w / 2;
		const y = p.y - h / 2;
		positions.set(n.id, { id: n.id, x, y, width: w, height: h });
		maxX = Math.max(maxX, x + w);
		maxY = Math.max(maxY, y + h);
	}
	return { positions, bands: [], contentH: maxY + TOP, contentW: maxX + TOP };
}

// ---------------------------------------------------------------------------

/**
 * A vertical trunk, with any node that shares a source fanned into CENTRED
 * rows beneath it. Each row — including a partial last row — is centred under
 * its parent, so a lone trailing node sits directly below rather than jammed
 * to the left, which is what made odd counts look jagged in dagre.
 */
function layoutColumn(g: WorkflowGraph, w: number, h: number, withBands: boolean): LayoutResult {
	const positions = new Map<string, Positioned>();
	const centerX = COL_X + w / 2;
	let y = TOP;

	// Fan-out groups: a source with more than one `declared`/data child that is
	// itself a leaf. Everything else stacks on the trunk.
	const childrenOf = new Map<string, string[]>();
	for (const e of g.edges) {
		if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
		childrenOf.get(e.source)!.push(e.target);
	}

	const placed = new Set<string>();
	const PER_ROW = 2;
	const GAP = 48;

	for (const n of g.nodes) {
		if (placed.has(n.id)) continue;
		const kids = (childrenOf.get(n.id) || []).filter((k) => !placed.has(k));
		// Trunk node.
		positions.set(n.id, { id: n.id, x: COL_X, y, width: w, height: h });
		placed.add(n.id);
		y += STEP_Y;

		// Fan out only when this node has several leaf children — a single child
		// belongs on the trunk, which keeps simple pipelines reading straight.
		const leafKids = kids.filter((k) => !(childrenOf.get(k) || []).length);
		if (leafKids.length > 1) {
			const rows = Math.ceil(leafKids.length / PER_ROW);
			leafKids.forEach((kid, i) => {
				const row = Math.floor(i / PER_ROW);
				const col = i % PER_ROW;
				const inRow = row === rows - 1 ? leafKids.length - row * PER_ROW : PER_ROW;
				const rowW = inRow * w + (inRow - 1) * GAP;
				const rowStartX = centerX - rowW / 2;
				positions.set(kid, {
					id: kid,
					x: rowStartX + col * (w + GAP),
					y: y + row * STEP_Y,
					width: w,
					height: h,
				});
				placed.add(kid);
			});
			y += rows * STEP_Y;
		}
	}

	const bands = withBands ? computeBands(g, positions, w, h) : [];
	const maxY = [...positions.values()].reduce((m, p) => Math.max(m, p.y + p.height), 0);
	const maxX = [...positions.values()].reduce((m, p) => Math.max(m, p.x + p.width), 0);
	return { positions, bands, contentH: maxY + TOP, contentW: maxX + TOP };
}

/**
 * Horizontal stripes behind the column, one per stage that actually has nodes.
 *
 * The stage comes from `node.group`, which the adapter computed ONCE per step.
 * The old code recomputed it here from a positional index into a mixed array,
 * which could disagree with the node's own label; reading the stored value
 * removes that whole class of mismatch.
 */
function computeBands(
	g: WorkflowGraph,
	positions: Map<string, Positioned>,
	w: number,
	h: number,
): Band[] {
	const spans = new Map<string, { minY: number; maxY: number }>();
	for (const n of g.nodes) {
		if (!n.group) continue;
		const p = positions.get(n.id);
		if (!p) continue;
		const span = spans.get(n.group) || { minY: p.y, maxY: p.y };
		span.minY = Math.min(span.minY, p.y);
		span.maxY = Math.max(span.maxY, p.y);
		spans.set(n.group, span);
	}
	const bands: Band[] = [];
	for (const [key, span] of spans) {
		bands.push({
			key,
			label: key,
			x: COL_X - 14,
			y: span.minY - 10,
			width: w + 28,
			height: span.maxY - span.minY + h + 20,
		});
	}
	return bands;
}

// ---------------------------------------------------------------------------

/** Honour positions the source document carried (n8n, Dify). */
function layoutAuthored(g: WorkflowGraph, w: number, h: number): LayoutResult {
	const positions = new Map<string, Positioned>();
	let maxX = 0;
	let maxY = 0;
	g.nodes.forEach((n, i) => {
		const x = n.ui?.x ?? (i % 4) * (w + 40);
		const y = n.ui?.y ?? Math.floor(i / 4) * (h + 40);
		positions.set(n.id, { id: n.id, x, y, width: w, height: h });
		maxX = Math.max(maxX, x + w);
		maxY = Math.max(maxY, y + h);
	});
	return { positions, bands: [], contentH: maxY + TOP, contentW: maxX + TOP };
}

// ---------------------------------------------------------------------------

/**
 * A memo key for the layout. It MUST be structural — ids, edges, direction,
 * density — and must NOT include the graph object or node params. Keying on
 * the object re-runs dagre on every inspector keystroke and reflows the canvas
 * under the user's cursor, which is the single most likely perf bug here.
 */
export function layoutKey(g: WorkflowGraph, opts: LayoutOpts = {}): string {
	return [
		g.layout,
		opts.direction ?? g.direction,
		opts.density ?? "comfortable",
		g.nodes.map((n) => n.id).join(","),
		g.edges.map((e) => e.id).join(","),
		g.nodes.map((n) => n.group ?? "").join(","),
	].join("|");
}

export const LAYOUT_GEOMETRY = { STEP_Y, GUTTER, COL_X, TOP, SIZE };

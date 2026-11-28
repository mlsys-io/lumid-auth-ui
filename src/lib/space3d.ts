// space3d — the geometry behind the 3D research map. Pure and tested; the
// component (components/research/Space3D.tsx) only draws what this computes.
//
// The look follows Novix's exploration space (studied 2026-11-25; their code
// is not copied, the technique is): the root at the centre, each depth further
// out, a yaw/pitch camera with perspective that turns when idle, and depth
// cues — far nodes fade and shrink, near ones come forward. Novix draws dots
// with short labels and spreads them on cones; Lumid keeps readable cards, so
// branches are columns on a ring (layoutSpace) and the space turns them past.

import type { MapNode } from "./research-map";

export type Vec3 = { x: number; y: number; z: number };
export interface Camera { yaw: number; pitch: number; zoom: number; focusX: number; focusY: number }
export interface Projected { x: number; y: number; scale: number; depth: number; visible: boolean }

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Perspective: focal length and camera distance, in layout units. */
export const FOCAL = 900;
export const DISTANCE = 1300;
// Looked at from a little higher than eye level (−0.45 rad ≈ 26°): the ring
// of experiments opens into a disc instead of a flat band, so the space uses
// the box's height, not only its width.
export const HOME: Camera = { yaw: 0.35, pitch: -0.45, zoom: 1, focusX: 0, focusY: 0 };

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v(a.x / l, a.y / l, a.z / l); };
const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
const add = (...xs: Vec3[]): Vec3 => xs.reduce((s, a) => v(s.x + a.x, s.y + a.y, s.z + a.z), v(0, 0, 0));

/**
 * `count` unit directions spread evenly over a cone of half-angle `half`
 * around `axis` (golden-angle spiral on the cap). One child sits on the axis.
 * (Novix's placement for dot nodes; kept for deep subtrees.)
 */
export function coneDirections(axis: Vec3, count: number, half: number): Vec3[] {
	const ax = norm(axis);
	if (count <= 0) return [];
	if (count === 1) return [ax];
	const helper = Math.abs(ax.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
	const u = norm(cross(helper, ax));
	const w = cross(ax, u);
	const cosHalf = Math.cos(half);
	const out: Vec3[] = [];
	for (let i = 0; i < count; i++) {
		const t = (i + 0.5) / count;
		const cosT = 1 - t * (1 - cosHalf);
		const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
		const phi = i * GOLDEN;
		out.push(norm(add(scale(ax, cosT), scale(u, sinT * Math.cos(phi)), scale(w, sinT * Math.sin(phi)))));
	}
	return out;
}

/** Vertical gap between stacked sibling cards, and the step outward per depth. */
export const ROW = 68;
export const STEP = 200;
/** Arc between neighbouring leaves on one orbit, in layout units. */
export const LEAF_GAP = 80;
/** Share of its slice a branch spreads its children over (the rest is a gutter). */
export const SLICE_FILL = 0.92;
/** Radius of the first ring: wide enough that neighbouring branches don't touch. */
export function firstRing(n: number): number { return Math.max(200, n * 48); }

/**
 * Positions for a research tree. Dot-node spaces (Novix) spread children on
 * cones; readable CARDS need rows, so: the app at the origin, experiments on
 * a horizontal ring around it, and each experiment's children stacked in a
 * column further out along the same bearing (deeper levels further still).
 * Turning the space brings each branch to the front in turn.
 */
/** A stable number in [0, 1) for an id (FNV-1a, then a mixer); `salt` picks
 *  an independent stream, so x/y/z jitter aren't correlated. */
export function hash01(id: string, salt = 0): number {
	let h = 2166136261 ^ Math.imul(salt + 1, 0x9e3779b1);
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	h = Math.imul(h ^ (h >>> 15), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const jit = (id: string, salt: number) => hash01(id, salt) - 0.5;

export function layoutSpace(nodes: MapNode[]): Map<string, Vec3> {
	const pos = new Map<string, Vec3>();
	const kids = new Map<string, MapNode[]>();
	for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
	const roots = nodes.filter((n) => !n.parent);
	// Balanced radial tree (2026-11-26, "the graph should be more balanced"):
	// every branch reserves a slice of the circle in proportion to its size
	// (leaf count, damped so a small workflow still gets room) and its children
	// split that slice the same way. One big workflow used to get the same slice
	// as an empty one and stack its variants in a tall column on one bearing —
	// a wall on one side, an empty canvas on the other.
	const leaves = new Map<string, number>();
	const leafCount = (n: MapNode): number => {
		const hit = leaves.get(n.id);
		if (hit != null) return hit;
		const ch = kids.get(n.id) ?? [];
		const c = ch.length ? ch.reduce((s, k) => s + leafCount(k), 0) : 1;
		leaves.set(n.id, c);
		return c;
	};
	const share = (n: MapNode) => Math.pow(leafCount(n), 0.7);
	const ring1 = roots.flatMap((r) => kids.get(r.id) ?? []).length;
	const R1 = firstRing(ring1);
	const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
	const totalLeaves = roots.reduce((s, r) => s + leafCount(r), 0);
	// Room for every leaf on the outer orbit (~LEAF_GAP apart): stretch the step
	// only when the tree needs it, so small apps keep their compact look.
	const needOuter = (totalLeaves * LEAF_GAP) / (2 * Math.PI);
	const step = maxDepth > 1 ? Math.max(STEP, (needOuter - R1) / (maxDepth - 1)) : STEP;
	const radius = (d: number) => (d <= 0 ? 0 : R1 + (d - 1) * step);
	const at = (theta: number, r: number, y: number) => v(r * Math.cos(theta), y, r * Math.sin(theta));
	// Each child fills its share of the parent's slice, so leaves spread over the
	// whole circle — even when one workflow carries nearly everything (MLSys:
	// 62 of 64 nodes under `simulate`), its variants ring the app instead of
	// fanning out on one side.
	const place = (n: MapNode, a0: number, a1: number, y: number, rf: number, slot: number) => {
		const mid = (a0 + a1) / 2;
		const theta = n.depth === 0 ? 0 : mid + jit(n.id, 1) * Math.min(a1 - a0, 0.3) * 0.25;
		// A little in or out (alternating for neighbouring leaves, so labels on one
		// orbit don't collide), at a gentle seeded height — never a tall column.
		const rr = n.depth === 0 ? 0 : radius(n.depth) * rf + (n.depth >= 2 ? (slot % 2 ? 1 : -1) * 18 : 0);
		pos.set(n.id, at(theta, rr, y));
		const ch = kids.get(n.id) ?? [];
		if (!ch.length) return;
		const total = ch.reduce((s, c) => s + share(c), 0);
		// A margin at the slice edges keeps a branch visibly apart from its neighbour.
		const want = n.depth === 0 ? 2 * Math.PI : (a1 - a0) * SLICE_FILL;
		let a = n.depth === 0 ? 0 : theta - want / 2;
		ch.forEach((c, i) => {
			const span = (want * share(c)) / total;
			const cy = n.depth === 0 ? jit(c.id, 3) * 110 : y * 0.6 + jit(c.id, 5) * 40;
			const crf = n.depth === 0 ? 1 + jit(c.id, 2) * 0.16 : rf;
			place(c, a, a + span, cy, crf, i);
			a += span;
		});
	};
	roots.forEach((r, i) => place(r, 0, 2 * Math.PI, 0, 1, i));
	return pos;
}

/**
 * The stage under a laid-out space: a floor below the lowest node, the floor's
 * rings (one under each depth's orbit, plus an inner and an outer rim), and
 * the radius the floor fades out at.
 */
export function sceneFloor(pos: Map<string, Vec3>): { y: number; rings: number[]; rim: number } {
	let maxY = 0, maxR = 0;
	const radii: number[] = [];
	for (const p of pos.values()) {
		maxY = Math.max(maxY, p.y);
		const r = Math.hypot(p.x, p.z);
		maxR = Math.max(maxR, r);
		if (r > 1) radii.push(r);
	}
	// Orbits: cluster the nodes' radii (a ring's jitter is ±8%, a step is 200).
	radii.sort((a, b) => a - b);
	const orbits: number[] = [];
	let group: number[] = [];
	for (const r of radii) {
		if (group.length && r - group[0] > STEP * 0.55) { orbits.push(group.reduce((a, b) => a + b, 0) / group.length); group = []; }
		group.push(r);
	}
	if (group.length) orbits.push(group.reduce((a, b) => a + b, 0) / group.length);
	const rim = Math.max(260, maxR + 90);
	const inner = orbits.length ? orbits[0] * 0.45 : rim * 0.3;
	return { y: maxY + 110, rings: [inner, ...orbits, rim], rim };
}

/** Motes of dust in a cylinder around the space (seeded): they turn with it,
 *  so near motes sweep past far ones — parallax even with nothing selected. */
export function dustField(count: number, radius: number, top: number, bottom: number, seed = "dust"): Array<Vec3 & { size: number; speed: number }> {
	const out: Array<Vec3 & { size: number; speed: number }> = [];
	for (let i = 0; i < count; i++) {
		const id = `${seed}:${i}`;
		const r = radius * Math.sqrt(hash01(id, 1)), a = hash01(id, 2) * 2 * Math.PI;
		out.push({ x: r * Math.cos(a), z: r * Math.sin(a), y: top + (bottom - top) * hash01(id, 3), size: 0.6 + hash01(id, 4), speed: 0.4 + hash01(id, 5) });
	}
	return out;
}

/** Rotate by the camera (yaw about Y, then pitch about X) and project. */
export function project(p: Vec3, cam: Camera, W: number, H: number): Projected {
	const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
	const x1 = p.x * cy + p.z * sy;
	const z1 = -p.x * sy + p.z * cy;
	const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
	const y2 = p.y * cp - z1 * sp;
	const z2 = p.y * sp + z1 * cp;
	const depth = DISTANCE - z2; // larger = farther
	const visible = depth > 60;
	const s = visible ? (FOCAL / depth) * cam.zoom : 0;
	return { x: W / 2 + x1 * s + cam.focusX, y: H / 2 + y2 * s + cam.focusY, scale: s, depth, visible };
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Depth cues from a projected scale: how opaque and how large a card draws.
 * `near` is 0 at the far edge of the scene and 1 at the near edge.
 */
export function depthCue(scaleNow: number, zoom: number): { near: number; alpha: number; size: number } {
	const base = FOCAL / DISTANCE;
	const rel = scaleNow / (base * (zoom || 1)); // ~0.65 far … ~1.5 near
	const near = clamp01((rel - 0.7) / (1.4 - 0.7));
	// Far nodes stay readable (operator 2026-11-27: "contrast is too low"):
	// depth fades a node to 72% at most, never to a ghost.
	return { near, alpha: lerp(0.72, 1, near), size: lerp(0.78, 1.06, near) };
}

/**
 * The camera that frames `points` inside the box [margin, W-margin] ×
 * [top, bottom] at the current yaw/pitch — used to follow a selected path.
 */
export function frameCamera(points: Vec3[], cam: Camera, W: number, H: number, box: { top: number; bottom: number; margin: number; right?: number; maxZoom?: number; minZoom?: number } = { top: 56, bottom: 0.92, margin: 70 }): Camera {
	if (!points.length || !W || !H) return cam;
	const base = { ...cam, zoom: 1, focusX: 0, focusY: 0 };
	const ps = points.map((p) => project(p, base, W, H));
	const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
	const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
	const bottom = box.bottom <= 1 ? H * box.bottom : box.bottom;
	// `right`: pixels covered on the right (a panel over the space) — frame in what's left.
	const right = box.right ?? 0;
	const availW = W - 2 * box.margin - right, availH = bottom - box.top;
	const spanW = Math.max(1, maxX - minX), spanH = Math.max(1, maxY - minY);
	// maxZoom: a small app's whole space may fill the box (overview); a path keeps 1.6.
	const zoom = Math.max(box.minZoom ?? 0.55, Math.min(box.maxZoom ?? 1.6, Math.min(availW / spanW, availH / spanH)));
	const cx = (minX + maxX) / 2 - W / 2, cyy = (minY + maxY) / 2 - H / 2;
	return { ...cam, zoom, focusX: (W - right) / 2 - (W / 2 + cx * zoom), focusY: (box.top + bottom) / 2 - (H / 2 + cyy * zoom) };
}

/** The points as they sit at every eighth of a turn — frame these and the
 *  idle rotation never carries a node out of the box (or leaves it half empty). */
export function turnHull(points: Vec3[]): Vec3[] {
	const out: Vec3[] = [];
	for (let k = 0; k < 8; k++) {
		const a = (k / 8) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a);
		for (const p of points) out.push({ x: p.x * c + p.z * sn, y: p.y, z: -p.x * sn + p.z * c });
	}
	return out;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Interpolate cameras; yaw goes the short way round. */
export function mixCamera(a: Camera, b: Camera, t: number): Camera {
	let dy = b.yaw - a.yaw;
	while (dy > Math.PI) dy -= 2 * Math.PI;
	while (dy < -Math.PI) dy += 2 * Math.PI;
	return {
		yaw: a.yaw + dy * t, pitch: lerp(a.pitch, b.pitch, t), zoom: lerp(a.zoom, b.zoom, t),
		focusX: lerp(a.focusX, b.focusX, t), focusY: lerp(a.focusY, b.focusY, t),
	};
}

/** Camera velocity, per component, in units per second. */
export interface CameraVel { yaw: number; pitch: number; zoom: number; focusX: number; focusY: number }
export const ZERO_VEL: CameraVel = { yaw: 0, pitch: 0, zoom: 0, focusX: 0, focusY: 0 };

/** The camera's spring (2026-11-26, "large motion needs spring"): stiffness
 *  (1/s²) and damping ratio. Slightly underdamped — a large move overshoots a
 *  hair and settles, like the node springs — and settles in ~0.8 s. */
export const CAM_SPRING = { k: 60, zeta: 0.82 };

/** The target yaw as the equivalent angle nearest the current one, so a fly
 *  takes the short way round however many turns the space has made. */
export function nearestYaw(from: number, to: number): number {
	let d = (to - from) % (2 * Math.PI);
	if (d > Math.PI) d -= 2 * Math.PI;
	if (d < -Math.PI) d += 2 * Math.PI;
	return from + d;
}

/** One step of the camera spring toward `target` over `dt` seconds
 *  (semi-implicit Euler, sub-stepped so a slow frame cannot blow it up).
 *  `done` once every component is within a hair and at rest — then it snaps. */
export function stepCameraSpring(cam: Camera, vel: CameraVel, target: Camera, dt: number,
	spring: { k: number; zeta: number } = CAM_SPRING): { cam: Camera; vel: CameraVel; done: boolean } {
	const c = 2 * spring.zeta * Math.sqrt(spring.k);
	const keys = ["yaw", "pitch", "zoom", "focusX", "focusY"] as const;
	const next = { ...cam }, v = { ...vel };
	const steps = Math.max(1, Math.ceil(Math.min(dt, 0.1) / (1 / 120)));
	const h = Math.min(dt, 0.1) / steps;
	for (let i = 0; i < steps; i++) {
		for (const key of keys) {
			const a = spring.k * (target[key] - next[key]) - c * v[key];
			v[key] += a * h;
			next[key] += v[key] * h;
		}
	}
	const eps: Record<(typeof keys)[number], number> = { yaw: 1e-4, pitch: 1e-4, zoom: 1e-4, focusX: 0.25, focusY: 0.25 };
	const done = keys.every((key) => Math.abs(target[key] - next[key]) < eps[key] && Math.abs(v[key]) < eps[key] * 10);
	return done ? { cam: { ...target }, vel: { ...ZERO_VEL }, done } : { cam: next, vel: v, done };
}

/** One turn a minute, after 1.5 s without interaction — slow enough to read,
 *  fast enough to see it is alive (Novix's 86 s read as standing still). */
export const AUTO_ROTATE_RAD_PER_MS = (2 * Math.PI) / 60_000;
export const AUTO_ROTATE_IDLE_MS = 1500;
export const PITCH_LIMIT = 1.1;

// ── Labels that never overprint (2026-11-28) ─────────────────────────────
// Every dot carries its name to its right. Where two names would cross, the
// more important one keeps its label and the other draws as a bare dot until
// it is hovered or selected. The component runs this inside its frame loop,
// so it allocates nothing per frame beyond what a caller reuses.

/** Drift every dot makes on its own (Space3D's sink-and-float): world units
 *  up and down, and the small sideways sway. A label reserves the whole band
 *  its node drifts through, so two neighbours bobbing out of phase can never
 *  slide onto each other — deciding from the rest point alone let them. */
export const BOB_UNITS = 11;
export const SWAY_UNITS = 2;

/** Screen pixels a node's label can drift from its rest point, either way:
 *  `x` from the sway, `y` from the bob (seen through the camera's pitch). */
export function driftEnvelope(scale: number, pitch: number, drifts = true, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
	out.x = drifts ? SWAY_UNITS * scale : 0;
	out.y = drifts ? BOB_UNITS * Math.abs(Math.cos(pitch)) * scale : 0;
	return out;
}

/** Whose label wins a crossing, lower first: the selected node, the rest of
 *  its path, the app, its workflows (and the nodes that group them),
 *  experiments, suggestions, versions last. */
export function labelRank(kind: MapNode["kind"], depth: number, state: { selected?: boolean; onPath?: boolean } = {}): number {
	if (state.selected) return 0;
	if (state.onPath) return 1;
	if (depth === 0 || kind === "app") return 2;
	if (kind === "workflow" || kind === "node") return 3;
	if (kind === "experiment") return 4;
	if (kind === "suggested") return 5;
	return 6;
}

/** Screen box: x0, y0, x1, y1. */
export type Box = [number, number, number, number];
export const boxesOverlap = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** A label as measured once, unscaled: its offset from the node's centre
 *  (`dx`, `dy` to its top-left corner) and its size. */
export interface LabelMetrics { dx: number; dy: number; w: number; h: number }

/**
 * The box a label occupies for a node resting at (cx, cy) drawn at `size`,
 * grown by the drift envelope — written into `out` (no allocation).
 */
export function labelBox(out: Box, cx: number, cy: number, m: LabelMetrics, size: number, env: { x: number; y: number }): Box {
	out[0] = cx + m.dx * size - env.x;
	out[1] = cy + m.dy * size - env.y;
	out[2] = cx + (m.dx + m.w) * size + env.x;
	out[3] = cy + (m.dy + m.h) * size + env.y;
	return out;
}

/** Spatial hysteresis, px per side: a showing label tolerates this much
 *  overlap before it gives way; a hidden one needs this much clearance to
 *  come back. Between the two it keeps its state (no blinking at the edge). */
export const LABEL_KEEP = 1;
export const LABEL_CLEAR = 2;

/** The box a label tests and claims: shrunk a hair if it is showing, grown
 *  if it is hidden — written into `out`. */
export function labelCore(out: Box, box: Box, shown: boolean): Box {
	const g = shown ? LABEL_KEEP : -LABEL_CLEAR;
	out[0] = box[0] + g; out[1] = box[1] + g; out[2] = box[2] - g; out[3] = box[3] - g;
	return out;
}

/**
 * Placed boxes in a coarse grid, so testing a label touches only the boxes
 * in the cells it covers (n labels: ~n log n for the sort, ~n for the pass,
 * not n²). `reset()` keeps its buckets for the next frame.
 */
export class BoxGrid {
	private cells = new Map<number, number[]>();
	private live: number[][] = [];
	private boxes: number[] = [];
	constructor(private readonly cell = 64) {}
	reset(): void {
		for (const b of this.live) b.length = 0;
		this.live.length = 0;
		this.boxes.length = 0;
	}
	get size(): number { return this.boxes.length / 4; }
	private static key(i: number, j: number): number { return (i + 32768) * 65536 + (j + 32768); }
	/** Whether `b` overlaps any box added so far. */
	hits(b: Box): boolean {
		if (!(b[2] > b[0] && b[3] > b[1])) return false;
		const c = this.cell, B = this.boxes;
		const i0 = Math.floor(b[0] / c), j0 = Math.floor(b[1] / c), i1 = Math.floor((b[2] - 1e-6) / c), j1 = Math.floor((b[3] - 1e-6) / c);
		for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
			const list = this.cells.get(BoxGrid.key(i, j));
			if (!list) continue;
			for (const k of list) {
				const o = k * 4;
				if (b[0] < B[o + 2] && b[2] > B[o] && b[1] < B[o + 3] && b[3] > B[o + 1]) return true;
			}
		}
		return false;
	}
	add(b: Box): void {
		if (!(b[2] > b[0] && b[3] > b[1])) return;
		const k = this.boxes.length / 4;
		this.boxes.push(b[0], b[1], b[2], b[3]);
		const c = this.cell;
		const i0 = Math.floor(b[0] / c), j0 = Math.floor(b[1] / c), i1 = Math.floor((b[2] - 1e-6) / c), j1 = Math.floor((b[3] - 1e-6) / c);
		for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
			const key = BoxGrid.key(i, j);
			let list = this.cells.get(key);
			if (!list) { list = []; this.cells.set(key, list); }
			if (!list.length) this.live.push(list);
			list.push(k);
		}
	}
}

/** Whether a label is showing, and since when it has wanted the other state. */
export interface LabelMemory { shown: boolean; since: number }
/** Labels change only once the wish has held this long (ms): slower to hide
 *  than to show, so a brief crossing while the space turns leaves it alone. */
export const LABEL_SHOW_MS = 500;
export const LABEL_HIDE_MS = 700;

/** Timed hysteresis: move `mem` toward `want` at time `t`. `now` applies it
 *  at once (dimmed by a selection, or nothing moves to blink against). */
export function settleLabel(mem: LabelMemory, want: boolean, t: number, now = false): void {
	if (want === mem.shown) { mem.since = 0; return; }
	if (now) { mem.shown = want; mem.since = 0; return; }
	if (!mem.since) mem.since = t;
	if (t - mem.since > (want ? LABEL_SHOW_MS : LABEL_HIDE_MS)) { mem.shown = want; mem.since = 0; }
}

/** One label (or open card) in a declutter pass. The caller keeps these
 *  between frames and refreshes the fields. */
export interface LabelItem {
	rank: number;
	/** A fixed order among equals (the node's index). */
	order: number;
	/** The box it would occupy (drift included). */
	box: Box;
	mem: LabelMemory;
	/** An open card: claims its box, never hides. */
	fixed?: boolean;
	/** May it show at all? (false: at the back of the space, or dimmed.) */
	eligible: boolean;
	/** Change at once rather than after the timed hysteresis. */
	now?: boolean;
	/** Scratch for the core box (reused). */
	core?: Box;
}

/** Most important first; among equals a label already showing keeps its
 *  place, then a fixed order (sorting by depth made neighbours swap as the
 *  space turned — labels blinked, 2026-11-25). */
export function labelOrder(a: LabelItem, b: LabelItem): number {
	return Number(!a.fixed) - Number(!b.fixed) || a.rank - b.rank || Number(!a.mem.shown) - Number(!b.mem.shown) || a.order - b.order;
}

/**
 * Decide which labels show: `items` are sorted in place, then each claims its
 * box unless a more important one (or a reserved area such as the controls)
 * already holds it. Updates every item's `mem`. `reserved` boxes go in first.
 */
export function declutterLabels(items: LabelItem[], t: number, grid: BoxGrid, reserved: readonly Box[] = []): void {
	grid.reset();
	for (const r of reserved) grid.add(r);
	items.sort(labelOrder);
	for (const it of items) {
		if (it.fixed) { grid.add(it.box); continue; }
		const core = labelCore(it.core ?? (it.core = [0, 0, 0, 0]), it.box, it.mem.shown);
		const want = it.eligible && !grid.hits(core);
		settleLabel(it.mem, want, t, !!it.now);
		if (it.mem.shown) grid.add(core);
	}
}

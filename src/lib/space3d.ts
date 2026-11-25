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
export const ROW = 64;
export const STEP = 200;
/** Radius of the first ring: wide enough that neighbouring branches don't touch. */
export function firstRing(n: number): number { return Math.max(200, n * 48); }

/**
 * Positions for a research tree. Dot-node spaces (Novix) spread children on
 * cones; readable CARDS need rows, so: the app at the origin, experiments on
 * a horizontal ring around it, and each experiment's children stacked in a
 * column further out along the same bearing (deeper levels further still).
 * Turning the space brings each branch to the front in turn.
 */
export function layoutSpace(nodes: MapNode[]): Map<string, Vec3> {
	const pos = new Map<string, Vec3>();
	const bearing = new Map<string, number>();
	const kids = new Map<string, MapNode[]>();
	for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
	const roots = nodes.filter((n) => !n.parent);
	// Workflows sit on their own small ring ABOVE the app (they produce the
	// evidence); the experiment ring is laid out without them.
	const isWf = (n: MapNode) => n.kind === "workflow";
	for (const [k, ch] of kids) kids.set(k, ch.filter((c) => !isWf(c)));
	const wfs = nodes.filter(isWf);
	const ring1 = roots.flatMap((r) => kids.get(r.id) ?? []).length;
	const R1 = firstRing(ring1);
	const radius = (d: number) => (d <= 0 ? 0 : R1 + (d - 1) * STEP);
	const at = (theta: number, r: number, y: number) => v(r * Math.cos(theta), y, r * Math.sin(theta));
	const place = (n: MapNode, theta: number, y: number) => {
		pos.set(n.id, at(theta, radius(n.depth), y));
		bearing.set(n.id, theta);
		const ch = kids.get(n.id) ?? [];
		if (!ch.length) return;
		if (n.depth === 0) {
			// The first ring: even bearings; a large ring alternates up/down a little
			// so cards on neighbouring bearings don't share a line.
			ch.forEach((c, i) => place(c, (i / ch.length) * 2 * Math.PI, ch.length > 6 ? (i % 2 ? -36 : 36) : 0));
			return;
		}
		// Deeper: a column centred on the parent's height, nudged a hair around the
		// bearing so the column reads as a fan rather than a wall.
		ch.forEach((c, j) => {
			const k = j - (ch.length - 1) / 2;
			place(c, theta + k * 0.025, y + k * ROW);
		});
	};
	roots.forEach((r, i) => place(r, (i / Math.max(1, roots.length)) * 2 * Math.PI, 0));
	const rw = Math.max(150, R1 * 0.62);
	wfs.forEach((w, i) => { pos.set(w.id, at((i / wfs.length) * 2 * Math.PI + Math.PI / wfs.length, rw, -170)); });
	return pos;
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
	return { near, alpha: lerp(0.32, 1, near), size: lerp(0.78, 1.06, near) };
}

/**
 * The camera that frames `points` inside the box [margin, W-margin] ×
 * [top, bottom] at the current yaw/pitch — used to follow a selected path.
 */
export function frameCamera(points: Vec3[], cam: Camera, W: number, H: number, box = { top: 56, bottom: 0.92, margin: 70 }): Camera {
	if (!points.length || !W || !H) return cam;
	const base = { ...cam, zoom: 1, focusX: 0, focusY: 0 };
	const ps = points.map((p) => project(p, base, W, H));
	const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
	const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
	const bottom = box.bottom <= 1 ? H * box.bottom : box.bottom;
	const availW = W - 2 * box.margin, availH = bottom - box.top;
	const spanW = Math.max(1, maxX - minX), spanH = Math.max(1, maxY - minY);
	const zoom = Math.max(0.55, Math.min(1.6, Math.min(availW / spanW, availH / spanH)));
	const cx = (minX + maxX) / 2 - W / 2, cyy = (minY + maxY) / 2 - H / 2;
	return { ...cam, zoom, focusX: W / 2 - (W / 2 + cx * zoom), focusY: (box.top + bottom) / 2 - (H / 2 + cyy * zoom) };
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

/** One turn a minute, after 1.5 s without interaction — slow enough to read,
 *  fast enough to see it is alive (Novix's 86 s read as standing still). */
export const AUTO_ROTATE_RAD_PER_MS = (2 * Math.PI) / 60_000;
export const AUTO_ROTATE_IDLE_MS = 1500;
export const PITCH_LIMIT = 1.1;

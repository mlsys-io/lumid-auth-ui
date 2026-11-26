// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { coneDirections, layoutSpace, project, depthCue, frameCamera, mixCamera, firstRing, sceneFloor, dustField, hash01, HOME, STEP } from "./space3d";
import type { MapNode } from "./research-map";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

check("cone directions are unit vectors inside the cone, distinct", () => {
	const ax = { x: 0, y: 0, z: 1 };
	const ds = coneDirections(ax, 7, 0.5);
	ok(ds.length === 7, "count");
	for (const d of ds) {
		ok(near(Math.hypot(d.x, d.y, d.z), 1, 1e-9), "unit");
		ok(Math.acos(Math.max(-1, Math.min(1, d.z))) <= 0.5 + 1e-9, "inside the cone");
	}
	const keys = new Set(ds.map((d) => `${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)}`));
	ok(keys.size === 7, "distinct");
	ok(coneDirections(ax, 1, 0.5)[0].z === 1, "one child sits on the axis");
});

const tree: MapNode[] = [
	{ id: "app:a", kind: "app", depth: 0, ref: "a" },
	...["e1", "e2", "e3"].map((e) => ({ id: `exp:${e}`, kind: "experiment" as const, depth: 1, ref: e, parent: "app:a" })),
	...["v1", "v2", "v3", "v4"].map((v) => ({ id: `ver:e1:${v}`, kind: "version" as const, depth: 2, ref: v, parent: "exp:e1" })),
];

check("layout: app at the origin, experiments on a ring, versions further out, nothing touching", () => {
	const pos = layoutSpace(tree);
	const flat = (id: string) => { const p = pos.get(id)!; return Math.hypot(p.x, p.z); };
	ok(near(flat("app:a"), 0) && near(pos.get("app:a")!.y, 0), "app at origin");
	// On the ring, give or take its organic nudge (±8% radius).
	const R1 = firstRing(3);
	for (const e of ["e1", "e2", "e3"]) ok(flat(`exp:${e}`) > R1 * 0.91 && flat(`exp:${e}`) < R1 * 1.09, `${e} on the ring`);
	for (const v of ["v1", "v2", "v3", "v4"]) ok(flat(`ver:e1:${v}`) > R1 * 0.91 + STEP - 20 && flat(`ver:e1:${v}`) < R1 * 1.09 + STEP + 20, `${v} one step out`);
	const pts = [...pos.values()];
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
		ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z) > 55, "cards apart");
	}
});

check("the layout is organic but stable: same ids, same places; experiments at different heights", () => {
	const a = layoutSpace(tree), b = layoutSpace(tree);
	for (const [id, p] of a) { const q = b.get(id)!; ok(p.x === q.x && p.y === q.y && p.z === q.z, `${id} stable`); }
	const ys = ["e1", "e2", "e3"].map((e) => a.get(`exp:${e}`)!.y);
	ok(new Set(ys.map((y) => y.toFixed(3))).size === 3, "experiments are not all on one plane");
	ok(ys.every((y) => Math.abs(y) <= 55), "but stay near the app's height");
});

check("the floor sits under every node, with a ring under each orbit", () => {
	const pos = layoutSpace(tree);
	const f = sceneFloor(pos);
	ok([...pos.values()].every((p) => p.y < f.y - 60), "floor below all");
	ok(f.rings.length === 4, `inner + 2 orbits + rim (${f.rings.map((r) => r.toFixed(0)).join(",")})`);
	ok(Math.abs(f.rings[1] - firstRing(3)) < firstRing(3) * 0.1, "first orbit at the experiment ring");
	ok(f.rings.every((r, i) => i === 0 || r > f.rings[i - 1]), "rings grow outward");
	const d = dustField(40, 500, -200, 200);
	ok(d.length === 40 && d.every((m) => Math.hypot(m.x, m.z) <= 500 && m.y >= -200 && m.y <= 200), "dust inside its cylinder");
	ok(hash01("x", 1) !== hash01("x", 2) && hash01("x", 1) === hash01("x", 1), "hash streams differ, and are stable");
});

check("versions sit near their own experiment, not another's", () => {
	const pos = layoutSpace(tree);
	const d = (a: string, b: string) => { const p = pos.get(a)!, q = pos.get(b)!; return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); };
	for (const v of ["v1", "v2", "v3", "v4"]) ok(d(`ver:e1:${v}`, "exp:e1") < d(`ver:e1:${v}`, "exp:e2"), `${v} near e1`);
});

check("a lopsided app still lays out balanced: no wall on one side, no tall column", () => {
	// MLSys's shape: one workflow carrying 15 variants (some with setups), four empty ones.
	const t: MapNode[] = [
		{ id: "app:m", kind: "app", depth: 0, ref: "m" },
		...["sim", "coach", "assess", "sandbox", "grade"].map((w) => ({ id: `wf:${w}`, kind: "workflow" as const, depth: 1, ref: w, parent: "app:m" })),
		...Array.from({ length: 15 }, (_, i) => ({ id: `wf:v${i}`, kind: "workflow" as const, depth: 2, ref: `v${i}`, parent: "wf:sim" })),
		...Array.from({ length: 6 }, (_, i) => ({ id: `ver:v0:${i}`, kind: "version" as const, depth: 3, ref: `s${i}`, parent: "wf:v0" })),
	];
	const pos = layoutSpace(t);
	const pts = [...pos.values()];
	const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
	const rmax = Math.max(...pts.map((p) => Math.hypot(p.x, p.z)));
	ok(Math.hypot(cx, cz) < rmax * 0.35, `centre of mass near the app (${Math.hypot(cx, cz).toFixed(0)} of ${rmax.toFixed(0)})`);
	const ys = pts.map((p) => p.y);
	ok(Math.max(...ys) - Math.min(...ys) < 260, `no tall column (height span ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)})`);
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
		ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z) > 40, "dots apart");
	}
});

check("one workflow carrying nearly everything still rings the app (no empty side)", () => {
	// The live MLSys tree: the app has two children, and `simulate` holds 62 of 64 nodes.
	const t: MapNode[] = [
		{ id: "app:m", kind: "app", depth: 0, ref: "m" },
		{ id: "node:other", kind: "node", depth: 1, ref: "other", parent: "app:m" },
		{ id: "wf:sim", kind: "workflow", depth: 1, ref: "sim", parent: "app:m" },
		...Array.from({ length: 12 }, (_, i) => ({ id: `wf:v${i}`, kind: "workflow" as const, depth: 2, ref: `v${i}`, parent: "wf:sim" })),
		...Array.from({ length: 36 }, (_, i) => ({ id: `ver:${i}`, kind: "version" as const, depth: 3, ref: `s${i}`, parent: `wf:v${i % 12}` })),
	];
	const pos = layoutSpace(t);
	const sectors = new Array(6).fill(0);
	for (const [id, p] of pos) if (id !== "app:m") sectors[Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (2 * Math.PI)) * 6) % 6]++;
	ok(sectors.every((c) => c > 0), `every 60° sector holds a node (${sectors.join(" ")})`);
});

check("projection: origin lands at the centre; nearer is larger", () => {
	const p = project({ x: 0, y: 0, z: 0 }, HOME, 800, 600);
	ok(near(p.x, 400) && near(p.y, 300), "centre");
	const cam = { ...HOME, yaw: 0, pitch: 0 };
	const nearP = project({ x: 0, y: 0, z: 200 }, cam, 800, 600), farP = project({ x: 0, y: 0, z: -200 }, cam, 800, 600);
	ok(nearP.scale > farP.scale, "near is larger");
	ok(depthCue(nearP.scale, 1).alpha > depthCue(farP.scale, 1).alpha, "near is more opaque");
	ok(depthCue(farP.scale, 1).alpha >= 0.32 && depthCue(nearP.scale, 1).alpha <= 1, "alpha bounds");
});

check("framing a path puts every point of it inside the box", () => {
	const pos = layoutSpace(tree);
	const path = ["app:a", "exp:e1", "ver:e1:v4"].map((id) => pos.get(id)!);
	const W = 900, H = 560;
	const cam = frameCamera(path, HOME, W, H);
	for (const p of path) {
		const q = project(p, cam, W, H);
		ok(q.x >= 60 && q.x <= W - 60 && q.y >= 46 && q.y <= H * 0.92 + 10, `inside: ${q.x.toFixed(0)},${q.y.toFixed(0)}`);
	}
});

check("camera mix takes the short way round", () => {
	const a = { ...HOME, yaw: 3.0 }, b = { ...HOME, yaw: -3.0 };
	const m = mixCamera(a, b, 0.5);
	ok(Math.abs(Math.abs(m.yaw) - Math.PI) < 0.05, `yaw ${m.yaw}`);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;

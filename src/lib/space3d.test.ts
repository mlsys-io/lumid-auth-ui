// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { coneDirections, layoutSpace, project, depthCue, frameCamera, mixCamera, firstRing, HOME, STEP } from "./space3d";
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
	for (const e of ["e1", "e2", "e3"]) ok(near(flat(`exp:${e}`), firstRing(3), 1e-6), `${e} on the ring`);
	for (const v of ["v1", "v2", "v3", "v4"]) ok(near(flat(`ver:e1:${v}`), firstRing(3) + STEP, 1e-6), `${v} one step out`);
	const pts = [...pos.values()];
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
		ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z) > 55, "cards apart");
	}
});

check("versions sit near their own experiment, not another's", () => {
	const pos = layoutSpace(tree);
	const d = (a: string, b: string) => { const p = pos.get(a)!, q = pos.get(b)!; return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); };
	for (const v of ["v1", "v2", "v3", "v4"]) ok(d(`ver:e1:${v}`, "exp:e1") < d(`ver:e1:${v}`, "exp:e2"), `${v} near e1`);
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

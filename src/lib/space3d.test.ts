// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { coneDirections, layoutSpace, project, depthCue, frameCamera, mixCamera, firstRing, sceneFloor, dustField, hash01, HOME, STEP , stepCameraSpring, nearestYaw, ZERO_VEL,
	BOB_UNITS, BoxGrid, LABEL_HIDE_MS, LABEL_KEEP, LABEL_SHOW_MS, boxesOverlap, declutterLabels, driftEnvelope, labelBox, labelRank, settleLabel, type Box, type LabelItem } from "./space3d";
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

check("the camera spring settles on its target, overshoots only a hair, and stops", () => {
	const from = { yaw: 0, pitch: -0.45, zoom: 0.5, focusX: 0, focusY: 0 };
	const to = { yaw: 1.2, pitch: -0.18, zoom: 1.4, focusX: -220, focusY: 80 };
	let cam = from, vel = { ...ZERO_VEL }, t = 0, done = false, maxZoom = 0, maxStep = 0;
	while (!done && t < 5) {
		const prev = cam;
		({ cam, vel, done } = stepCameraSpring(cam, vel, to, 1 / 60));
		t += 1 / 60;
		maxZoom = Math.max(maxZoom, cam.zoom);
		maxStep = Math.max(maxStep, Math.hypot(cam.focusX - prev.focusX, cam.focusY - prev.focusY));
	}
	ok(done && t < 2, `settles (${t.toFixed(2)} s)`);
	ok(near(cam.zoom, to.zoom) && near(cam.focusX, to.focusX) && near(cam.yaw, to.yaw), "lands exactly on the target");
	ok(maxZoom < to.zoom + (to.zoom - from.zoom) * 0.08, `overshoot under 8% (${(maxZoom - to.zoom).toFixed(3)})`);
	ok(maxStep < 25, `no single 60 fps frame moves the view more than 25 px (${maxStep.toFixed(1)})`);
	// A slow frame (a hidden tab coming back) cannot blow it up.
	const big = stepCameraSpring(from, { ...ZERO_VEL }, to, 2);
	ok(Number.isFinite(big.cam.focusX) && Math.abs(big.cam.focusX) < 400, "a 2 s frame stays bounded");
});

check("a fly takes the short way round, however many turns were made", () => {
	ok(near(nearestYaw(10 * Math.PI + 0.1, 0.2), 10 * Math.PI + 0.2), "same turn");
	ok(near(nearestYaw(0.1, 2 * Math.PI - 0.1), -0.1), "across zero, backwards");
	ok(Math.abs(nearestYaw(3, -3) - 3) <= Math.PI, "never more than half a turn");
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

// ── labels that never overprint ──────────────────────────────────────────

check("label rank: selected > its path > app > workflow/node > experiment > suggestion > version", () => {
	const r = [
		labelRank("version", 2, { selected: true }),
		labelRank("version", 2, { onPath: true }),
		labelRank("app", 0),
		labelRank("workflow", 1),
		labelRank("experiment", 2),
		labelRank("suggested", 2),
		labelRank("version", 3),
	];
	for (let i = 1; i < r.length; i++) ok(r[i - 1] < r[i], `rank ${i - 1} before ${i}: ${r.join(",")}`);
	ok(labelRank("node", 1) === labelRank("workflow", 1), "a node groups workflows: same rank");
});

check("drift envelope: the bob band through the pitch, nothing for the app", () => {
	const e = driftEnvelope(0.7, -0.45);
	ok(near(e.y, BOB_UNITS * Math.cos(0.45) * 0.7), `y ${e.y}`);
	ok(e.x > 0 && e.x < e.y, "sway is smaller than the bob");
	const z = driftEnvelope(0.7, -0.45, false);
	ok(z.x === 0 && z.y === 0, "a still node reserves no band");
	const out = { x: 9, y: 9 };
	ok(driftEnvelope(1, 0, true, out) === out, "writes into the caller's object");
});

check("label box: offset and size scale with the node, grown by the envelope", () => {
	const b: Box = [0, 0, 0, 0];
	labelBox(b, 100, 50, { dx: 10, dy: -7, w: 80, h: 14 }, 2, { x: 1, y: 5 });
	ok(near(b[0], 119) && near(b[1], 31) && near(b[2], 281) && near(b[3], 69), `box ${b.join(",")}`);
});

check("box grid agrees with a brute-force overlap test", () => {
	const g = new BoxGrid(48);
	const placed: Box[] = [];
	const rnd = (i: number, k: number) => hash01(`grid:${i}`, k);
	for (let i = 0; i < 120; i++) {
		const x = -200 + rnd(i, 1) * 1200, y = -100 + rnd(i, 2) * 700;
		const b: Box = [x, y, x + 4 + rnd(i, 3) * 160, y + 4 + rnd(i, 4) * 40];
		const brute = placed.some((q) => boxesOverlap(b, q));
		ok(g.hits(b) === brute, `box ${i}: grid ${g.hits(b)} vs brute ${brute}`);
		if (rnd(i, 5) < 0.6) { g.add(b); placed.push(b); }
	}
	g.reset();
	ok(g.size === 0 && !g.hits([0, 0, 1e4, 1e4]), "reset empties it");
	ok(!g.hits([5, 5, 5, 20]), "an empty box hits nothing");
});

const item = (rank: number, order: number, box: Box, shown = false, extra: Partial<LabelItem> = {}): LabelItem =>
	({ rank, order, box, mem: { shown, since: 0 }, eligible: true, ...extra });

check("declutter: the more important label keeps its place, whatever the input order", () => {
	const g = new BoxGrid();
	const ver = item(6, 0, [100, 100, 200, 114], true);
	const exp = item(4, 1, [150, 105, 260, 119], true);
	declutterLabels([ver, exp], 1, g);
	ok(ver.mem.shown && exp.mem.shown, "nothing changes at once (no blinking)");
	declutterLabels([ver, exp], 1 + LABEL_HIDE_MS + 10, g);
	ok(!ver.mem.shown && exp.mem.shown, "the version gave way to the experiment");
	// Two hidden ones: only the winner appears, after the show delay.
	const a = item(5, 3, [0, 0, 50, 12]), b = item(5, 2, [10, 4, 60, 16]);
	declutterLabels([a, b], 1, g);
	ok(!a.mem.shown && !b.mem.shown, "not yet");
	declutterLabels([a, b], 2 + LABEL_SHOW_MS, g);
	ok(b.mem.shown && !a.mem.shown, "equal rank: the fixed order decides");
});

check("declutter: a label already showing keeps its place against an equal", () => {
	const g = new BoxGrid();
	const old = item(6, 9, [0, 0, 80, 14], true), fresh = item(6, 1, [20, 2, 100, 16]);
	for (const t of [1, 400, 900, 1600]) declutterLabels([fresh, old], t, g);
	ok(old.mem.shown && !fresh.mem.shown, "the showing one stays; the newcomer waits");
});

check("declutter: spatial hysteresis — a hair of overlap keeps, a hair of clearance is not enough", () => {
	const g = new BoxGrid();
	const top = item(4, 0, [0, 0, 100, 14], true);
	const under = item(6, 1, [0, 14 - LABEL_KEEP, 100, 28 - LABEL_KEEP], true);
	for (const t of [1, 2000]) declutterLabels([top, under], t, g);
	ok(top.mem.shown && under.mem.shown, "touching by ≤ the keep margin: both stay");
	// A hidden one must clear the showing label by LABEL_CLEAR − LABEL_KEEP.
	const hid = item(6, 1, [0, 14.5, 100, 28.5], false);
	for (const t of [1, 2000]) declutterLabels([top, hid], t, g);
	ok(!hid.mem.shown, "half a pixel clear is not clear enough to come back");
	const far = item(6, 2, [0, 20, 100, 34], false);
	for (const t of [1, 2000]) declutterLabels([top, far], t, g);
	ok(far.mem.shown, "clear by more than the margin: it comes back");
});

check("declutter: reserved corners, open cards and dimmed labels", () => {
	const g = new BoxGrid();
	const hint: Box = [0, 0, 400, 24];
	const under = item(2, 0, [100, 10, 180, 24], true);
	const card = item(6, 1, [300, 100, 500, 200], false, { fixed: true });
	const atCard = item(3, 2, [450, 150, 520, 164], true);
	const dim = item(4, 3, [700, 300, 760, 314], true, { eligible: false, now: true });
	for (const t of [1, 2000]) declutterLabels([dim, atCard, card, under], t, g, [hint]);
	ok(!under.mem.shown, "no label under the hint line");
	ok(!atCard.mem.shown, "an open card claims its box over any label");
	ok(!dim.mem.shown, "dimmed by a selection");
	const dim2 = item(4, 3, [700, 300, 760, 314], true, { eligible: false, now: true });
	declutterLabels([dim2], 1, g);
	ok(!dim2.mem.shown, "dimming applies at once");
});

check("settleLabel: slower to hide than to show; a wish that lapses resets", () => {
	const m = { shown: false, since: 0 };
	settleLabel(m, true, 100); settleLabel(m, true, 100 + LABEL_SHOW_MS - 1);
	ok(!m.shown, "not before the show delay");
	settleLabel(m, false, 700);
	ok(m.since === 0, "the wish lapsed");
	settleLabel(m, true, 1000); settleLabel(m, true, 1001 + LABEL_SHOW_MS);
	ok(m.shown, "shown after the delay");
	settleLabel(m, false, 2000); settleLabel(m, false, 2001 + LABEL_SHOW_MS);
	ok(m.shown, "hiding waits longer");
	settleLabel(m, false, 2001 + LABEL_HIDE_MS);
	ok(!m.shown, "hidden after the hide delay");
});

check("a fan of 20 bobbing labels: once settled, no two shown names cross at any phase", () => {
	// Quant Research's "Long history": 20 versions fanned below the experiment,
	// rest points 9–15px apart, every dot bobbing out of phase.
	const g = new BoxGrid();
	const scale = 0.7, pitch = HOME.pitch;
	const env = driftEnvelope(scale, pitch);
	const m = { dx: 8, dy: -8, w: 130, h: 16 };
	const rest = Array.from({ length: 20 }, (_, i) => ({ x: 300 + i * 22 + hash01(`fan${i}`, 1) * 30, y: 200 + i * 11 + hash01(`fan${i}`, 2) * 4, ph: i * 2.399963 }));
	const items = rest.map((r, i) => item(6, i, labelBox([0, 0, 0, 0], r.x, r.y, m, 1, env), true));
	// The pass alongside an experiment label sitting in the middle of the fan.
	const expLabel = item(4, 99, labelBox([0, 0, 0, 0], 420, 300, m, 1, driftEnvelope(scale, pitch)), false);
	for (let t = 1; t < 4000; t += 100) declutterLabels([...items, expLabel], t, g);
	const shown = items.filter((x) => x.mem.shown);
	ok(expLabel.mem.shown, "the experiment's name wins its spot");
	ok(shown.length >= 4 && shown.length < 20, `some versions keep their names (${shown.length})`);
	const all = [...rest.map((r, i) => ({ r, on: items[i].mem.shown })), { r: { x: 420, y: 300, ph: 0.5 }, on: true }].filter((x) => x.on);
	for (let k = 0; k < 24; k++) {
		const th = (k / 24) * 2 * Math.PI;
		const boxes = all.map(({ r }) => labelBox([0, 0, 0, 0], r.x, r.y - env.y * Math.sin(th + r.ph), m, 1, { x: 0, y: 0 }));
		for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i], b = boxes[j];
			const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
			ok(!(ox > 2 * LABEL_KEEP && oy > 2 * LABEL_KEEP), `labels ${i},${j} overprint at phase ${k}: ${ox.toFixed(1)}×${oy.toFixed(1)}`);
		}
	}
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

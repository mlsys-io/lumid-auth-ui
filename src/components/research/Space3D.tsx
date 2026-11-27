// Space3D — the research map as a 3D space (Novix's look, Lumid's cards).
//
// Geometry lives in lib/space3d.ts (tested). This component draws it: cards
// are real DOM (crisp text, buttons, Lumen styles), edges are SVG lines, and
// ONE requestAnimationFrame loop writes their positions straight to the DOM —
// React renders the cards once per data/selection change, never per frame.
//
// Motion, and what each means:
//   - the space turns slowly when nobody is using it (one turn per ~86 s,
//     after 1.5 s idle; paused while the pointer is over it);
//   - drag to turn, ⌘/ctrl + scroll or pinch to zoom, arrows/+/−/0 on the keyboard;
//   - picking a card flies the camera to frame its path from the app (700 ms)
//     and dims everything else; the path's edges flow;
//   - on first view per session the cards appear in creation order.
// The stage (so it reads as a space, not dots and lines): a floor under the
// nodes with a ring under each orbit and spokes that fade into fog, a soft
// shadow on the floor under every node, a stem from each experiment down to
// its shadow (height you can see), and motes of dust that turn with the space.
// Reduced motion: no turning, no fly-to (the camera jumps), no flow, no growth,
// no drifting dust.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { MapEdge, MapNode } from "@/lib/research-map";
import {
	AUTO_ROTATE_IDLE_MS, AUTO_ROTATE_RAD_PER_MS, DISTANCE, FOCAL, HOME, PITCH_LIMIT, depthCue, dustField, easeInOutCubic, frameCamera, layoutSpace, nearestYaw, project, sceneFloor, stepCameraSpring, turnHull, ZERO_VEL, type CameraVel,
	type Camera,
} from "@/lib/space3d";
import { cn } from "@/lib/utils";


export interface Space3DProps {
	nodes: MapNode[];
	edges: MapEdge[];
	/** The card for one node; Space3D positions it. Shown for the selected path and the hovered node. */
	renderCard: (n: MapNode, state: { selected: boolean; dim: boolean }) => ReactNode;
	/** The compact form everywhere else: a dot with its name (Novix draws its space as dots). */
	renderDot?: (n: MapNode) => ReactNode;
	/** Words for screen readers and the hover title: "KOL alpha — can't compare yet". */
	describe: (n: MapNode) => string;
	selected: string | null;
	/** `shift`: the click held ⇧ (the graph's "compare with" gesture). */
	onSelect: (id: string | null, shift?: boolean) => void;
	/** Ids on the selected path (lit); null when nothing is selected. */
	lit: Set<string> | null;
	/** First view this session: cards appear in creation order. */
	grow: boolean;
	/** Order cards appear in (index per id) when growing. */
	order?: Map<string, number>;
	height: number;
	/** Evidence around a node: one faint particle per result (log-scaled,
	 *  capped), coloured like the node's state — how much a version has been
	 *  measured, seen at a glance. */
	evidence?: (n: MapNode) => { count: number; className: string } | null;
	/** Pixels at the foot covered by something docked over the space (the
	 *  approval card): the camera frames the space above it. */
	insetBottom?: number;
	/** Pixels covered on the right (the detail panel): framing keeps clear of it. */
	insetRight?: number;
	/** A plain edge's stroke class (e.g. the colour of the workflow behind a branch). */
	edgeClass?: (e: MapEdge) => string | undefined;
	/** Whether hovering this node opens its full card (default yes). */
	hoverCard?: (n: MapNode) => boolean;
}

const HINT_KEY = "space3d_hint_seen_v1";
/** How big dots, labels and lines draw for a box this size: 1 at 900×560,
 *  growing with the box's area (square root) between 0.9 and 1.35 — a fixed
 *  pixel size read tiny on a big screen and crowded on a small one. */
const uiScale = (W: number, H: number) => Math.max(0.9, Math.min(1.35, Math.sqrt((W * H) / (900 * 560))));
/** Arcs per floor ring (each fades with its own depth) and spokes on the floor. */
const RING_SEGMENTS = 18;
const SPOKES = 24;

// Framing for the whole space: dots are small, so the margin only has to
// leave room for a label to the right of the outermost dot.
// top: room for the labels above the highest dots; bottom: the floor's band.
// minZoom: a big app's whole space still fits (dots + labels read small; cards show on hover).
const HOME_BOX = { top: 64, bottom: 0.86, margin: 80, maxZoom: 2, minZoom: 0.35 };
const boxAbove = (box: { top: number; bottom: number; margin: number; maxZoom?: number; minZoom?: number }, H: number, inset: number, right = 0) => ({
	...box, right,
	bottom: inset > 0 ? Math.min(H * (box.bottom <= 1 ? box.bottom : box.bottom / H), H - inset - 20) : box.bottom,
});

// A gentle spring: overshoots ~6% and settles (selection flies in, lands).

// The stage canvas's colours, read once from palette classes on a hidden probe
// (no hex here: palette.json stays the source). Cached once the CSS has applied.
type StageColors = { floorCore: string; floorMid: string; floorEdge: string; shadowCore: string; shadowEdge: string; ink300: string; plum300: string };
let stageColorCache: StageColors | null = null;
function withAlpha(color: string, a: number): string {
	const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(color);
	if (!m) return "rgba(0, 0, 0, 0)";
	return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${(a * (m[4] === undefined ? 1 : Number(m[4]))).toFixed(3)})`;
}
function stageColors(probe: SVGSVGElement | null): StageColors {
	if (stageColorCache) return stageColorCache;
	const k = probe?.children;
	const none = "rgba(0, 0, 0, 0)";
	if (!k || k.length < 7) return { floorCore: none, floorMid: none, floorEdge: none, shadowCore: none, shadowEdge: none, ink300: none, plum300: none };
	const stop = (i: number) => { const cs = getComputedStyle(k[i]); return withAlpha(cs.stopColor, parseFloat(cs.stopOpacity || "1")); };
	const stroke = (i: number) => withAlpha(getComputedStyle(k[i]).stroke, 1);
	const c = { floorCore: stop(0), floorMid: stop(1), floorEdge: stop(2), shadowCore: stop(3), shadowEdge: stop(4), ink300: stroke(5), plum300: stroke(6) };
	// Only remember real colours (a probe read before the stylesheet applied is all black/none).
	if (c.ink300 !== none && c.ink300 !== "rgba(0, 0, 0, 1.000)") stageColorCache = c;
	return c;
}

// Write-if-changed for the frame loop: ~900 attribute writes a frame, a quarter
// of them unchanged, and every SVG geometry write is a style recalculation.
const lastWrite = new WeakMap<Element, Record<string, string>>();
function setA(el: Element, name: string, v: string) {
	let m = lastWrite.get(el); if (!m) { m = {}; lastWrite.set(el, m); }
	if (m[name] !== v) { m[name] = v; el.setAttribute(name, v); }
}
function setS(el: HTMLElement | SVGElement, prop: "opacity" | "transform" | "zIndex" | "filter" | "visibility" | "pointerEvents", v: string) {
	let m = lastWrite.get(el); if (!m) { m = {}; lastWrite.set(el, m); }
	const k = "style:" + prop;
	if (m[k] !== v) { m[k] = v; el.style[prop] = v; }
}

// Sink and float: world units of vertical bob, and the period range.
const BOB_UNITS = 11, BOB_MS = 5200, BOB_SPREAD_MS = 1800;
// A mouse left still this long over empty space counts as idle (the space turns).
const POINTER_REST_MS = 3000;

export default function Space3D({ nodes, edges, renderCard, renderDot, describe, selected, onSelect, lit, grow, order, height, evidence, insetBottom = 0, insetRight = 0, edgeClass, hoverCard }: Space3DProps) {
	const insetRef = useRef(insetBottom);
	insetRef.current = insetBottom;
	const rightRef = useRef(insetRight);
	rightRef.current = insetRight;
	// While the space is being moved (not turned): the cursor says so.
	const [panning, setPanning] = useState(false);
	const [parkedUi, setParkedUi] = useState(false);
	const [hint, setHint] = useState(() => { try { return !sessionStorage.getItem(HINT_KEY); } catch { return true; } });
	// The node under the pointer (or keyboard focus) opens into its full card.
	const [hovered, setHovered] = useState<string | null>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const cardEls = useRef(new Map<string, HTMLElement>());
	const edgeEls = useRef(new Map<string, SVGPathElement>());
	const haloEls = useRef(new Map<string, SVGPathElement>());
	// Every node rides a damped spring toward where the camera puts it: the
	// space lags a touch behind a drag, overshoots and settles; a new node
	// springs out of its parent.
	const springs = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>());
	const labelEls = useRef(new Map<string, SVGTextElement>());
	// Each dot's label element and its unscaled size (text never changes).
	const dotLabels = useRef(new Map<string, { el: HTMLElement; w: number; h: number }>());
	// Whether each dot's label is showing, and since when it has wanted the
	// other state (labels change only after ~0.45 s, so they don't blink).
	const labelState = useRef(new Map<string, { shown: boolean; since: number }>());
	// The layout follows the tree's SHAPE (ids, parents, depths), not the array:
	// every background refresh rebuilds `nodes`, and re-laying out on identity
	// re-framed the camera, un-parked a zoomed reader and replayed the fly home
	// mid-turn (2026-11-26: "rotate a while and then change a lot").
	const shapeKey = nodes.map((n) => `${n.id}<${n.parent ?? ""}@${n.depth}`).join("|");
	const shapeNodes = useRef(nodes);
	if (shapeNodes.current !== nodes && shapeKey !== shapeNodes.current.map((n) => `${n.id}<${n.parent ?? ""}@${n.depth}`).join("|")) shapeNodes.current = nodes;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const pos = useMemo(() => layoutSpace(shapeNodes.current), [shapeKey]);
	// A fixed order for label priority among equals (see declutter).
	const nodeIndex = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
	// Particles: fixed offsets per node (seeded by its id, so they don't jump
	// between renders), log-scaled to the node's result count, at most 28.
	const particles = useMemo(() => {
		const out: Array<{ node: string; dx: number; dy: number; dz: number; className: string }> = [];
		if (!evidence) return out;
		for (const n of nodes) {
			const ev = evidence(n);
			if (!ev || ev.count <= 0) continue;
			const k = Math.min(28, Math.round(4 * Math.log2(ev.count + 1)));
			let h = 2166136261;
			for (let i = 0; i < n.id.length; i++) h = Math.imul(h ^ n.id.charCodeAt(i), 16777619);
			const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
			for (let j = 0; j < k; j++) {
				const r = 16 + rnd() * 30, th = rnd() * 2 * Math.PI, ph = Math.acos(2 * rnd() - 1);
				out.push({ node: n.id, dx: r * Math.sin(ph) * Math.cos(th), dy: r * Math.cos(ph) * 0.7, dz: r * Math.sin(ph) * Math.sin(th), className: ev.className });
			}
		}
		return out;
	}, [nodes, evidence]);
	const particleEls = useRef<Array<SVGCircleElement | null>>([]);
	// The stage: floor, its rings and spokes, shadows, stems, dust.
	const floor = useMemo(() => sceneFloor(pos), [pos]);
	const dust = useMemo(() => dustField(Math.min(90, Math.round(floor.rim / 9)), floor.rim * 1.15, -floor.y - 120, floor.y), [floor]);
	// What the whole-space view frames: the NODES through a whole turn. Framing
	// their floor shadows too centred the view between the nodes and the near
	// edge of an empty floor, so the space sat crowded at the top with the lower
	// half bare (2026-11-26, "should be more balanced"). HOME_BOX leaves the
	// bottom band for the floor instead.
	const hullPts = useMemo(() => turnHull([...pos.values()]), [pos]);
	const stageEl = useRef<HTMLCanvasElement>(null);
	const colorProbe = useRef<SVGSVGElement>(null);
	const uid = useId().replace(/:/g, "");
	// Each node drifts a little on its own phase (the space breathes).
	const phase = useMemo(() => {
		const m = new Map<string, number>();
		shapeNodes.current.forEach((n, i) => m.set(n.id, (i * 2.399963) % (2 * Math.PI)));
		return m;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shapeKey]);
	// Sink and float (2026-11-26): each dot keeps its own drift clock, which
	// eases to a stop while the dot is hovered or selected — what you point at
	// decelerates where it is (no jump under the pointer); the rest keep breathing.
	const bobClock = useRef(new Map<string, { c: number; v: number }>());
	const hoveredRef = useRef<string | null>(null);
	hoveredRef.current = hovered;
	// Hover intent (2026-11-26, "hover still causes lots of flickering"): a dot
	// that opens its card on hover changes size under the pointer, and a nearby
	// dot then caught the pointer, took the hover, and the two swapped back and
	// forth (measured: 5 swaps in 3 s on a version dot). Now a node that takes
	// the hover keeps it from its neighbours for a moment, and leaving clears it
	// only after a short grace — re-entering cancels.
	const hoverLeaveTimer = useRef<number | undefined>(undefined);
	const hoverLockUntil = useRef(0);
	// A node entered while another held the lock: it takes over when the lock
	// expires, if the pointer is still on it (no second pointerenter will come).
	const hoverPending = useRef<string | null>(null);
	const hoverPendingTimer = useRef<number | undefined>(undefined);
	const enterNode = (id: string) => {
		const now = performance.now();
		if (hoveredRef.current && hoveredRef.current !== id && now < hoverLockUntil.current) {
			hoverPending.current = id;
			window.clearTimeout(hoverPendingTimer.current);
			hoverPendingTimer.current = window.setTimeout(() => {
				if (hoverPending.current === id) { hoverPending.current = null; enterNode(id); }
			}, hoverLockUntil.current - now + 10);
			return;
		}
		window.clearTimeout(hoverLeaveTimer.current);
		if (hoveredRef.current !== id) { hoverLockUntil.current = now + 300; setHovered(id); }
	};
	const leaveNode = (id: string) => {
		if (hoverPending.current === id) hoverPending.current = null;
		window.clearTimeout(hoverLeaveTimer.current);
		hoverLeaveTimer.current = window.setTimeout(() => setHovered((h) => (h === id ? null : h)), 180);
	};
	useEffect(() => () => { window.clearTimeout(hoverLeaveTimer.current); window.clearTimeout(hoverPendingTimer.current); }, []);
	// The research space moves regardless of the system's reduce-motion setting
	// (operator decision 2026-11-27: "disable reduce motion switch"). A laptop set
	// to reduce motion saw a still map with missing labels while the same page
	// turned on a phone. The rest of Studio still honours the setting. The
	// reduced paths below stay (always false here) so this is one line to undo.
	const reduced = false;

	// Mutable scene state, read by the frame loop.
	const s = useRef({
		W: 0, H: 0,
		cam: { ...HOME } as Camera,
		// Large camera moves (fly-to, fly back, Show everything, zoom buttons,
		// arrow keys) settle on a SPRING toward camTarget (2026-11-26, "large
		// motion needs spring"); direct manipulation clears it and moves 1:1.
		camTarget: null as null | Camera,
		camVel: { ...ZERO_VEL } as CameraVel,
		lastInput: 0, hover: false, lastPointerMove: 0, rampT: 0, lastT: 0, dt: 16,
		// Parked: the reader zoomed in or moved the space to look at something, so
		// it holds still (no idle turning) until Show everything or a zoom back out
		// to the overview (2026-11-26: "when zoom can show more, not rotate").
		parked: false, homeZoom: 0,
		// What the "Paused" chip last showed, and whether a dot holds KEYBOARD
		// focus (a mouse click's focus must not pause the space — it stuck the
		// turning until you clicked elsewhere, 2026-11-27 "sometimes the graph
		// stops rotation").
		parkedShown: false, kbFocus: false,
		drag: null as null | { x: number; y: number; yaw: number; pitch: number; fx: number; fy: number; pan: boolean; moved: boolean },
		// Touch: every finger down, and the two-finger gesture (move + pinch) when there are two.
		pointers: new Map<number, { x: number; y: number }>(),
		pinch: null as null | { mx: number; my: number; dist: number; fx: number; fy: number; zoom: number },
		bornAt: 0, raf: 0, framed: false,
	});
	const [, force] = useState(0);
	const kick = useRef<() => void>(() => {});

	// Size: the box's own width, the height we were given.
	useLayoutEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => {
			const { width, height: h } = e.contentRect;
			// Only a real size change re-frames (observe() reports the current size once).
			if (s.current.framed && Math.abs(width - s.current.W) < 1 && Math.abs(h - s.current.H) < 1) return;
			s.current.W = width; s.current.H = h;
			// Every size change re-frames (not only the first): enlarging or
			// shrinking the window left the space at the old zoom, off-centre and
			// at the wrong ratio (user, 2026-11-25). Instant — no fly on resize.
			if (s.current.W) {
				s.current.cam = aim.current(s.current.framed ? s.current.cam : HOME, s.current.W, s.current.H);
				s.current.camTarget = null; s.current.camVel = { ...ZERO_VEL };
				s.current.parked = false; // a re-frame is a fresh view
				s.current.framed = true;
			}
			kick.current();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Where the camera should be for what is selected (or the whole space) at
	// size W×H — used by the fly-to and by every resize. Rebuilt each render, so
	// it always sees the current selection.
	const aim = useRef<(cam: Camera, W: number, H: number) => Camera>(() => HOME);
	aim.current = (cam, W, H) => {
		// Beside the panel the camera follows the END of the path — the picked
		// node and what hangs off it; the app may sit off the left edge, its edge
		// leading in (Novix's camera follows the path the same way).
		const side = rightRef.current > 0;
		const sideIds = lit && side ? [...lit].filter((id) => nodes.find((n) => n.id === id)?.depth !== 0) : null;
		const pts = (sideIds?.length ? sideIds : lit ? [...lit] : []).map((id) => pos.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof pos.get>>[];
		// Turn so the selected branch faces the viewer, a little to the right —
		// its column reads front-on — then frame the path.
		const sel = selected ? pos.get(selected) : undefined;
		const facing = sel && Math.hypot(sel.x, sel.z) > 1 ? { ...cam, yaw: Math.atan2(sel.z, sel.x) - 0.45, pitch: -0.18 } : { ...cam, pitch: HOME.pitch };
		return lit && pts.length
			// Beside the panel: room for the labels right of the outermost dots.
			? frameCamera(pts, facing, W, H, boxAbove({ top: 56, bottom: 0.9, margin: side ? 70 : 110 }, H, insetRef.current, side ? rightRef.current + 110 : 0))
			: (() => {
				const home = frameCamera(hullPts, { ...cam, pitch: HOME.pitch }, W, H, boxAbove(HOME_BOX, H, insetRef.current, rightRef.current));
				s.current.homeZoom = home.zoom; // the overview's zoom: zooming back to it un-parks
				return home;
			})();
	};

	// Fly to the selected path, or back to the whole space.
	const first = useRef(true);
	// By content: the parent rebuilds the Set on every data refresh.
	const litKey = lit ? [...lit].sort().join("|") : "";
	const prevLit = useRef(litKey);
	useEffect(() => {
		const st = s.current;
		// Read the size now: the height may have just changed with this selection.
		if (boxRef.current) { st.W = boxRef.current.clientWidth; st.H = boxRef.current.clientHeight; }
		if (!st.W) return;
		if (first.current) { first.current = false; prevLit.current = litKey; return; }
		const selectionChanged = prevLit.current !== litKey;
		prevLit.current = litKey;
		// A reader who zoomed in or moved keeps their view when only the data or
		// the frame around it changed; a new selection (or deselect) always flies.
		if (st.parked && !selectionChanged) return;
		const to = aim.current(st.cam, st.W, st.H);
		if (!lit) st.parked = false;
		if (reduced) st.cam = to; else springTo(to);
		st.lastInput = performance.now();
		kick.current();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [litKey, pos, reduced, selected, insetRight, height, hullPts]);

	// The frame loop.
	useEffect(() => {
		const st = s.current;
		// Once per mount: re-running this effect (hover, selection) must not replay the growth.
		if (!st.bornAt) st.bornAt = performance.now();
		// Each dot's current bob (-1 sunk … +1 floated), read by its shadow, and
		// its screen offset, taken back out before labels are placed.
		const bobs = new Map<string, number>();
		const bobOff = new Map<string, [number, number]>();
		const frame = (t: number) => {
			st.raf = 0;
			const dt = Math.min(50, t - (st.lastT || t));
			st.lastT = t;
			st.dt = dt || 16;
			let moving = false;
			if (st.camTarget) {
				const r = stepCameraSpring(st.cam, st.camVel, st.camTarget, st.dt / 1000);
				st.cam = r.cam; st.camVel = r.vel;
				if (r.done) st.camTarget = null; else moving = true;
			}
			// Holds still while the pointer is MOVING over the space, or resting on a
			// dot: turning under an aiming pointer slid every dot away from what you
			// aimed at (user, 2026-11-25). A pointer left still over empty space is
			// idle, like a phone with no pointer at all — before, a laptop whose
			// mouse sat on the map never turned while the phone did (2026-11-26).
			const pointerBusy = st.hover && t - st.lastPointerMove < POINTER_REST_MS;
			// A hovered dot pauses only while the pointer is really over the space
			// (a card swapped under it can skip its pointerleave and leave the hover
			// stuck), or while it holds keyboard focus.
			const hoverHolds = !!hoveredRef.current && (st.hover || st.kbFocus);
			const wantTurn = !reduced && !st.parked && !st.drag && !st.camTarget && !pointerBusy && !hoverHolds && !lit && t - st.lastInput > AUTO_ROTATE_IDLE_MS;
			if (st.parked !== st.parkedShown) { st.parkedShown = st.parked; setParkedUi(st.parked); }
			// Test hook: whether the space is turning on its own right now.
			const turning = st.rampT > 0 ? "1" : "0";
			if (boxRef.current && boxRef.current.dataset.turning !== turning) boxRef.current.dataset.turning = turning;
			st.rampT = Math.max(0, Math.min(1, st.rampT + (wantTurn ? 1 : -1) * (dt / 400)));
			if (st.rampT > 0) { st.cam = { ...st.cam, yaw: st.cam.yaw + AUTO_ROTATE_RAD_PER_MS * dt * easeInOutCubic(st.rampT) }; moving = true; }
			if (wantTurn && st.rampT < 1) moving = true;
			const growing = grow && !reduced && t - st.bornAt < 2600;
			draw(t);
			// The drift keeps the loop alive whenever motion is allowed.
			if ((moving || growing || wantTurn || !reduced) && !document.hidden) st.raf = requestAnimationFrame(frame);
		};
		// The floor and what stands on it, painted on ONE canvas (2026-11-26,
		// "optimise speed"): as ~400 SVG elements it cost a style recalculation of
		// each one every frame (2.4 ms a frame here, ~10 ms on a 4× slower CPU).
		// Everything is drawn in world space and fades with distance (fog), so it
		// turns with the space and gives the eye a ground to read depth against.
		const SEG = RING_SEGMENTS;
		const drawStage = (t: number, world: Map<string, { x: number; y: number; z: number }>, proj: Map<string, ReturnType<typeof project>>) => {
			const { W, H, cam } = st;
			const cv = stageEl.current;
			const g = cv?.getContext("2d");
			if (!cv || !g) return;
			const C = stageColors(colorProbe.current);
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
			if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, W, H);
			const fy = floor.y;
			const at = (r: number, a: number) => project({ x: r * Math.cos(a), y: fy, z: r * Math.sin(a) }, cam, W, H);
			const fog = (sc: number) => depthCue(sc, cam.zoom).near;
			// The plane: a disc out to the rim, filled with a soft pool of light
			// (an elliptical radial gradient over the disc's box, as SVG drew it).
			{
				g.beginPath();
				let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
				for (let i = 0; i <= 48; i++) {
					const q = at(floor.rim, (i / 48) * 2 * Math.PI);
					if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y);
					x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
				}
				g.closePath();
				const rx = Math.max(1, (x1 - x0) / 2), ry = Math.max(1, (y1 - y0) / 2);
				g.save();
				g.translate((x0 + x1) / 2, (y0 + y1) / 2); g.scale(rx, ry);
				const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
				grad.addColorStop(0, C.floorCore); grad.addColorStop(0.55, C.floorMid); grad.addColorStop(1, C.floorEdge);
				g.fillStyle = grad; g.fill();
				g.restore();
			}
			// Rings: SEG arcs each, so the far side fades into the fog; the outer
			// rim is fainter still (the floor dissolves rather than ends).
			floor.rings.forEach((r, ri) => {
				const rim = ri === floor.rings.length - 1;
				g.strokeStyle = ri === 1 ? C.plum300 : C.ink300;
				g.lineWidth = ri === 1 ? 1.1 : 0.8;
				for (let k = 0; k < SEG; k++) {
					g.beginPath();
					let sc = 0;
					for (let j = 0; j <= 4; j++) {
						const q = at(r, ((k + j / 4) / SEG) * 2 * Math.PI);
						if (j) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y);
						if (j === 2) sc = q.scale;
					}
					g.globalAlpha = (0.22 + 0.5 * fog(sc)) * (rim ? 0.5 : 1);
					g.stroke();
				}
			});
			// Spokes from the inner ring to the rim, three pieces each (fog again).
			const r0 = floor.rings[0];
			g.strokeStyle = C.ink300; g.lineWidth = 0.6;
			for (let k = 0; k < SPOKES; k++) {
				const a = (k / SPOKES) * 2 * Math.PI;
				for (let j = 0; j < 3; j++) {
					const ra = r0 + (floor.rim - r0) * (j / 3), rb = r0 + (floor.rim - r0) * ((j + 1) / 3);
					const p = at(ra, a), q = at(rb, a);
					g.globalAlpha = (0.14 + 0.32 * fog((p.scale + q.scale) / 2)) * (1 - j * 0.28);
					g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
				}
			}
			// Shadows and stems. They follow each node's spring (the node lags
			// its target while the space moves; its shadow lags with it).
			const base = FOCAL / DISTANCE;
			const squash = Math.max(0.14, Math.abs(Math.sin(cam.pitch)));
			const shadowGrad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
			shadowGrad.addColorStop(0, C.shadowCore); shadowGrad.addColorStop(1, C.shadowEdge);
			g.setLineDash([2, 3]); g.lineWidth = 0.9; g.strokeStyle = C.plum300;
			for (const n of nodes) {
				const w = world.get(n.id), now = proj.get(n.id);
				if (!w || !now) continue;
				const f = project({ x: w.x, y: fy, z: w.z }, cam, W, H);
				const tgt = project(w, cam, W, H);
				const ox = now.x - tgt.x, oy = now.y - tgt.y;
				const fx = f.x + ox * 0.5, fyS = f.y + oy * 0.5;
				const dim = !!lit && !lit.has(n.id);
				const born = grow && !reduced ? Math.max(0, Math.min(1, (t - st.bornAt - (order?.get(n.id) ?? 0) * 70) / 380)) : 1;
				if (f.visible) {
					const R = (n.depth === 0 ? 22 : n.kind === "version" ? 8 : 13) * (f.scale / base) * uiScale(W, H);
					// Higher above the floor → a wider, fainter shadow; and as a dot
					// floats up its shadow spreads and pales, as it sinks the shadow
					// gathers and darkens (the bob read on the floor).
					const lift = Math.max(0, Math.min(1, (fy - w.y) / 420));
					const b = bobs.get(n.id) ?? 0;
					const spread = (1 + 0.5 * lift) * (1 + 0.16 * b);
					const op = (dim ? 0.08 : 0.35 + 0.45 * fog(f.scale)) * (1 - 0.45 * lift) * (1 - 0.25 * b) * born;
					if (op > 0.003 && R > 0) {
						g.save();
						g.translate(fx, fyS); g.scale(R * spread, R * spread * squash);
						g.globalAlpha = op; g.fillStyle = shadowGrad;
						g.beginPath(); g.arc(0, 0, 1, 0, 2 * Math.PI); g.fill();
						g.restore();
					}
				}
				// Stems only for the app and its experiments: the ring you read height
				// on. Workflows and suggestion columns would bundle into dashed poles.
				if ((n.depth === 0 || n.kind === "experiment") && f.visible && now.visible) {
					g.globalAlpha = (dim ? 0.04 : lit?.has(n.id) ? 0.7 : 0.18 + 0.4 * fog(now.scale)) * born;
					g.beginPath(); g.moveTo(now.x, now.y); g.lineTo(fx, fyS); g.stroke();
				}
			}
			g.setLineDash([]);
			// Dust: rises slowly and wraps; near motes larger and brighter.
			const span = fy - (-fy - 120);
			g.fillStyle = C.plum300;
			for (const m of dust) {
				const y = reduced ? m.y : fy - ((((fy - m.y) + t * 0.006 * m.speed) % span) + span) % span;
				const q = project({ x: m.x, y, z: m.z }, cam, W, H);
				if (!q.visible) continue;
				const near = fog(q.scale);
				// Fade in at the floor and out near the top, so motes never pop.
				const edge = Math.min(1, (fy - y) / 80, (y + fy + 120) / 80);
				const op = (0.12 + 0.4 * near) * Math.max(0, edge) * (lit ? 0.5 : 1);
				if (op <= 0.003) continue;
				// Motes are specks, not dots ("particles too big", user 2026-11-25): ≤1.4px radius.
				const rr = Math.min(1.4, Math.max(0.4, 0.6 * m.size * (q.scale / base) * (0.7 + 0.6 * near) * uiScale(W, H)));
				g.globalAlpha = op;
				g.beginPath(); g.arc(q.x, q.y, rr, 0, 2 * Math.PI); g.fill();
			}
			g.globalAlpha = 1;
		};
		const draw = (t: number) => {
			const { W, H, cam } = st;
			const ui = uiScale(W, H);
			if (!W) return;
			const proj = new Map<string, ReturnType<typeof project>>();
			const world = new Map<string, { x: number; y: number; z: number }>();
			for (const [id, p] of pos) {
				// Drift: each dot sinks and floats on its own 5–7 s period (a soft
				// second harmonic keeps it from reading as a metronome) with a little
				// sway; never the app. Its shadow answers below.
				const ph = phase.get(id) ?? 0;
				const on = !reduced && !(p.x === 0 && p.z === 0);
				let clk = bobClock.current.get(id);
				if (!clk) { clk = { c: t, v: 1 }; bobClock.current.set(id, clk); }
				const still = id === hoveredRef.current || id === selected;
				clk.v += ((still ? 0 : 1) - clk.v) * Math.min(1, st.dt / 320);
				clk.c += st.dt * clk.v;
				const c = clk.c;
				const period = BOB_MS + BOB_SPREAD_MS * (ph / (2 * Math.PI));
				const bob = on ? 0.82 * Math.sin((c / period) * 2 * Math.PI + ph) + 0.18 * Math.sin((c / period) * 4.6 * Math.PI + ph * 2.3) : 0;
				const sway = on ? 2 : 0;
				// World y grows downward: a positive bob lifts the dot.
				const q = { x: p.x + sway * Math.sin(c / 4300 + ph), y: p.y - BOB_UNITS * bob, z: p.z + sway * Math.cos(c / 4700 + ph) };
				bobs.set(id, bob);
				world.set(id, q);
				const pq = project(q, cam, W, H);
				proj.set(id, pq);
				// The bob's on-screen offset: labels are placed from the REST point,
				// so sinking and floating never decides which label shows.
				if (on) { const r0 = project({ ...q, y: p.y }, cam, W, H); bobOff.set(id, [pq.x - r0.x, pq.y - r0.y]); } else bobOff.delete(id);
			}
			// Springs (screen space). Stiffer near the app, looser further out.
			const sec = Math.min(0.033, st.dt / 1000);
			for (const n of nodes) {
				const p = proj.get(n.id);
				if (!p) continue;
				const tx = p.x, ty = p.y;
				// Hovering a node changes THAT node only (2026-11-26): neighbours no
				// longer lean toward it — other nodes moving under the pointer read as
				// the whole space reacting.
				let sp = springs.current.get(n.id);
				if (!sp) {
					// Born at its parent's spot (or its own when there is none / no motion).
					const from = !reduced && n.parent ? springs.current.get(n.parent) ?? proj.get(n.parent) : undefined;
					sp = { x: from ? from.x : tx, y: from ? from.y : ty, vx: 0, vy: 0 };
					springs.current.set(n.id, sp);
				}
				if (reduced) { sp.x = tx; sp.y = ty; sp.vx = sp.vy = 0; }
				else {
					const k = n.depth <= 0 ? 260 : n.depth === 1 ? 190 : 130;
					const c = 2 * 0.62 * Math.sqrt(k);
					sp.vx += (k * (tx - sp.x) - c * sp.vx) * sec;
					sp.vy += (k * (ty - sp.y) - c * sp.vy) * sec;
					sp.x += sp.vx * sec; sp.y += sp.vy * sec;
				}
				proj.set(n.id, { ...p, x: sp.x, y: sp.y });
			}
			drawStage(t, world, proj);
			for (const n of nodes) {
				const el = cardEls.current.get(n.id);
				const p = proj.get(n.id);
				if (!el || !p) continue;
				const cue = depthCue(p.scale, cam.zoom);
				const dim = !!lit && !lit.has(n.id);
				const born = grow && !reduced ? Math.max(0, Math.min(1, (t - st.bornAt - (order?.get(n.id) ?? 0) * 70) / 380)) : 1;
				// The selected card comes forward larger (Novix grows the picked label);
				// everything off its path all but disappears.
				const pick = n.id === selected ? 1.15 : 1;
				// One size per kind (DOT_SIZE): depth moves a dot by ~5% at most, and the
				// box size never scales it (2026-11-27: "some dots are too big, some too
				// small"). Open cards keep a little more depth.
				const floor = el.dataset.full !== undefined ? 0.85 : 0.95;
				const size = Math.max(floor, Math.min(1, (p.scale / (FOCAL / DISTANCE)) * 0.9)) * pick;
				setS(el, "transform", `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${(size * (0.9 + 0.1 * born)).toFixed(3)})`);
				setS(el, "opacity", String(((dim ? 0.42 : lit ? Math.max(0.9, cue.alpha) : cue.alpha) * born).toFixed(3)));
				// The hovered node sits above every other open card: its card must never
				// have another node's dot on top of it, or that dot takes the pointer.
				setS(el, "zIndex", String(n.id === selected ? 6000 : n.id === hoveredRef.current ? 5800 : lit?.has(n.id) ? 5000 : el.dataset.full !== undefined ? 5500 : Math.round((n.depth === 1 && n.kind === "experiment" ? 4500 : 3000) - p.depth)));
				// (First-ring experiments carry an overview panel: it sits above plain
				// dots, so a version dot never lands on its text.)
				// No blur: it read as low contrast; off-path nodes just recede (18%).
				setS(el, "filter", "none");
				setS(el, "visibility", p.visible ? "visible" : "hidden");
			}
			declutter(proj, t);
			for (const e of edges) {
				const ln = edgeEls.current.get(e.id);
				const a = proj.get(e.source), b = proj.get(e.target);
				if (!ln || !a || !b) continue;
				// A gentle curve, every edge sweeping the same way (the space reads
				// as one turning system), bent further by the child's spring velocity
				// so lines flex while the space moves and straighten as it settles.
				const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
				const bend = Math.min(46, len * 0.16);
				const v = springs.current.get(e.target);
				const mx = (a.x + b.x) / 2 - (dy / len) * bend - (v ? v.vx * 0.035 : 0);
				const my = (a.y + b.y) / 2 + (dx / len) * bend - (v ? v.vy * 0.035 : 0);
				const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
				setA(ln, "d", d);
				const onPath = !!lit && lit.has(e.source) && lit.has(e.target);
				const born = grow && !reduced ? Math.max(0, Math.min(1, (t - st.bornAt - (order?.get(e.target) ?? 0) * 70 + 120) / 380)) : 1;
				const cue = depthCue(Math.min(a.scale, b.scale), cam.zoom);
				setS(ln, "opacity", String(((lit ? (onPath ? 1 : 0.3) : 0.55 + 0.4 * cue.near) * born).toFixed(3)));
				// Hairlines at the back, a little heavier in front.
				// Hairlines at the back, heavier in front; all scaled with the box.
				ln.style.strokeWidth = ((onPath ? 2 : 1.1 + 0.6 * cue.near) * ui).toFixed(2);
				const halo = haloEls.current.get(e.id);
				if (halo) { setA(halo, "d", d); setS(halo, "opacity", String((0.55 * born).toFixed(3))); }
				const lb = labelEls.current.get(e.id);
				// The curve's midpoint (t = ½ of a quadratic) carries the label.
				if (lb) { setA(lb, "x", ((a.x + b.x) / 4 + mx / 2).toFixed(1)); setA(lb, "y", ((a.y + b.y) / 4 + my / 2 - 6).toFixed(1)); }
			}
			particles.forEach((pt, i) => {
				const c = particleEls.current[i];
				const w = world.get(pt.node);
				if (!c || !w) return;
				const q0 = project({ x: w.x + pt.dx, y: w.y + pt.dy, z: w.z + pt.dz }, cam, W, H);
				// Ride the node's spring: offset by how far the node lags its target.
				const tgt = project(w, cam, W, H), now = proj.get(pt.node);
				const q = now ? { ...q0, x: q0.x + (now.x - tgt.x), y: q0.y + (now.y - tgt.y) } : q0;
				const cue = depthCue(q.scale, cam.zoom);
				const dimP = !!lit && !lit.has(pt.node);
				const bornP = grow && !reduced ? Math.max(0, Math.min(1, (t - st.bornAt - (order?.get(pt.node) ?? 0) * 70 - 300) / 500)) : 1;
				setA(c, "cx", q.x.toFixed(1)); setA(c, "cy", q.y.toFixed(1));
				setA(c, "r", Math.min(1.6, Math.max(0.5, 0.9 * ui * q.scale / (FOCAL / DISTANCE))).toFixed(2));
				setS(c, "opacity", String((q.visible ? (dimP ? 0.03 : 0.16 + 0.38 * cue.near) * bornP : 0).toFixed(3)));
			});
		};
		// Labels that would collide are hidden, most important first: what's
		// selected or under the pointer, the app, experiments, suggestions, then
		// versions last.
		// (The hovered node is NOT ranked up: hovering one node must not hide
		// another's label.)
		const rank = (n: MapNode) => (n.id === selected ? 0 : lit?.has(n.id) ? 2 : n.depth === 0 ? 3 : n.kind === "experiment" ? 4 : n.kind === "suggested" ? 5 : 6);
		const declutter = (proj: Map<string, ReturnType<typeof project>>, t: number) => {
			const cam0 = st.cam;
			const placed: Array<[number, number, number, number]> = [];
			const hit = (b: [number, number, number, number]) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
			const items = nodes
				.map((n) => ({ n, p: proj.get(n.id), el: cardEls.current.get(n.id) }))
				.filter((x) => x.p?.visible && x.el)
				// Same rank: a label already showing goes first (it keeps its place),
				// then a fixed order. Sorting by depth made neighbours swap which one
				// showed as the space turned — labels blinked (user, 2026-11-25).
				.sort((a, b) => rank(a.n) - rank(b.n)
					|| Number(!labelState.current.get(a.n.id)?.shown) - Number(!labelState.current.get(b.n.id)?.shown)
					|| (nodeIndex.get(a.n.id) ?? 0) - (nodeIndex.get(b.n.id) ?? 0));
			for (const { n, p: pb, el } of items) {
				const o = bobOff.get(n.id);
				const p = o ? { ...pb!, x: pb!.x - o[0], y: pb!.y - o[1] } : pb;
				const size = Number(/scale\(([\d.]+)\)/.exec(el!.style.transform)?.[1] ?? 1);
				if (el!.dataset.full !== undefined) {
					// A card opened by HOVER sits on top (z) over an opaque face and
					// claims nothing: labels under it stay put, so the rest of the space
					// does not change under the pointer. Selected / path cards claim
					// their box; labels under those give way.
					if (n.id === hoveredRef.current && n.id !== selected && !lit?.has(n.id)) continue;
					// An open card claims its own box; labels under it give way.
					const w = el!.offsetWidth * size, h = el!.offsetHeight * size;
					placed.push([p!.x - w / 2, p!.y - h / 2, p!.x + w / 2, p!.y + h / 2]);
					continue;
				}
				let lab = dotLabels.current.get(n.id);
				if (!lab || !lab.w) {
					const le = el!.querySelector<HTMLElement>(".space3d-label");
					if (!le) continue;
					lab = { el: le, w: le.offsetWidth, h: le.offsetHeight };
					dotLabels.current.set(n.id, lab);
				}
				// Versions are labelled too, but the ones at the back of the space
				// drop their label (depth of field) unless their experiment is in play.
				const inPlay = lit?.has(n.id) || (n.parent && selected === n.parent);
				const quiet = n.kind === "version" && !inPlay && depthCue(p!.scale, cam0.zoom).near < 0.35;
				const off = !!lit && !lit.has(n.id);
				// Always RIGHT of the dot — a label never changes side (moving to the
				// other side when blocked read as constant flipping). Blocked, it
				// fades; it appears or disappears only once that has held ~0.45 s.
				const hh = (lab.h * size) / 2 + 1, ww = lab.w * size + 2;
				const box: [number, number, number, number] = [p!.x + 12 * size - 2, p!.y - hh, p!.x + 12 * size + ww, p!.y + hh];
				// Collide on the label's core, not its padding and halo: a slight
				// overlap is fine, hiding for it made labels blink.
				const mem = labelState.current.get(n.id) ?? { shown: false, since: 0 };
				// Spatial hysteresis on top of the timed one: a showing label holds
				// until it is overlapped a few px deeper than a hidden one needs
				// clear to appear.
				const g = mem.shown ? 3 : -2;
				const core: [number, number, number, number] = [box[0] + ww * 0.08 + g, box[1] + hh * 0.35 + g, box[2] - ww * 0.08 - g, box[3] - hh * 0.35 - g];
				labelState.current.set(n.id, mem);
				const want = !(quiet || off) && !hit(core);
				if (off) { mem.shown = false; mem.since = 0; } // dimmed by a selection: at once
				else if (want === mem.shown) mem.since = 0;
				else {
					if (!mem.since) mem.since = t;
					// Slower to hide (0.7 s) than to show (0.5 s): a brief crossing
					// leaves the label alone. Under reduced motion nothing moves, so
					// there is nothing to blink against — and the loop stops after a
					// still frame, so a delayed change would never be applied: on a
					// laptop set to reduce motion, the first load showed 0 labels at 2 s
					// and 18 of 29 after (2026-11-27). Decide at once there.
					if (reduced || t - mem.since > (want ? 500 : 700)) { mem.shown = want; mem.since = 0; }
				}
				if (mem.shown) placed.push(core);
				setS(lab.el, "opacity", mem.shown ? "" : "0");
				// A shown label or panel is part of its node (hover/click); a hidden
				// one must not catch the pointer meant for what lies under it.
				setS(lab.el, "pointerEvents", mem.shown && !off ? "auto" : "none");
			}
		};
		kick.current = () => { if (!st.raf) st.raf = requestAnimationFrame(frame); };
		const onVis = () => { if (!document.hidden) kick.current(); };
		document.addEventListener("visibilitychange", onVis);
		// Replace any frame already queued: effects declared above this one (the
		// fly-to) run first in a commit and kick with the PREVIOUS loop, whose
		// closure holds the old selection — the dimming then lagged one click
		// behind (selecting dimmed nothing; closing dimmed everything).
		cancelAnimationFrame(st.raf); st.raf = 0;
		kick.current();
		return () => { cancelAnimationFrame(st.raf); st.raf = 0; document.removeEventListener("visibilitychange", onVis); };
	}, [pos, nodes, nodeIndex, edges, lit, grow, reduced, order, selected, particles, phase, floor, dust]);

	// ── input ──────────────────────────────────────────────────────────────
	const touch = () => { s.current.lastInput = performance.now(); s.current.camTarget = null; s.current.camVel = { ...ZERO_VEL }; kick.current(); };
	// Spring the camera toward `to` (yaw the short way round); keeps the
	// current velocity, so a second press while moving blends rather than jerks.
	function springTo(to: Camera) {
		const st = s.current;
		st.camTarget = { ...to, yaw: nearestYaw(st.cam.yaw, to.yaw) };
		st.lastInput = performance.now();
		kick.current();
	}
	// Buttons and keys move by a step: spring to it, from wherever the camera is
	// already heading.
	const stepTo = (f: (c: Camera) => Camera) => {
		const st = s.current;
		const base = st.camTarget ?? st.cam;
		if (reduced) { st.cam = f(base); touch(); return; }
		springTo(f(base));
	};
	// Arrow keys: a sprung step, not a jump.
	const turn = (dyaw: number, dpitch: number) =>
		stepTo((c) => ({ ...c, yaw: c.yaw + dyaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, c.pitch + dpitch)) }));
	// Zoom about a point on screen (the cursor; the centre for keys and buttons):
	// what's under it stays under it. The floor is below the overview's own
	// minZoom, so zooming out from a big app's overview never snaps inward.
	const zoomBy = (f: number, at?: { x: number; y: number }) => {
		const st = s.current, c = st.cam;
		const zoom = Math.max(0.25, Math.min(2.6, c.zoom * f)), k = zoom / c.zoom;
		const px = at?.x ?? st.W / 2, py = at?.y ?? st.H / 2;
		st.cam = { ...c, zoom, focusX: px - st.W / 2 - (px - st.W / 2 - c.focusX) * k, focusY: py - st.H / 2 - (py - st.H / 2 - c.focusY) * k };
		// In: hold still to read. Back out to the overview's zoom: turn again.
		if (f > 1) st.parked = true;
		else if (st.homeZoom && zoom <= st.homeZoom * 1.02) st.parked = false;
		touch();
	};
	// Shift+arrows: a sprung move.
	const panStep = (dx: number, dy: number) => { s.current.parked = true; stepTo((c) => ({ ...c, focusX: c.focusX + dx, focusY: c.focusY + dy })); };
	// Zoom buttons and +/- keys: a sprung zoom about the centre.
	const zoomStep = (f: number) => {
		const st = s.current;
		if (f > 1) st.parked = true;
		stepTo((c) => {
			const zoom = Math.max(0.25, Math.min(2.6, c.zoom * f)), k = zoom / c.zoom;
			if (f < 1 && st.homeZoom && zoom <= st.homeZoom * 1.02) st.parked = false;
			return { ...c, zoom, focusX: c.focusX * k, focusY: c.focusY * k };
		});
	};
	const local = (e: { clientX: number; clientY: number }) => {
		const r = boxRef.current?.getBoundingClientRect();
		return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
	};
	const reset = () => {
		const st = s.current;
		const to = frameCamera(hullPts, HOME, st.W, st.H, boxAbove(HOME_BOX, st.H, insetRef.current, rightRef.current));
		st.homeZoom = to.zoom;
		st.parked = false;
		if (reduced) st.cam = to; else springTo(to);
		st.lastInput = performance.now();
		onSelect(null);
		kick.current();
	};
	// Drag turns the space; shift-drag, the right or middle button, or two
	// fingers move it (two fingers also pinch to zoom).
	const startPinch = () => {
		const st = s.current, [a, b] = [...st.pointers.values()];
		st.pinch = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), fx: st.cam.focusX, fy: st.cam.focusY, zoom: st.cam.zoom };
	};
	const onPointerDown = (e: React.PointerEvent) => {
		if (e.button > 2) return;
		if (hint) { setHint(false); try { sessionStorage.setItem(HINT_KEY, "1"); } catch { /* private mode */ } }
		const st = s.current;
		if (e.pointerType === "touch") {
			st.pointers.set(e.pointerId, local(e));
			if (st.pointers.size === 2) {
				// The second finger turns a turn into a move: drop the drag, keep the click suppressed.
				if (st.drag) st.drag.moved = true;
				st.drag = null;
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				startPinch();
				return;
			}
			if (st.pointers.size > 2) return;
		}
		const c = st.cam;
		st.drag = { x: e.clientX, y: e.clientY, yaw: c.yaw, pitch: c.pitch, fx: c.focusX, fy: c.focusY, pan: e.button !== 0 || e.shiftKey, moved: false };
	};
	const onPointerMove = (e: React.PointerEvent) => {
		const st = s.current;
		if (e.pointerType === "mouse") st.lastPointerMove = performance.now();
		if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, local(e));
		if (st.pinch && st.pointers.size >= 2) {
			const [a, b] = [...st.pointers.values()], p = st.pinch;
			const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
			const zoom = Math.max(0.25, Math.min(2.6, p.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist))), k = zoom / p.zoom;
			// Moved by the midpoint, scaled about it.
			st.cam = { ...st.cam, zoom, focusX: mx - st.W / 2 - (p.mx - st.W / 2 - p.fx) * k, focusY: my - st.H / 2 - (p.my - st.H / 2 - p.fy) * k };
			st.parked = true;
			touch();
			return;
		}
		const d = st.drag;
		if (!d) return;
		// Pressing the other button mid-drag (left + right together) switches the
		// drag to a move from here on — a chord arrives as a move, not a down.
		if (!d.pan && e.pointerType === "mouse" && (e.buttons & 3) === 3) {
			Object.assign(d, { pan: true, x: e.clientX, y: e.clientY, fx: st.cam.focusX, fy: st.cam.focusY, moved: true });
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			setPanning(true);
			return;
		}
		const dx = e.clientX - d.x, dy = e.clientY - d.y;
		if (!d.moved && Math.hypot(dx, dy) < 5) return;
		if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setPanning(d.pan); }
		if (d.pan) st.parked = true;
		st.cam = d.pan
			? { ...st.cam, focusX: d.fx + dx, focusY: d.fy + dy }
			: { ...st.cam, yaw: d.yaw + dx * 0.006, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, d.pitch + dy * 0.004)) };
		touch();
	};
	const endDrag = (e?: React.PointerEvent) => {
		const st = s.current;
		if (e) st.pointers.delete(e.pointerId);
		if (st.pinch) {
			if (st.pointers.size < 2) {
				st.pinch = null;
				suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
			}
			touch();
			return;
		}
		setPanning(false);
		const d = st.drag;
		st.drag = null;
		// A drag that moved must not also click the card it started on.
		if (d?.moved) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
		touch();
	};
	const suppressClick = useRef(false);
	useEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		// The wheel zooms about the cursor, with or without ctrl (2026-11-27:
		// "mouse wheel, when not pressing ctrl, should be zoom"); a trackpad pinch
		// arrives as ctrl+wheel and zooms too. Moving: drag with both buttons, the
		// right button or shift, or two fingers on a touch screen.
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * s.current.H : e.deltaY;
			zoomBy(Math.exp(-Math.max(-240, Math.min(240, dy)) * 0.0022), local(e));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	});
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.target !== e.currentTarget) return; // cards handle their own keys
		const k = e.key;
		// Shift + arrows move the space; arrows alone turn it.
		if (e.shiftKey && k.startsWith("Arrow")) panStep(k === "ArrowLeft" ? 60 : k === "ArrowRight" ? -60 : 0, k === "ArrowUp" ? 60 : k === "ArrowDown" ? -60 : 0);
		else if (k === "ArrowLeft") turn(-0.2, 0); else if (k === "ArrowRight") turn(0.2, 0);
		else if (k === "ArrowUp") turn(0, -0.12); else if (k === "ArrowDown") turn(0, 0.12);
		else if (k === "+" || k === "=") zoomStep(1.2); else if (k === "-") zoomStep(1 / 1.2);
		else if (k === "0") reset(); else if (k === "Escape") onSelect(null);
		else return;
		e.preventDefault();
	};

	// Re-render cards when selection changes (their content shows it).
	useEffect(() => { force((x) => x + 1); }, [selected]);

	return (
		<div
			ref={boxRef}
			role="group"
			aria-label="Research map in 3D. Drag to turn it; drag with both mouse buttons, the right button or shift, or drag two fingers, to move it; scroll the mouse wheel or pinch to zoom. Arrow keys turn it, shift plus arrows move it."
			tabIndex={0}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			// Right-drag moves the space; it must not open the browser menu.
			onContextMenu={(e) => e.preventDefault()}
			onPointerEnter={() => { s.current.hover = true; s.current.lastPointerMove = performance.now(); }}
			onPointerLeave={() => { s.current.hover = false; s.current.lastInput = performance.now(); kick.current(); }}
			onClick={(e) => { if (e.target === e.currentTarget && !suppressClick.current) onSelect(null); }}
			className={`space3d relative overflow-hidden rounded-xl border border-ink-200 select-none touch-none ${panning ? "cursor-move" : "cursor-grab active:cursor-grabbing"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
			style={{ height }}
		>
			<canvas ref={stageEl} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />
			{/* Palette probe: the stage canvas reads its colours from these classes once. */}
			<svg ref={colorProbe} className="absolute w-0 h-0 overflow-hidden" aria-hidden>
				<stop className="space3d-floor-core" /><stop className="space3d-floor-mid" /><stop className="space3d-floor-edge" />
				<stop className="space3d-shadow-core" /><stop className="space3d-shadow-edge" />
				<path className="stroke-ink-400" /><path className="stroke-plum-300" />
			</svg>
			<svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
				{edges.map((e) => {
					const onPath = !!lit && lit.has(e.source) && lit.has(e.target);
					return (
						<g key={e.id}>
							{onPath && (
								<path ref={(el) => { if (el) haloEls.current.set(e.id, el); else haloEls.current.delete(e.id); }}
									className="stroke-plum-200" fill="none" strokeWidth={6} strokeLinecap="round" />
							)}
							<path
								ref={(el) => { if (el) edgeEls.current.set(e.id, el); else edgeEls.current.delete(e.id); }}
								className={cn(onPath ? "stroke-plum-600 space3d-edge-flow" : e.dashed ? "stroke-ink-400 space3d-edge-dashed" : (edgeClass?.(e) ?? "stroke-plum-300"))}
								fill="none"
								strokeWidth={onPath ? 1.75 : 1}
								strokeLinecap="round"
							/>
							{onPath && e.label && (
								<text ref={(el) => { if (el) labelEls.current.set(e.id, el); else labelEls.current.delete(e.id); }}
									textAnchor="middle" className="fill-ink-700 text-nano font-medium">{e.label}</text>
							)}
						</g>
					);
				})}
				{particles.map((pt, i) => (
					<circle key={`${pt.node}:${i}`} ref={(el) => { particleEls.current[i] = el; }} className={pt.className} style={{ opacity: 0 }} />
				))}
			</svg>
			{nodes.map((n) => {
				const sel = selected === n.id;
				const dim = !!lit && !lit.has(n.id);
				// Only the selected node (and the one under the pointer) opens into a
				// card: the rest of its path stays as lit dots — the detail panel says
				// the rest, and a column of cards on a short path piled up.
				// With the detail panel open (insetRight) even the selected node stays a
				// dot, its label a bordered pill (Novix's picked label).
				// Hover opens a node's card only where the dot has nothing more to
				// show; a node with an overview panel stays put and lights up instead
				// (swapping the panel for a card moved what was under the pointer).
				const full = !renderDot || (hovered === n.id && (hoverCard?.(n) ?? true)) || (n.id === selected && !insetRight);
				return (
					<div
						key={n.id}
						ref={(el) => { if (el) cardEls.current.set(n.id, el); else cardEls.current.delete(n.id); }}
						data-kind={n.kind}
						data-dim={dim ? "" : undefined}
						data-full={full ? "" : undefined}
						className="absolute left-0 top-0 will-change-transform"
						style={{ opacity: 0 }}
						onPointerEnter={() => enterNode(n.id)}
						onPointerLeave={() => leaveNode(n.id)}
					>
						<button
							type="button"
							aria-pressed={sel}
							aria-label={describe(n)}
							onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) { s.current.kbFocus = true; setHovered(n.id); } }}
							onBlur={() => { s.current.kbFocus = false; setHovered((h) => (h === n.id ? null : h)); }}
							onClick={(e) => { e.stopPropagation(); if (suppressClick.current) return; onSelect(sel && !e.shiftKey ? null : n.id, e.shiftKey); }}
							className="block text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum-400 rounded-xl"
						>
							{/* Both stay in the DOM and only their visibility flips: swapping the
							    element under the pointer between press and release (hover opens the
							    card) swallowed the click — on touch, every tap. */}
							{renderDot && <span className={full ? "hidden" : "block"}>{renderDot(n)}</span>}
							<span className={full ? "block space3d-card-in" : "hidden"}>{renderCard(n, { selected: sel, dim })}</span>
						</button>
					</div>
				);
			})}
			<div className="absolute right-2 top-2 flex items-center gap-1 z-[6000]" onPointerDown={(e) => e.stopPropagation()}>
				{/* Zoomed in or moved: it holds still on purpose — say so, and offer the way back. */}
				{parkedUi && !lit && (
					<button type="button" onClick={reset} className="mr-1 inline-flex h-7 items-center gap-1 rounded-lg border border-ink-200 bg-card/90 px-2 text-micro text-ink-700 hover:border-ink-300 hover:text-ink-900">
						Paused while zoomed in · <span className="font-medium text-ink-900">Turn again</span>
					</button>
				)}
				<CtlButton label="Zoom in" onClick={() => zoomStep(1.2)}><Plus className="w-3.5 h-3.5" /></CtlButton>
				<CtlButton label="Zoom out" onClick={() => zoomStep(1 / 1.2)}><Minus className="w-3.5 h-3.5" /></CtlButton>
				<CtlButton label="Show everything" onClick={reset}><RotateCcw className="w-3.5 h-3.5" /></CtlButton>
				<MouseHelp />
			</div>
			{/* How to use it — until the first time you do. */}
			{hint && (
				<div className="absolute left-3 top-2.5 z-[6000] text-nano text-ink-600 pointer-events-none transition-opacity">
					Drag to turn · two fingers or both buttons to move · scroll or pinch to zoom · click a dot to open it
				</div>
			)}
		</div>
	);
}

/** A mouse drawn small, with the parts a gesture uses filled in. */
function MouseGlyph({ left, right, wheel, className = "w-3 h-4" }: { left?: boolean; right?: boolean; wheel?: boolean; className?: string }) {
	return (
		<svg viewBox="0 0 12 16" className={className} aria-hidden>
			{left && <path d="M6 1 H5 A4 4 0 0 0 1 5 V6.5 H6 Z" className="fill-plum-500" />}
			{right && <path d="M6 1 H7 A4 4 0 0 1 11 5 V6.5 H6 Z" className="fill-plum-500" />}
			<rect x="1" y="1" width="10" height="14" rx="5" className="fill-none stroke-current" strokeWidth="1.2" />
			<path d="M1 6.5 H11 M6 1 V6.5" className="stroke-current" strokeWidth="1.2" fill="none" />
			<rect x={wheel ? 4.5 : 5} y="2.4" width={wheel ? 3 : 2} height={wheel ? 3.4 : 2.6} rx="1" className={wheel ? "fill-plum-500" : "fill-current"} />
		</svg>
	);
}

/** Two fingertips dragged down: the trackpad / touch move. */
function TwoFingerGlyph({ className = "w-4 h-4" }: { className?: string }) {
	return (
		<svg viewBox="0 0 16 16" className={className} aria-hidden>
			<circle cx="5" cy="4.5" r="2.4" className="fill-plum-500" />
			<circle cx="11" cy="4.5" r="2.4" className="fill-plum-500" />
			<path d="M5 8.5 V14 M3.4 12.4 L5 14 L6.6 12.4 M11 8.5 V14 M9.4 12.4 L11 14 L12.6 12.4" className="stroke-current" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

/** How to move around, behind a small mouse icon (hover or focus to read). */
function MouseHelp() {
	const rows: Array<[ReactNode, string]> = [
		[<MouseGlyph left className="w-3.5 h-5" />, "Drag to turn"],
		[<MouseGlyph left right className="w-3.5 h-5" />, "Both buttons (or right, or shift) + drag to move"],
		[<MouseGlyph wheel className="w-3.5 h-5" />, "Scroll the wheel to zoom"],
		[<TwoFingerGlyph />, "Two-finger drag to move · pinch to zoom"],
		[<RotateCcw className="h-3.5 w-3.5" aria-hidden />, "Zoomed in or moved, it holds still; ⟲ shows everything and turns again"],
	];
	return (
		<div className="relative group">
			<button type="button" aria-label="How to move around the map" aria-describedby="space3d-help"
				onClick={(e) => e.stopPropagation()}
				className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-ink-200 bg-card/90 text-ink-700 hover:text-ink-900 hover:border-ink-300 shadow-e1">
				<MouseGlyph left right />
			</button>
			<div id="space3d-help" role="tooltip"
				className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity motion-reduce:transition-none absolute right-0 top-9 w-64 rounded-lg border border-ink-200 bg-card shadow-e2 p-2.5 grid gap-1.5">
				{rows.map(([icon, words]) => (
					<div key={words} className="flex items-center gap-2 text-caption text-ink-700">
						<span className="w-5 inline-flex justify-center text-ink-600 shrink-0">{icon}</span>{words}
					</div>
				))}
			</div>
		</div>
	);
}

function CtlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
	return (
		<button type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}
			className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-ink-200 bg-card/90 text-ink-700 hover:text-ink-900 hover:border-ink-300 shadow-e1">
			{children}
		</button>
	);
}

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
// Reduced motion: no turning, no fly-to (the camera jumps), no flow, no growth.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { MapEdge, MapNode } from "@/lib/research-map";
import {
	AUTO_ROTATE_IDLE_MS, AUTO_ROTATE_RAD_PER_MS, DISTANCE, FOCAL, HOME, PITCH_LIMIT, depthCue, easeInOutCubic, frameCamera, layoutSpace, mixCamera, project, turnHull,
	type Camera,
} from "@/lib/space3d";
import { cn } from "@/lib/utils";

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

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
	onSelect: (id: string | null) => void;
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
}

// Framing for the whole space: dots are small, so the margin only has to
// leave room for a label to the right of the outermost dot.
const HOME_BOX = { top: 40, bottom: 0.95, margin: 80 };

// A gentle spring: overshoots ~6% and settles (selection flies in, lands).
const easeOutBack = (t: number) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export default function Space3D({ nodes, edges, renderCard, renderDot, describe, selected, onSelect, lit, grow, order, height, evidence }: Space3DProps) {
	// The node under the pointer (or keyboard focus) opens into its full card.
	const [hovered, setHovered] = useState<string | null>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const cardEls = useRef(new Map<string, HTMLElement>());
	const edgeEls = useRef(new Map<string, SVGLineElement>());
	const labelEls = useRef(new Map<string, SVGTextElement>());
	// Each dot's label element and its unscaled size (text never changes).
	const dotLabels = useRef(new Map<string, { el: HTMLElement; w: number; h: number }>());
	const pos = useMemo(() => layoutSpace(nodes), [nodes]);
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
	// Each node drifts a little on its own phase (the space breathes).
	const phase = useMemo(() => {
		const m = new Map<string, number>();
		nodes.forEach((n, i) => m.set(n.id, (i * 2.399963) % (2 * Math.PI)));
		return m;
	}, [nodes]);
	const hoveredRef = useRef<string | null>(null);
	hoveredRef.current = hovered;
	const reduced = useMemo(prefersReducedMotion, []);

	// Mutable scene state, read by the frame loop.
	const s = useRef({
		W: 0, H: 0,
		cam: { ...HOME } as Camera,
		tween: null as null | { from: Camera; to: Camera; t0: number; dur: number; spring?: boolean },
		lastInput: 0, hover: false, rampT: 0, lastT: 0,
		drag: null as null | { x: number; y: number; yaw: number; pitch: number; moved: boolean },
		bornAt: 0, raf: 0, framed: false,
	});
	const [, force] = useState(0);
	const kick = useRef<() => void>(() => {});

	// Size: the box's own width, the height we were given.
	useLayoutEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => {
			s.current.W = e.contentRect.width; s.current.H = e.contentRect.height;
			if (!s.current.framed && s.current.W) { s.current.cam = frameCamera(turnHull([...pos.values()]), HOME, s.current.W, s.current.H, HOME_BOX); s.current.framed = true; }
			kick.current();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [pos]);

	// Fly to the selected path, or back to the whole space.
	const first = useRef(true);
	useEffect(() => {
		const st = s.current;
		if (!st.W) return;
		if (first.current) { first.current = false; return; }
		const pts = (lit ? [...lit] : [...pos.keys()]).map((id) => pos.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof pos.get>>[];
		// Turn so the selected branch faces the viewer, a little to the right —
		// its column of cards reads front-on — then frame the path.
		const sel = selected ? pos.get(selected) : undefined;
		const facing = sel && Math.hypot(sel.x, sel.z) > 1 ? { ...st.cam, yaw: Math.atan2(sel.z, sel.x) - 0.45, pitch: -0.18 } : { ...st.cam, pitch: HOME.pitch };
		const to = lit
			? frameCamera(pts, facing, st.W, st.H, { top: 56, bottom: 0.9, margin: 110 })
			: frameCamera(turnHull(pts), { ...st.cam, pitch: HOME.pitch }, st.W, st.H, HOME_BOX);
		if (reduced) st.cam = to; else st.tween = { from: { ...st.cam }, to, t0: performance.now(), dur: 820, spring: !!lit };
		st.lastInput = performance.now();
		kick.current();
	}, [lit, pos, reduced, selected]);

	// The frame loop.
	useEffect(() => {
		const st = s.current;
		// Once per mount: re-running this effect (hover, selection) must not replay the growth.
		if (!st.bornAt) st.bornAt = performance.now();
		const frame = (t: number) => {
			st.raf = 0;
			const dt = Math.min(50, t - (st.lastT || t));
			st.lastT = t;
			let moving = false;
			if (st.tween) {
				const k = Math.min(1, (t - st.tween.t0) / st.tween.dur);
				st.cam = mixCamera(st.tween.from, st.tween.to, st.tween.spring ? easeOutBack(k) : easeInOutCubic(k));
				if (k >= 1) st.tween = null; else moving = true;
			}
			// Keeps turning with the pointer over the space; only a node under the
			// pointer (you're reading it) or a drag holds it still.
			const wantTurn = !reduced && !st.drag && !st.tween && !hoveredRef.current && !lit && t - st.lastInput > AUTO_ROTATE_IDLE_MS;
			st.rampT = Math.max(0, Math.min(1, st.rampT + (wantTurn ? 1 : -1) * (dt / 400)));
			if (st.rampT > 0) { st.cam = { ...st.cam, yaw: st.cam.yaw + AUTO_ROTATE_RAD_PER_MS * dt * easeInOutCubic(st.rampT) }; moving = true; }
			if (wantTurn && st.rampT < 1) moving = true;
			const growing = grow && !reduced && t - st.bornAt < 2600;
			draw(t);
			// The drift keeps the loop alive whenever motion is allowed.
			if ((moving || growing || wantTurn || !reduced) && !document.hidden) st.raf = requestAnimationFrame(frame);
		};
		const draw = (t: number) => {
			const { W, H, cam } = st;
			if (!W) return;
			const proj = new Map<string, ReturnType<typeof project>>();
			const world = new Map<string, { x: number; y: number; z: number }>();
			for (const [id, p] of pos) {
				// Drift: a few units on each axis, 7–9 s periods, never for the app.
				const ph = phase.get(id) ?? 0;
				const a = reduced || p.x === 0 && p.z === 0 ? 0 : 5;
				const q = { x: p.x + a * Math.sin(t / 4300 + ph), y: p.y + a * Math.sin(t / 3700 + ph * 1.7), z: p.z + a * Math.cos(t / 4700 + ph) };
				world.set(id, q);
				proj.set(id, project(q, cam, W, H));
			}
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
				// A dot and its label stay readable however far the camera pulls back;
				// open cards keep the full depth range.
				const floor = el.dataset.full !== undefined ? 0.5 : 0.82;
				const size = Math.max(floor, Math.min(1, (p.scale / (FOCAL / DISTANCE)) * 0.9)) * (dim ? 0.92 : 1) * pick;
				el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${(size * (0.9 + 0.1 * born)).toFixed(3)})`;
				el.style.opacity = String(((dim ? 0.07 : lit ? Math.max(0.9, cue.alpha) : cue.alpha) * born).toFixed(3));
				el.style.zIndex = String(n.id === selected ? 6000 : lit?.has(n.id) ? 5000 : el.dataset.full !== undefined ? 5500 : Math.round(3000 - p.depth));
				el.style.filter = dim ? "blur(2.5px)" : cue.near < 0.2 ? "blur(0.5px)" : "none";
				el.style.visibility = p.visible ? "visible" : "hidden";
			}
			declutter(proj);
			for (const e of edges) {
				const ln = edgeEls.current.get(e.id);
				const a = proj.get(e.source), b = proj.get(e.target);
				if (!ln || !a || !b) continue;
				ln.setAttribute("x1", a.x.toFixed(1)); ln.setAttribute("y1", a.y.toFixed(1));
				ln.setAttribute("x2", b.x.toFixed(1)); ln.setAttribute("y2", b.y.toFixed(1));
				const onPath = !!lit && lit.has(e.source) && lit.has(e.target);
				const born = grow && !reduced ? Math.max(0, Math.min(1, (t - st.bornAt - (order?.get(e.target) ?? 0) * 70 + 120) / 380)) : 1;
				const cue = depthCue(Math.min(a.scale, b.scale), cam.zoom);
				ln.style.opacity = String(((lit ? (onPath ? 1 : 0.05) : 0.3 + 0.5 * cue.near) * born).toFixed(3));
				const lb = labelEls.current.get(e.id);
				if (lb) { lb.setAttribute("x", ((a.x + b.x) / 2).toFixed(1)); lb.setAttribute("y", ((a.y + b.y) / 2 - 6).toFixed(1)); }
			}
			particles.forEach((pt, i) => {
				const c = particleEls.current[i];
				const w = world.get(pt.node);
				if (!c || !w) return;
				const q = project({ x: w.x + pt.dx, y: w.y + pt.dy, z: w.z + pt.dz }, cam, W, H);
				const cue = depthCue(q.scale, cam.zoom);
				const dimP = !!lit && !lit.has(pt.node);
				const bornP = grow && !reduced ? Math.max(0, Math.min(1, (t - st.bornAt - (order?.get(pt.node) ?? 0) * 70 - 300) / 500)) : 1;
				c.setAttribute("cx", q.x.toFixed(1)); c.setAttribute("cy", q.y.toFixed(1));
				c.setAttribute("r", Math.max(0.8, 1.9 * q.scale / (FOCAL / DISTANCE)).toFixed(2));
				c.style.opacity = String((q.visible ? (dimP ? 0.04 : 0.25 + 0.5 * cue.near) * bornP : 0).toFixed(3));
			});
		};
		// Labels that would collide are hidden, most important first: what's
		// selected or under the pointer, the app, experiments, suggestions, then
		// versions last.
		const rank = (n: MapNode) => (n.id === selected ? 0 : n.id === hovered ? 1 : lit?.has(n.id) ? 2 : n.depth === 0 ? 3 : n.kind === "experiment" ? 4 : n.kind === "suggested" ? 5 : 6);
		const declutter = (proj: Map<string, ReturnType<typeof project>>) => {
			const cam0 = st.cam;
			const placed: Array<[number, number, number, number]> = [];
			const hit = (b: [number, number, number, number]) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
			const items = nodes
				.map((n) => ({ n, p: proj.get(n.id), el: cardEls.current.get(n.id) }))
				.filter((x) => x.p?.visible && x.el)
				.sort((a, b) => rank(a.n) - rank(b.n) || a.p!.depth - b.p!.depth);
			for (const { n, p, el } of items) {
				const size = Number(/scale\(([\d.]+)\)/.exec(el!.style.transform)?.[1] ?? 1);
				if (el!.dataset.full !== undefined) {
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
				const inPlay = lit?.has(n.id) || hovered === n.id || (n.parent && (hovered === n.parent || selected === n.parent));
				const quiet = n.kind === "version" && !inPlay && depthCue(p!.scale, cam0.zoom).near < 0.35;
				const off = !!lit && !lit.has(n.id);
				// Right of the dot first; if that collides, the left; else hidden.
				const hh = (lab.h * size) / 2 + 1, ww = lab.w * size + 2;
				const right: [number, number, number, number] = [p!.x + 12 * size - 2, p!.y - hh, p!.x + 12 * size + ww, p!.y + hh];
				const left: [number, number, number, number] = [p!.x - 12 * size - ww, p!.y - hh, p!.x - 12 * size + 2, p!.y + hh];
				const at = quiet || off ? null : !hit(right) ? right : !hit(left) ? left : null;
				if (at) placed.push(at);
				lab.el.style.opacity = at ? "" : "0";
				lab.el.classList.toggle("space3d-label-left", at === left);
			}
		};
		kick.current = () => { if (!st.raf) st.raf = requestAnimationFrame(frame); };
		const onVis = () => { if (!document.hidden) kick.current(); };
		document.addEventListener("visibilitychange", onVis);
		kick.current();
		return () => { cancelAnimationFrame(st.raf); st.raf = 0; document.removeEventListener("visibilitychange", onVis); };
	}, [pos, nodes, edges, lit, grow, reduced, order, selected, hovered, particles, phase]);

	// ── input ──────────────────────────────────────────────────────────────
	const touch = () => { s.current.lastInput = performance.now(); s.current.tween = null; kick.current(); };
	const turn = (dyaw: number, dpitch: number) => {
		const c = s.current.cam;
		s.current.cam = { ...c, yaw: c.yaw + dyaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, c.pitch + dpitch)) };
		touch();
	};
	const zoomBy = (f: number) => { const c = s.current.cam; s.current.cam = { ...c, zoom: Math.max(0.45, Math.min(2.2, c.zoom * f)) }; touch(); };
	const reset = () => {
		const st = s.current;
		const to = frameCamera(turnHull([...pos.values()]), HOME, st.W, st.H, HOME_BOX);
		if (reduced) st.cam = to; else st.tween = { from: { ...st.cam }, to, t0: performance.now(), dur: 600 };
		st.lastInput = performance.now();
		onSelect(null);
		kick.current();
	};
	const onPointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return;
		const c = s.current.cam;
		s.current.drag = { x: e.clientX, y: e.clientY, yaw: c.yaw, pitch: c.pitch, moved: false };
	};
	const onPointerMove = (e: React.PointerEvent) => {
		const d = s.current.drag;
		if (!d) return;
		const dx = e.clientX - d.x, dy = e.clientY - d.y;
		if (!d.moved && Math.hypot(dx, dy) < 5) return;
		if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
		s.current.cam = { ...s.current.cam, yaw: d.yaw + dx * 0.006, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, d.pitch + dy * 0.004)) };
		touch();
	};
	const endDrag = () => {
		const d = s.current.drag;
		s.current.drag = null;
		// A drag that moved must not also click the card it started on.
		if (d?.moved) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
		touch();
	};
	const suppressClick = useRef(false);
	useEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		// ⌘/ctrl + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms;
		// a plain wheel scrolls the page as usual.
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			zoomBy(Math.exp(-e.deltaY * 0.0022));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	});
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.target !== e.currentTarget) return; // cards handle their own keys
		const k = e.key;
		if (k === "ArrowLeft") turn(-0.12, 0); else if (k === "ArrowRight") turn(0.12, 0);
		else if (k === "ArrowUp") turn(0, -0.08); else if (k === "ArrowDown") turn(0, 0.08);
		else if (k === "+" || k === "=") zoomBy(1.15); else if (k === "-") zoomBy(1 / 1.15);
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
			aria-label="Research map in 3D. Drag to turn it, ⌘ or ctrl plus scroll to zoom, or use the arrow keys."
			tabIndex={0}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onPointerEnter={() => { s.current.hover = true; }}
			onPointerLeave={() => { s.current.hover = false; s.current.lastInput = performance.now(); kick.current(); }}
			onClick={(e) => { if (e.target === e.currentTarget && !suppressClick.current) onSelect(null); }}
			className="space3d relative overflow-hidden rounded-xl border border-ink-200 select-none cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			style={{ height }}
		>
			<svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
				{edges.map((e) => {
					const onPath = !!lit && lit.has(e.source) && lit.has(e.target);
					return (
						<g key={e.id}>
							<line
								ref={(el) => { if (el) edgeEls.current.set(e.id, el); else edgeEls.current.delete(e.id); }}
								className={cn(onPath ? "stroke-gold-500 space3d-edge-flow" : "stroke-ink-400", e.dashed && !onPath && "space3d-edge-dashed")}
								strokeWidth={onPath ? 2 : 1}
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
				const full = !renderDot || !!lit?.has(n.id) || hovered === n.id;
				return (
					<div
						key={n.id}
						ref={(el) => { if (el) cardEls.current.set(n.id, el); else cardEls.current.delete(n.id); }}
						data-kind={n.kind}
						data-dim={dim ? "" : undefined}
						data-full={full ? "" : undefined}
						className="absolute left-0 top-0 will-change-transform"
						style={{ opacity: 0 }}
						onPointerEnter={() => setHovered(n.id)}
						onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
					>
						<button
							type="button"
							aria-pressed={sel}
							aria-label={describe(n)}
							onFocus={() => setHovered(n.id)}
							onBlur={() => setHovered((h) => (h === n.id ? null : h))}
							onClick={(e) => { e.stopPropagation(); if (suppressClick.current) return; onSelect(sel ? null : n.id); }}
							className="block text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 rounded-xl"
						>
							{/* Both stay in the DOM and only their visibility flips: swapping the
							    element under the pointer between press and release (hover opens the
							    card) swallowed the click — on touch, every tap. */}
							{renderDot && <span className={full ? "hidden" : "block"}>{renderDot(n)}</span>}
							<span className={full ? "block" : "hidden"}>{renderCard(n, { selected: sel, dim })}</span>
						</button>
					</div>
				);
			})}
			<div className="absolute right-2 top-2 flex items-center gap-1 z-[6000]" onPointerDown={(e) => e.stopPropagation()}>
				<CtlButton label="Zoom in" onClick={() => zoomBy(1.2)}><Plus className="w-3.5 h-3.5" /></CtlButton>
				<CtlButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Minus className="w-3.5 h-3.5" /></CtlButton>
				<CtlButton label="Show everything" onClick={reset}><RotateCcw className="w-3.5 h-3.5" /></CtlButton>
			</div>
			<div className="absolute left-3 bottom-2 z-[6000] text-nano text-ink-600 pointer-events-none">
				Drag to turn · ⌘/ctrl + scroll to zoom · click a card to follow its path
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

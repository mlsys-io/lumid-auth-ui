// The research stage's height, shared by the map and its empty state so the
// page keeps its shape when the first workflow appears.
//
// It ADAPTS to whatever is free: "the research graph should align with the
// screen height" and "no scroll bar, at any resolution" (user, 2026-11-27).
// Two passes, on mount and on every resize:
//   1. estimate — from the stage's top to the visible bottom of the area that
//      scrolls it, less that area's bottom padding;
//   2. fit — after that renders, whatever the area still overflows by (gaps,
//      padding further up, anything below the stage) comes off the stage.
// So no offset is hard-coded and nothing depends on the layout around it.
// Below the minimum (STAGE_MIN_W × STAGE_MIN_H of FREE space, measured on the
// stage itself, so a hidden chat panel or collapsed sidebar counts) the space
// is not drawn at all — the caller shows "needs a larger window" instead
// ("should have at least x and y resolution", 2026-11-27).
import { useCallback, useEffect, useRef, useState } from "react";

export const STAGE_MIN_W = 500;
export const STAGE_MIN_H = 360;
const STAGE_MIN = STAGE_MIN_H;
const GAP = 4;

export interface StageSize {
	/** Put on the stage element. A callback ref, so measuring starts when the
	 *  stage actually mounts — the map renders nothing while it loads, and an
	 *  object ref read once at mount never saw the element (2026-11-27). */
	ref: (el: HTMLElement | null) => void;
	height: number;
	fits: boolean;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
	}
	return null;
}

export function useStageHeight(): StageSize {
	const [el, setEl] = useState<HTMLElement | null>(null);
	const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
	const [h, setH] = useState(() => (typeof window === "undefined" ? 600 : Math.max(STAGE_MIN, window.innerHeight - 220)));
	// Free space before clamping, and the stage's width: what decides whether it fits.
	const [free, setFree] = useState({ w: 9999, h: 9999 });
	const [tick, setTick] = useState(0); // one per estimate, so the fit pass follows it
	const estimateRef = useRef(0); // the last estimate: the most the fit may grow back to

	// Pass 1: estimate — on mount, on a window resize, when the stage's WIDTH
	// changes (the chat rail opening narrows it without any window event), and
	// when the scroll area itself resizes. Never on the stage's own height:
	// that is ours, and reacting to it would loop.
	useEffect(() => {
		if (!el) return;
		let raf = 0;
		const estimate = () => {
			const sc = scrollParent(el);
			const bottom = sc
				? sc.getBoundingClientRect().top + sc.clientHeight - (parseFloat(getComputedStyle(sc).paddingBottom) || 0)
				: window.innerHeight;
			const raw = bottom - el.getBoundingClientRect().top - GAP;
			setFree({ w: el.clientWidth, h: raw });
			estimateRef.current = Math.round(Math.max(STAGE_MIN, raw));
			setH(estimateRef.current);
			setTick((t) => t + 1);
		};
		const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(estimate); };
		raf = requestAnimationFrame(estimate);
		window.addEventListener("resize", soon);
		let lastW = el.clientWidth;
		const sc = scrollParent(el);
		const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
			for (const e of entries) {
				if (e.target === el) {
					const w = Math.round(e.contentRect.width);
					if (Math.abs(w - lastW) > 1) { lastW = w; soon(); }
				} else soon(); // the scroll area itself changed size
			}
		});
		ro?.observe(el);
		if (sc) ro?.observe(sc);
		return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", soon); ro?.disconnect(); };
	}, [el]);

	// Pass 2: fit — after each estimate, and whenever the content under the
	// scroll area changes size (a chip, the approval card, a late section),
	// take off exactly what it overflows by, or grow back into room it no longer
	// needs (never past the estimate). Each step moves toward a fixed point —
	// no overflow, no slack — so it settles instead of looping.
	useEffect(() => {
		const sc = el && scrollParent(el);
		if (!el || !sc) return;
		let raf = 0;
		const content = sc.firstElementChild as HTMLElement | null;
		const fit = () => {
			const over = sc.scrollHeight - sc.clientHeight;
			if (over > 0) {
				setFree((f) => ({ ...f, h: f.h - over }));
				setH((cur) => Math.round(Math.max(STAGE_MIN, cur - over)));
				return;
			}
			// Grow back into room a passing overflow took (a card unfolding while
			// the page loaded), never past the estimate.
			const slack = content ? Math.floor(sc.clientHeight - content.getBoundingClientRect().height) : 0;
			if (slack > 2) {
				setH((cur) => {
					const next = Math.min(estimateRef.current, cur + slack);
					if (next > cur) setFree((f) => ({ ...f, h: f.h + (next - cur) }));
					return next > cur ? next : cur;
				});
			}
		};
		raf = requestAnimationFrame(fit);
		const ro = typeof ResizeObserver === "undefined" || !content ? null
			: new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
		if (content) ro?.observe(content);
		return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
	}, [tick, el]);

	return { ref, height: h, fits: free.w >= STAGE_MIN_W && free.h >= STAGE_MIN_H };
}

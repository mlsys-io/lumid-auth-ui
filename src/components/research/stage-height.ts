// The research stage's height, shared by the map and its empty state so the
// page keeps its shape when the first workflow appears.
import { useEffect, useState, type RefObject } from "react";

/** The stage's height: from where it starts down to the bottom of the window
 *  ("the research graph should align with the screen height", 2026-11-27).
 *  Measured from the stage's own top, with the scroll offset added back, so
 *  scrolling never resizes it — only the window (or the header above it) does.
 *  Was clamp(vh − 300, 520, 680), which left a tall screen half empty. */
const STAGE_BOTTOM_GAP = 16;
const STAGE_MIN = 420;
export function useStageHeight(anchor: RefObject<HTMLElement | null>): number {
	const [h, setH] = useState(() => (typeof window === "undefined" ? 600 : Math.max(STAGE_MIN, window.innerHeight - 300)));
	useEffect(() => {
		const measure = () => {
			const el = anchor.current;
			if (!el) return;
			let scroll = 0;
			for (let p = el.parentElement; p; p = p.parentElement) {
				if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { scroll = p.scrollTop; break; }
			}
			const top = el.getBoundingClientRect().top + scroll + (scroll ? 0 : window.scrollY);
			const next = Math.round(Math.max(STAGE_MIN, window.innerHeight - top - STAGE_BOTTOM_GAP));
			setH((cur) => (Math.abs(cur - next) > 2 ? next : cur));
		};
		const raf = requestAnimationFrame(measure);
		window.addEventListener("resize", measure);
		return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
	}, [anchor]);
	return h;
}

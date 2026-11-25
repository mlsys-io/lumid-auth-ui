import { useLayoutEffect, useState, type RefObject } from "react";

/** The element's own content width, kept current — so an SVG chart can draw
 *  at real pixels (crisp 10px labels at any width) instead of scaling a fixed
 *  viewBox up and down with its container. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
	const [w, setW] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setW(el.getBoundingClientRect().width);
		const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref]);
	return w > 0 ? w : fallback;
}

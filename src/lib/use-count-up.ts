// useCountUp — animates a number from 0 → target on mount and whenever the
// target changes. Used to make "improvement" metrics (reliability %, runs,
// memories) climb rather than snap, so the surface reads as compounding.

import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, durationMs = 900): number {
	const [value, setValue] = useState(0);
	const fromRef = useRef(0);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		const from = fromRef.current;
		const delta = target - from;
		if (delta === 0) { setValue(target); return; }
		const start = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / durationMs);
			// easeOutCubic
			const e = 1 - Math.pow(1 - t, 3);
			const v = from + delta * e;
			setValue(v);
			if (t < 1) {
				rafRef.current = requestAnimationFrame(tick);
			} else {
				fromRef.current = target;
				setValue(target);
			}
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
	}, [target, durationMs]);

	return value;
}

// usePortalTarget — resolve a DOM node by id for createPortal, re-rendering
// once it mounts. Used to hoist workspace panel toggles into the always-mounted
// TopStatusStrip (the toggle owner and the target live in different subtrees).

import { useEffect, useState } from "react";

export function usePortalTarget(id: string, active = true): HTMLElement | null {
	const [el, setEl] = useState<HTMLElement | null>(null);
	useEffect(() => {
		if (!active) { setEl(null); return; }
		let raf = 0;
		const find = () => {
			const node = document.getElementById(id);
			if (node) setEl(node);
			else raf = requestAnimationFrame(find);
		};
		find();
		return () => { if (raf) cancelAnimationFrame(raf); setEl(null); };
	}, [id, active]);
	return el;
}

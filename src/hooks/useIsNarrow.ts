import { useEffect, useState } from "react";

// useIsNarrow — true when the viewport is narrower than `px` (default 1024).
// Updates on resize. Used to auto-hide side panels (sidebar, docked chat) on
// low-width screens so the center content isn't crushed.
export function useIsNarrow(px = 1024): boolean {
	const [narrow, setNarrow] = useState<boolean>(
		() => typeof window !== "undefined" && window.innerWidth < px,
	);
	useEffect(() => {
		const onResize = () => setNarrow(window.innerWidth < px);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [px]);
	return narrow;
}

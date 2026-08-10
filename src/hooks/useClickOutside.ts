// useClickOutside — popover dismissal: a mousedown anywhere outside the
// returned ref, or Escape, calls close().
//
// Extracted from StudioChat so ArtifactIconButton could move into its own
// module without dragging the chat bundle along with it. StudioChat's other
// three icon-button popovers still use it from here.
//
// The setTimeout(0) before attaching matters: without it the very click that
// OPENS a popover is still propagating when the listener attaches, so the
// handler sees it as an outside click and closes the popover immediately.

import { useEffect, useRef } from 'react';

export function useClickOutside(open: boolean, close: () => void) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (!ref.current || ref.current.contains(e.target as Node)) return;
			close();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
		const t = window.setTimeout(() => {
			document.addEventListener('mousedown', onClick);
			document.addEventListener('keydown', onKey);
		}, 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener('mousedown', onClick);
			document.removeEventListener('keydown', onKey);
		};
	}, [open, close]);
	return ref;
}

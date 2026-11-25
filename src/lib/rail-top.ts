// Whether the chat rail is showing its top panel (the global Running panel).
// The app home reads this to leave out its own Compute strip when the rail
// already shows the same thing beside it — one running panel, not two.

import { useSyncExternalStore } from "react";

let visible = false;
const subs = new Set<() => void>();

export function setRailTopVisible(v: boolean) {
	if (v === visible) return;
	visible = v;
	subs.forEach((f) => f());
}

export function useRailTopVisible(): boolean {
	return useSyncExternalStore(
		(f) => { subs.add(f); return () => subs.delete(f); },
		() => visible,
		() => false,
	);
}

import { useState } from 'react';

// Persistent expand/collapse toggle, keyed in localStorage so each user's
// preference sticks across reloads. `key` is namespaced by the caller
// (e.g. `super-admin:${key}`, `studio-sidebar:${key}`) to avoid collisions.
export function useCollapse(key: string, defaultCollapsed = true): [boolean, () => void] {
	const [collapsed, setCollapsed] = useState(() => {
		if (typeof localStorage === 'undefined') return defaultCollapsed;
		const v = localStorage.getItem(key);
		if (v === '1') return true;
		if (v === '0') return false;
		return defaultCollapsed;
	});
	const toggle = () => {
		setCollapsed((prev) => {
			const next = !prev;
			try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* private mode */ }
			return next;
		});
	};
	return [collapsed, toggle];
}

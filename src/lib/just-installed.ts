// Tracks apps the user installed THIS session that haven't yet been routed
// through the "customize your page" step. MarketplaceBrowse adds the slug-
// derived name on install; the My Apps page consumes it when the optimistic
// card flips to ready, then routes to the generate+edit flow exactly once.
//
// sessionStorage (not localStorage) so it's scoped to the tab/session and
// auto-clears — a stale entry shouldn't re-trigger customize days later.

const KEY = "studio:pending-customize:v1";

function read(): string[] {
	try {
		const raw = sessionStorage.getItem(KEY);
		const arr = raw ? JSON.parse(raw) : [];
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

function write(names: string[]) {
	try { sessionStorage.setItem(KEY, JSON.stringify([...new Set(names)])); } catch { /* ignore */ }
}

export function markPendingCustomize(name: string) {
	write([...read(), name]);
}

export function takePendingCustomize(name: string): boolean {
	const cur = read();
	if (!cur.includes(name)) return false;
	write(cur.filter((n) => n !== name));
	return true;
}

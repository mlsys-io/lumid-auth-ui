// The app's pages as one tab row, always starting with its home — the page
// with the research map. An app's declared `ui.nav` lists its own pages and
// often leaves the home out (quant-research starts at "Strategies"), so once
// you opened "Data" nothing led back to the map. If the app names its home
// itself (surface "home", e.g. mbb's "Work"), that tab is the home.

export interface PageTab { surface: string; label: string; home: boolean }

export function appPages(nav?: Array<{ surface: string; label?: string }>): PageTab[] {
	const named = (nav || []).filter((n) => n.surface);
	const tabs = named.map((n) => ({ surface: n.surface, label: n.label || n.surface, home: n.surface === "home" }));
	return tabs.some((t) => t.home) ? tabs : [{ surface: "home", label: "Graph", home: true }, ...tabs];
}

/** Where a tab goes: the home is the app's bare address (no ?surface=). */
export function pageHref(app: string, t: PageTab, embedded: boolean): string {
	const a = encodeURIComponent(app);
	if (embedded) return t.home ? `/studio/apps/${a}` : `/studio/apps/${a}?surface=${encodeURIComponent(t.surface)}`;
	return t.home ? `/studio/a/${a}` : `/studio/a/${a}/${encodeURIComponent(t.surface)}`;
}

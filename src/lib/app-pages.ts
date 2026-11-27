// The app's pages as one tab row, always starting with **Research** — the
// research space (dashboard, then the graph or list). It is the same first tab
// for every app (operator 2026-11-27: "the consulting app still has lots of
// content under the research graph — normalize with other apps"), so nothing
// an app declares can replace it or stack under it.
//
// An app's own pages follow, in its declared `ui.nav` order. An app's own home
// page (surface "home", e.g. mbb-ai's "Overview", or the default page of an app
// that declares a surface but no nav, like MBB Consultant's `ui/page.yaml`) is
// an ordinary tab, reached at ?surface=home.

export interface PageTab { surface: string; label: string; home: boolean }

/** The Research tab's id (never an app surface id). */
export const RESEARCH_TAB = "research";

export function appPages(nav?: Array<{ surface: string; label?: string }>, hasSurface = false): PageTab[] {
	const named = (nav || []).filter((n) => n.surface && n.surface !== RESEARCH_TAB);
	const own = named.map((n) => ({ surface: n.surface, label: n.label || (n.surface === "home" ? "Overview" : n.surface), home: false }));
	// A page but no nav: that page is its "Overview". An app WITH a nav names
	// every page it has; adding one it didn't name showed an empty tab.
	if (hasSurface && own.length === 0) own.push({ surface: "home", label: "Overview", home: false });
	return [{ surface: RESEARCH_TAB, label: "Research", home: true }, ...own];
}

/** Where a tab goes: Research is the app's workspace address (no ?surface=),
 *  from the standalone page too — that page has no research space. */
export function pageHref(app: string, t: PageTab, embedded: boolean): string {
	const a = encodeURIComponent(app);
	if (t.home) return `/studio/apps/${a}`;
	return embedded ? `/studio/apps/${a}?surface=${encodeURIComponent(t.surface)}` : `/studio/a/${a}/${encodeURIComponent(t.surface)}`;
}

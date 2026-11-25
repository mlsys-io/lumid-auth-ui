// Where a Research Fleet run goes, in words. Pure and tested (run-site.test.ts);
// the editor's Run button only places them.
//
// Each site runs its own FlowMesh and Lumilake, and the Lumid Data hub sits at
// home. So the choice is really "next to the data, or not": a run at home reads
// warehouse tables over the local network, a run at office reads them through
// lum.id/data. Both work (measured 2026-11-25); the difference is speed on big
// reads.

export type RunSite = "home" | "office";

export const RUN_SITES: { id: RunSite; label: string }[] = [
	{ id: "home", label: "Home" },
	{ id: "office", label: "Office" },
];

/** The site a run goes to when nobody chose: identity's default, home. */
export const DEFAULT_RUN_SITE: RunSite = "home";

export function isRunSite(s: string | null | undefined): s is RunSite {
	return s === "home" || s === "office";
}

/** One line under the picker: what this choice means for reading data. */
export function runSiteNote(site: RunSite): string {
	return site === "home"
		? "Next to the Lumid Data hub, so tables are read over the local network."
		: "Reads Lumid Data tables over the internet. Fine for small reads; pick Home for big ones.";
}

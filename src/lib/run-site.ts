// Where a Research Fleet run goes, in words. Pure and tested (run-site.test.ts);
// the editor's Run button only places them.
//
// Each site runs its own FlowMesh and Lumilake, and a Lumilake `type: lumid`
// read goes to the data hub OF THAT SITE: home and office read Lumid Data (home
// over the LAN, office through lum.id/data), NUS reads NUS Data. So the choice is
// "next to the data". All three measured working 2026-11-25.

export type RunSite = "home" | "office" | "nus";

export const RUN_SITES: { id: RunSite; label: string }[] = [
	{ id: "home", label: "Home" },
	{ id: "office", label: "Office" },
	{ id: "nus", label: "NUS" },
];

/** The site a run goes to when nobody chose: identity's default, home. */
export const DEFAULT_RUN_SITE: RunSite = "home";

export function isRunSite(s: string | null | undefined): s is RunSite {
	return s === "home" || s === "office" || s === "nus";
}

/** One line under the picker: what this choice means for reading data. */
export function runSiteNote(site: RunSite): string {
	switch (site) {
		case "home":
			return "Next to the Lumid Data hub, so tables are read over the local network.";
		case "office":
			return "Reads Lumid Data tables over the internet. Fine for small reads; pick Home for big ones.";
		case "nus":
			// type: lumid reads the hub of the site the run goes to — at NUS, NUS Data.
			// FlowMesh at NUS is admin-only at the edge today; Lumilake is open (measured 11-25).
			return "Next to NUS Data (the arXiv corpus). Lumilake graphs only, for now.";
	}
}

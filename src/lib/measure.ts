// Central measurement (phase E, 2026-11-26): where a number came from, in
// words. A feedback step may declare `service: <instrument>` — an instrument
// registered at identity's /me/measure (GET /me/measure/instruments). The
// instrument measures; identical measurements run once. These functions turn
// that into the lines the panel shows, and are pure so they can be tested.

export interface MeasureInstrument {
	name: string;
	about: string;
	share: string;
	versions: string[];
	inputs?: Record<string, string>;
}

/** Plain names for the instruments we know; anything else is shown as given. */
const NAMES: Record<string, string> = {
	"mlsys-simulator": "the MLSys simulator",
	"mlsys-sandbox": "the MLSys GPU sandbox",
	"lqt-backtest": "a backtest on recorded market history",
};

/** What reuse means for each instrument, in one sentence. */
const REUSE: Record<string, string> = {
	"mlsys-simulator": "Identical setups are measured once and reused for everyone.",
	"mlsys-sandbox": "Every run is a fresh measurement on a real GPU; it is never reused.",
	"lqt-backtest": "A backtest over a fixed past window is reused when an identical one already ran — by everyone when it read no recorded signals, otherwise only by you.",
};

export function instrumentName(service: string): string {
	return NAMES[service] ?? service.replace(/[-_]+/g, " ");
}

/**
 * "Measured by the MLSys simulator (v0.1.3). Identical setups are measured
 * once and reused for everyone." — the version only when the registry says
 * which is accepted (one version: it; several: none, rather than guess).
 */
export function measuredBy(service: string | undefined, registry?: MeasureInstrument[] | null): string | null {
	const s = (service ?? "").trim();
	if (!s) return null;
	const inst = registry?.find((i) => i.name === s);
	const version = inst && inst.versions.length === 1 ? ` (${inst.versions[0]})` : "";
	const reuse = REUSE[s] ?? (inst?.share === "global" ? "Identical measurements run once and are reused." : "");
	return `Measured by ${instrumentName(s)}${version}.${reuse ? " " + reuse : ""}`;
}

/** The instruments a feedback step may name: the registry's, else the known ones. */
export function instrumentChoices(registry?: MeasureInstrument[] | null): Array<{ value: string; label: string }> {
	const names = registry?.length ? registry.map((i) => i.name) : Object.keys(NAMES);
	return names.map((n) => ({ value: n, label: instrumentName(n) }));
}

/**
 * The line a shared experiment carries (`shared: true` in the app's spec): its
 * numbers come from one central run every install reads, so the reader knows
 * they are not their own runs and that there is nothing for them to start.
 */
export function sharedLine(e: { shared?: boolean } | null | undefined): string | null {
	return e?.shared ? "Measured once for everyone: every install reads the same central runs, so there is nothing you need to run." : null;
}

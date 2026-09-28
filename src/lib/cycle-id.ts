// A run can be addressed by either of two ids: the cycle-dir id every
// log/detail surface parses ("20260906T105726Z"), or the run store's UNIX
// SECONDS, which is what me://app-data?tool=runs reports as `run_ts` and what
// the run tree's nodes carry (`tn.run_ts`). /me/cycles/:app/:loop/:ts only
// understands the first form — passing unix seconds 404s ("Open pipeline" on a
// run-tree node did exactly that, 2026-09-28). Mirrors runTsToCycleID in
// lumid_identity/internal/handler/me_cycle_db_fallback.go: below ~1971 is not a
// unix second, so it is left alone rather than rendered as a 1970 date.
//
// Lives in lib/ (not in a component) so src/api/me.ts can normalise inside
// me.cycleDetail without importing a React component module.
export function toCycleId(ts?: string | number | null): string {
	if (ts === undefined || ts === null || ts === "") return "";
	const s = String(ts);
	if (/^[0-9]{8}T[0-9]{6}Z/.test(s)) return s;
	if (/^[0-9]+(\.[0-9]+)?$/.test(s)) {
		const n = Math.floor(Number(s));
		if (n >= 31_536_000) return new Date(n * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
	}
	return s;
}

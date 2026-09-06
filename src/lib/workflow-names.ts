// Canonical user-facing naming for the Studio surface.
//
//   App      = an installed xpio bundle
//   Workflow = one scheduled loop inside an app (backend key: "loop")
//   Run      = one execution of a workflow   (backend key: "cycle"/"ts")
//
// Backend payload keys (loop, cycle, ts) are untouched; these helpers
// translate them into display copy so the words "loop", "cycle", and
// "intent" never reach user-facing UI. Extracted from
// pages/app-revamp/loops.tsx so components don't import a page module
// for label helpers.

// Friendly display overrides for specific workflow ids — win over the raw
// backend name (e.g. "benchmark" → "NL-to-SQL" in auto-sysresearch, which
// is an NL-to-SQL config optimizer, not a generic benchmark).
const LOOP_OVERRIDE: Record<string, string> = {
	benchmark: "NL-to-SQL",
};

export function loopLabel(name?: string, fallbackLoop?: string): string {
	if (name && LOOP_OVERRIDE[name]) return LOOP_OVERRIDE[name];
	if (!name) return humanizeLoop(fallbackLoop || "");
	// The backend sets name = the loop slug for most workflows — a "name"
	// with no uppercase and no spaces is a slug, not a curated title;
	// humanize it ("momentum_research" -> "Momentum research"). Real
	// display names pass through.
	return /[A-Z\s]/.test(name) ? name : humanizeLoop(name);
}

export function humanizeLoop(loop: string): string {
	const map: Record<string, string> = {
		morning_brief: "Morning brief",
		hourly_triage: "Hourly triage",
		weekly_reflection: "Weekly reflection",
		cc_watcher: "Claude Code watcher",
	};
	if (map[loop]) return map[loop];
	return restoreAcronyms(loop.charAt(0).toUpperCase() + loop.slice(1).replace(/_/g, " "));
}

// Sentence-casing a slug lowercases domain acronyms: `kol_strategy` became
// "Kol strategy" on the trading app's workflow list. Restore the ones this
// stack actually uses — whole words only, so "Kols" or "Aim" are untouched.
const ACRONYMS = ["kol", "lqt", "pm", "ai", "ui", "api", "sql", "llm", "gpu", "etf", "pnl", "ohlc", "mbb", "vpin", "ofi"];
const ACRONYM_RE = new RegExp(`\\b(${ACRONYMS.join("|")})\\b`, "gi");

export function restoreAcronyms(s: string): string {
	return s.replace(ACRONYM_RE, (m) => m.toUpperCase());
}

// Split a workflow slug ("<app>:<loop>") into its parts. The colon only
// appears as the separator, so a missing colon means the slug IS the loop.
export function splitWorkflowSlug(slug: string): { app: string; loop: string } {
	const i = slug.indexOf(":");
	return i > 0
		? { app: slug.slice(0, i), loop: slug.slice(i + 1) }
		: { app: "", loop: slug };
}

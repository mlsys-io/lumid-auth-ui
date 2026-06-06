// Demo-build feature flags. Centralized so post-demo cleanup is a
// one-line revert (set VITE_DEMO_MODE=false, or delete this module +
// its callers).
//
// DEMO_MODE now defaults to FALSE — the default Studio experience shows
// REAL running apps (personal-agent, mbb-ai, auto-sysresearch) via the
// production AppLoops path, NOT minted demo-intent data. The minted
// IntentJournal path stays available behind the flag: set the env var to
// the literal string "true" to get the editorial demo spread back.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

// The real running apps the three-stage story is demoed against. These
// always render from live data (cycles, loop health, drafts) regardless
// of DEMO_MODE — they are the Assemble → Adapt → Compound showcase on
// REAL apps, not minted demo content.
export const RUNNING_APPS = [
	"personal-agent",
	"mbb-ai",
	"auto-sysresearch",
	// The crypto quant-research showcase — surfaced as the "Quant Research"
	// card (title in AppCard's TITLE map). Real app with 10 loops + live
	// cycle history; the card shows its top 2 workflows (momentum +
	// mean-reversion) and "+8 more".
	"auto-quant",
] as const;

// The workflow apps surfaced in the Intents "What it does" loop list.
// Kept as the running-apps set so the production AppLoops view scopes to
// the three showcase apps; widen/clear when surfacing the full tenant.
export const DEMO_WORKFLOW_APPS = RUNNING_APPS;

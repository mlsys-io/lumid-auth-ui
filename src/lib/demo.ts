// Demo-build feature flags. Centralized so post-demo cleanup is a
// one-line revert (set VITE_DEMO_MODE=false, or delete this module +
// its callers).
//
// DEMO_MODE defaults to TRUE — this branch is the demo build. Set the
// env var to the literal string "false" to get full (non-demo) behavior.

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== "false";

// The only workflow apps surfaced in the Intents "What it does" list
// during the demo. Everything else is hidden behind DEMO_MODE.
export const DEMO_WORKFLOW_APPS = ["personal-agent", "auto-sysresearch"] as const;

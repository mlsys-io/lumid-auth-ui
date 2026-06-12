// tones — the single status→color map for the Studio surface.
//
// Every health/status signal renders from these bundles instead of
// hand-rolled tailwind strings (previously duplicated across
// TopStatusStrip, apps.tsx, AppCard, WorkflowList, the observability
// panel, and MarketplaceBrowse, each with slightly different shades).
//
//   ok        emerald — last run succeeded / healthy
//   running   sky     — a run is in flight right now
//   failing   rose    — last run failed and hasn't recovered
//   attention amber   — recovered-after-retry, stale, or needs setup
//   idle      slate   — never ran / manual-only / paused
//   knowledge indigo  — memory / learning accents
//
// `statusTone()` maps the backend loops-health `status` strings
// (never|ok|failing|stale|manual — see admin_loops.go) plus the
// workflow-row shape (running/last_run_ok/last_run_recovered) onto a
// tone key, so callers never re-derive colors from raw fields.

export type ToneKey = "ok" | "running" | "failing" | "attention" | "idle" | "knowledge";

export interface ToneBundle {
	/** Solid dot / indicator backgrounds. */
	dot: string;
	/** Soft chip/pill background + hover. */
	bg: string;
	/** Foreground text on the soft background. */
	text: string;
	/** Border matching the soft background. */
	border: string;
	/** Icon-only foreground (on white). */
	icon: string;
}

export const TONES: Record<ToneKey, ToneBundle> = {
	ok: {
		dot: "bg-emerald-500",
		bg: "bg-emerald-50 hover:bg-emerald-100",
		text: "text-emerald-700",
		border: "border-emerald-200/60",
		icon: "text-emerald-600",
	},
	running: {
		dot: "bg-sky-500",
		bg: "bg-sky-50 hover:bg-sky-100",
		text: "text-sky-700",
		border: "border-sky-200/60",
		icon: "text-sky-600",
	},
	failing: {
		dot: "bg-rose-500",
		bg: "bg-rose-50 hover:bg-rose-100",
		text: "text-rose-700",
		border: "border-rose-200/60",
		icon: "text-rose-600",
	},
	attention: {
		dot: "bg-amber-500",
		bg: "bg-amber-50 hover:bg-amber-100",
		text: "text-amber-700",
		border: "border-amber-200/60",
		icon: "text-amber-600",
	},
	idle: {
		dot: "bg-slate-300",
		bg: "bg-slate-50 hover:bg-slate-100",
		text: "text-slate-600",
		border: "border-slate-200/60",
		icon: "text-slate-500",
	},
	knowledge: {
		dot: "bg-indigo-500",
		bg: "bg-indigo-50 hover:bg-indigo-100",
		text: "text-indigo-700",
		border: "border-indigo-200/60",
		icon: "text-indigo-600",
	},
};

/** Map the loops-health `status` string to a tone. */
export function statusTone(status?: string): ToneKey {
	switch (status) {
		case "ok": return "ok";
		case "failing": return "failing";
		case "stale": return "attention";
		case "manual":
		case "never": return "idle";
		default: return "idle";
	}
}

/** Map a workflow row's live fields to a tone (same precedence as the
 *  card dots: running > recovered > ok > failed > idle). */
export function workflowTone(wf: {
	running?: boolean;
	last_run_ok?: boolean | null;
	last_run_recovered?: boolean;
}): ToneKey {
	if (wf.running) return "running";
	if (wf.last_run_recovered) return "attention";
	if (wf.last_run_ok === true) return "ok";
	if (wf.last_run_ok === false) return "failing";
	return "idle";
}

/** Human label for a tone, for tooltips/badges. */
export const TONE_LABEL: Record<ToneKey, string> = {
	ok: "Healthy",
	running: "Running",
	failing: "Failing",
	attention: "Needs attention",
	idle: "Idle",
	knowledge: "Knowledge",
};

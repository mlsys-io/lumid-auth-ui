// tones — the single status→color map for the Studio surface.
//
// Every health/status signal renders from these bundles instead of
// hand-rolled tailwind strings (previously duplicated across
// TopStatusStrip, apps.tsx, AppCard, WorkflowList, the observability
// panel, and MarketplaceBrowse, each with slightly different shades).
//
//   ok        gold    — last run succeeded / healthy. Gold, NOT green: a
//                       deliberate brand call (commit cdaece6).
//   running   lagoon  — a run is in flight right now
//   failing   brick   — last run failed and hasn't recovered
//   attention ember   — recovered-after-retry, stale, or needs setup.
//                       Until 2026-11 this was the SAME gold as ok, so
//                       "healthy" and "needs attention" were indistinguishable.
//   idle      ink     — never ran / manual-only / paused
//   knowledge plum    — memory / learning accents
//
// Scales live in src/styles/palette.json (Lumen). Text uses the 700 step
// (scripts/check-contrast.mjs asserts >= 4.5:1 on the 50/100 tints).
// Status must never be colour-alone: every tone carries an `Icon`, and
// StatusBadge shows it for the states a user must act on (failing, attention).
//
// `statusTone()` maps the backend loops-health `status` strings
// (never|ok|failing|stale|manual — see admin_loops.go) plus the
// workflow-row shape (running/last_run_ok/last_run_recovered) onto a
// tone key, so callers never re-derive colors from raw fields.

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Sparkles, XOctagon, type LucideIcon } from "lucide-react";

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
	/** Icon-only foreground (on paper). */
	icon: string;
	/** The glyph that carries the status without colour. */
	Icon: LucideIcon;
}

export const TONES: Record<ToneKey, ToneBundle> = {
	ok: {
		dot: "bg-gold-500",
		bg: "bg-gold-50 hover:bg-gold-100",
		text: "text-gold-700",
		border: "border-gold-200/70",
		icon: "text-gold-600",
		Icon: CheckCircle2,
	},
	running: {
		dot: "bg-lagoon-500",
		bg: "bg-lagoon-50 hover:bg-lagoon-100",
		text: "text-lagoon-700",
		border: "border-lagoon-200/70",
		icon: "text-lagoon-600",
		Icon: Loader2,
	},
	failing: {
		dot: "bg-brick-500",
		bg: "bg-brick-50 hover:bg-brick-100",
		text: "text-brick-700",
		border: "border-brick-200/70",
		icon: "text-brick-600",
		Icon: XOctagon,
	},
	attention: {
		dot: "bg-ember-500",
		bg: "bg-ember-50 hover:bg-ember-100",
		text: "text-ember-700",
		border: "border-ember-200/70",
		icon: "text-ember-600",
		Icon: AlertTriangle,
	},
	idle: {
		dot: "bg-ink-300",
		bg: "bg-ink-50 hover:bg-ink-100",
		text: "text-ink-600",
		border: "border-ink-200/70",
		icon: "text-ink-500",
		Icon: CircleDashed,
	},
	knowledge: {
		dot: "bg-plum-500",
		bg: "bg-plum-50 hover:bg-plum-100",
		text: "text-plum-700",
		border: "border-plum-200/70",
		icon: "text-plum-600",
		Icon: Sparkles,
	},
};

/** Tones a user must act on — these always show their glyph, never a bare dot. */
export const ACTIONABLE: ReadonlySet<ToneKey> = new Set(["failing", "attention"]);

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

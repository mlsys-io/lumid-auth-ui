// Shared Studio starter prompts — the capability-aware launcher catalog.
// Used by /studio/intents (+ /studio/apps) QuickStarters and the empty-chat
// chip row in StudioChat, so both surfaces offer the same, consistently-gated
// set. Kept dependency-light (only lucide icons) so importing it doesn't pull
// page-level code into the chat bundle.

import { Sun, Mail, Search, Calendar, TrendingUp } from "lucide-react";

export interface Starter {
	icon: React.ComponentType<{ className?: string }>;
	tone: "amber" | "rose" | "sky" | "violet" | "indigo";
	title: string;
	subtitle: string;
	prompt: string;
	// Integrations this starter needs. If unmet, the launcher shows it
	// "locked" and routes to the connect page instead of composing a
	// workflow that would fail mid-conversation.
	requires?: ("google" | "microsoft")[];
}

export const CONNECT_ROUTE: Record<"google" | "microsoft", string> = {
	google: "/studio/account/connect/google",
	microsoft: "/studio/account/connect/microsoft",
};

export const STARTERS: Starter[] = [
	{
		icon: Sun,
		tone: "amber",
		title: "Daily brief",
		subtitle: "Every morning at 7am, summarize what I need to know.",
		prompt: "Set up a daily brief — every morning at 7am, summarize my email, calendar, and any pending tasks.",
		requires: ["google"],
	},
	{
		icon: Mail,
		tone: "rose",
		title: "Email triage",
		subtitle: "Watch my inbox; draft replies to anything obvious.",
		prompt: "Set up email triage — every hour during work hours, scan my inbox and draft replies to anything obvious.",
		requires: ["google"],
	},
	{
		icon: Search,
		tone: "sky",
		title: "Research assistant",
		subtitle: "Track a topic; surface what changed today.",
		prompt: "Set up a research assistant — pick a topic with me, and every morning surface the latest changes.",
	},
	{
		icon: Calendar,
		tone: "violet",
		title: "Meeting prep",
		subtitle: "Before each meeting, brief me on the attendees + context.",
		prompt: "Set up meeting prep — 30 minutes before each meeting, brief me on the attendees, prior threads, and any context I need.",
		requires: ["google"],
	},
	{
		icon: TrendingUp,
		tone: "indigo",
		title: "Compose: daily web-research brief",
		subtitle: "Assemble a brand-new workflow: research a topic and brief me each morning.",
		prompt: "Compose a brand-new daily web-research brief workflow NOW — don't ask me questions, use sensible defaults (topic: AI industry news, 8am daily). Call compose_workflow with that intent to draft it from the marketplace catalog (web search + scraping), then show me the draft so I can review, tweak the topic/schedule, and install it.",
	},
];

// missingReq returns the first unmet integration for a starter, or null.
export function missingReq(
	s: Starter,
	caps: { google: boolean; microsoft: boolean },
): ("google" | "microsoft") | null {
	for (const r of s.requires ?? []) {
		if (r === "google" && !caps.google) return "google";
		if (r === "microsoft" && !caps.microsoft) return "microsoft";
	}
	return null;
}

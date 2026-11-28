// chat-greeting — what an empty docked chat says before the first message
// (2026-11-28 sweep, gap #9). The panel used to open blank: no hint of what
// to ask, and nothing saying that approving a suggestion spends compute.
//
// Each example pre-fills the composer (the user presses send), like every
// `studio:ask`. Examples are the questions the app's own panels already ask
// (CLAUDE.md round 8: "What should I run next?", "How is it doing…").

import { APPS_KEY, COMPUTE_KEY, DATA_KEY, LIBRARY_KEY } from "@/lib/chat-scopes";

export interface ChatGreeting {
	/** One line: what this chat can help with. */
	line: string;
	/** 2–3 example asks; a click pre-fills the composer. */
	examples: string[];
	/** Said when approving a suggestion here can start runs that spend compute. */
	spendNote: string | null;
}

const SPEND_NOTE = "Approving a suggestion can start runs that spend compute (GPU time or model calls). Nothing runs until you approve it.";

/** The greeting for a docked chat on `scope` (an app slug or a virtual scope);
 *  `title` is the app's display name. */
export function chatGreeting(scope: string, title: string): ChatGreeting {
	if (scope === LIBRARY_KEY) {
		return {
			line: "Ask about what's in the Library: apps, skills and experiments.",
			examples: ["Which app here fits what I'm trying to do?", "What does installing an app run, and what does it spend?"],
			spendNote: null,
		};
	}
	if (scope === DATA_KEY) {
		return {
			line: "Ask about your data: what's there, what's in it, and how to query it.",
			examples: ["What tables do I have, and what's in each?", "Show me the newest rows of my biggest table."],
			spendNote: "Approving a suggested query or job can start work that spends compute.",
		};
	}
	if (scope === COMPUTE_KEY) {
		return {
			line: "Ask about the machines: what's free, what's running, and why a job waits.",
			examples: ["Which machines are free right now?", "Why is my latest job still waiting?"],
			spendNote: "Approving a suggested job starts it on a machine and spends its time.",
		};
	}
	if (scope === APPS_KEY) {
		return {
			line: "Ask about your apps: what they're doing and which needs you.",
			examples: ["Which of my apps needs attention?", "What ran today, and did it work?"],
			spendNote: SPEND_NOTE,
		};
	}
	const name = title.trim() || "this app";
	return {
		line: `Ask ${name} about its workflows, experiments and runs.`,
		examples: [
			`How is ${name} doing, and which version is winning so far?`,
			"What should I run next, and why?",
			"What did the last run find?",
		],
		spendNote: SPEND_NOTE,
	};
}

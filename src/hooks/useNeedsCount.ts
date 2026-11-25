// useNeedsCount — the number beside Activity in the sidebar: what's waiting for
// you, the same things Activity's "Needs you" lists (the Inbox merged into
// Activity 2026-11-25, and its count moved with it).
//
// Off the Activity page it is counted cheaply: drafts (the shell already
// polls them) + open questions, flags and drafts to approve from your apps (one
// small call a minute) + suggestions (the shared, 5-minute cached fetch). On
// Activity the page knows exactly and says so (`studio:needs`), and that wins
// while it is fresh — the sidebar and the page never disagree side by side.

import { useEffect, useState } from "react";
import { listInboxMessages } from "@/api/inbox";
import { useSuggestions } from "@/components/research/useSuggestions";

export const NEEDS_EVENT = "studio:needs";
const ATTENTION_KINDS = "question,flag,draft_pending";
const EXACT_FOR_MS = 2 * 60_000;

/** Activity's page calls this with its exact Needs-you count. */
export function publishNeedsCount(n: number) {
	window.dispatchEvent(new CustomEvent(NEEDS_EVENT, { detail: n }));
}

export function useNeedsCount(drafts: number): number {
	const sugg = useSuggestions();
	const nSugg = (sugg.items ?? []).reduce((a, x) => a + x.list.length, 0);
	const [attention, setAttention] = useState(0);
	const [exact, setExact] = useState<{ n: number; at: number } | null>(null);
	const [, tick] = useState(0);
	useEffect(() => {
		let live = true;
		const poll = () => listInboxMessages({ kind: ATTENTION_KINDS, limit: 50 })
			.then((r) => { if (live) setAttention((r.messages || []).length); })
			.catch(() => { /* soft-fail: the count just leaves these out */ });
		poll();
		const id = window.setInterval(() => { poll(); tick((x) => x + 1); }, 60_000);
		return () => { live = false; window.clearInterval(id); };
	}, []);
	useEffect(() => {
		const on = (e: Event) => setExact({ n: Number((e as CustomEvent).detail) || 0, at: Date.now() });
		window.addEventListener(NEEDS_EVENT, on);
		return () => window.removeEventListener(NEEDS_EVENT, on);
	}, []);
	if (exact && Date.now() - exact.at < EXACT_FOR_MS) return exact.n;
	return drafts + attention + nSugg;
}

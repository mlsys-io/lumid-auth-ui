// landing-pref — how opening an entity from a Studio index behaves.
//
// The Studio nav pages are claude.ai-style indexes: a light list where
// clicking a row drops you into the grounded chat (the conversational
// interface). This preference controls WHAT the chat does on landing:
//
//   'ask'  — fire the entity's default grounded prompt immediately, so
//            the inline answer / entity card streams in at once. Alive.
//   'type' — land grounded (context chip set) with the prompt pre-filled
//            but unsent, so the user can edit before sending. Deliberate.
//
// Source of truth is localStorage so it persists across sessions and
// tabs. The `storage` event keeps every open tab in sync.

import { useEffect, useState } from 'react';

export type LandingPref = 'ask' | 'type';

const KEY = 'studio_land_pref_v1';
// Default to 'type' — opening something lands you in the chat with the
// question pre-filled but UNSENT. Auto-firing a conversation on every click
// was too aggressive; users who want it opt in via Settings.
const DEFAULT: LandingPref = 'type';

export function getLandingPref(): LandingPref {
	try {
		return localStorage.getItem(KEY) === 'ask' ? 'ask' : 'type';
	} catch {
		return DEFAULT;
	}
}

export function setLandingPref(v: LandingPref): void {
	try {
		localStorage.setItem(KEY, v);
		// Notify same-tab listeners (the `storage` event only fires in OTHER
		// tabs); useLandingPref subscribes to this.
		window.dispatchEvent(new CustomEvent('studio:land-pref', { detail: v }));
	} catch { /* ignore — falls back to default */ }
}

/** React hook: current preference + setter, kept in sync across tabs. */
export function useLandingPref(): [LandingPref, (v: LandingPref) => void] {
	const [pref, setPref] = useState<LandingPref>(getLandingPref);
	useEffect(() => {
		const sync = () => setPref(getLandingPref());
		window.addEventListener('storage', sync);
		window.addEventListener('studio:land-pref', sync as EventListener);
		return () => {
			window.removeEventListener('storage', sync);
			window.removeEventListener('studio:land-pref', sync as EventListener);
		};
	}, []);
	return [pref, setLandingPref];
}

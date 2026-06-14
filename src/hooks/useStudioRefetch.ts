// useStudioRefetch — subscribe a page's load() to the chat→page
// invalidation bus. When a chat tool mutates state (run loop, pause
// schedule, send draft, …), protocol.ts dispatches `studio:data` with
// the scopes it touched (chat/effects.ts); pages re-fetch immediately
// instead of waiting out their polling interval.
//
// Degrades to the status quo (polling) if the event never fires — this
// is an accelerator, not a source of truth.

import { useEffect, useRef } from 'react';
import type { DataScope, StudioDataDetail } from '@/components/chat/effects';
import { clearMeCache } from '@/api/me';

export function useStudioRefetch(scopes: DataScope[], load: () => void): void {
	const loadRef = useRef(load);
	loadRef.current = load;
	const scopesKey = scopes.join(',');
	useEffect(() => {
		let timer: number | null = null;
		const want = new Set(scopesKey.split(',').filter(Boolean));
		const onData = (e: Event) => {
			const detail = (e as CustomEvent<StudioDataDetail>).detail;
			if (!detail?.scopes?.some((s) => want.has(s))) return;
			// A mutation just happened — drop the aggregate TTL cache so the
			// reload below sees fresh data rather than a few-second-old snapshot.
			clearMeCache();
			// Debounce: a multi-tool turn fires several events back to back.
			if (timer != null) window.clearTimeout(timer);
			timer = window.setTimeout(() => { timer = null; loadRef.current(); }, 300);
		};
		window.addEventListener('studio:data', onData as EventListener);
		return () => {
			window.removeEventListener('studio:data', onData as EventListener);
			if (timer != null) window.clearTimeout(timer);
		};
	}, [scopesKey]);
}

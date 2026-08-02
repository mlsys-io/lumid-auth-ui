// Studio view mode — Simple (default, chat-first for common users) vs
// Advanced (today's full page-based Studio, all controls). One switch drives
// the shell chrome + chat verbosity + nav. Persisted in localStorage so it
// survives reloads; a custom event + the storage event keep tabs in sync.
//
// This is UIUX only — it changes what's *shown by default*, never access or the
// backend. Advanced renders the current Studio verbatim; nothing is lost.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ViewMode = 'simple' | 'advanced';

const KEY = 'studio_view_mode';
export const VIEW_MODE_EVENT = 'studio:view-mode-changed';

function readMode(): ViewMode {
	try {
		return localStorage.getItem(KEY) === 'advanced' ? 'advanced' : 'simple';
	} catch {
		return 'simple';
	}
}

interface ViewModeCtx {
	mode: ViewMode;
	/** convenience: mode === 'advanced' — the `verbose` signal the chat gates on. */
	advanced: boolean;
	setMode: (m: ViewMode) => void;
	toggle: () => void;
}

const Ctx = createContext<ViewModeCtx>({
	mode: 'simple',
	advanced: false,
	setMode: () => {},
	toggle: () => {},
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
	const [mode, setModeState] = useState<ViewMode>(readMode);

	useEffect(() => {
		const sync = () => setModeState(readMode());
		window.addEventListener(VIEW_MODE_EVENT, sync);
		window.addEventListener('storage', sync); // cross-tab
		return () => {
			window.removeEventListener(VIEW_MODE_EVENT, sync);
			window.removeEventListener('storage', sync);
		};
	}, []);

	const setMode = (m: ViewMode) => {
		try {
			localStorage.setItem(KEY, m);
		} catch {
			/* ignore */
		}
		setModeState(m);
		window.dispatchEvent(new Event(VIEW_MODE_EVENT));
	};

	const toggle = () => setMode(mode === 'simple' ? 'advanced' : 'simple');

	return (
		<Ctx.Provider value={{ mode, advanced: mode === 'advanced', setMode, toggle }}>
			{children}
		</Ctx.Provider>
	);
}

export function useViewMode(): ViewModeCtx {
	return useContext(Ctx);
}

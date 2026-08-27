// Studio view mode — Advanced (the default: today's full page-based Studio,
// all controls) vs Simple (chat-first, chrome hidden). One switch drives the
// shell chrome + chat verbosity + nav. Persisted in localStorage so it
// survives reloads; a custom event + the storage event keep tabs in sync.
//
// This is UIUX only — it changes what's *shown by default*, never access or the
// backend. Advanced renders the current Studio verbatim; nothing is lost.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ViewMode = 'simple' | 'advanced';

const KEY = 'studio_view_mode';
export const VIEW_MODE_EVENT = 'studio:view-mode-changed';

// The Simple/Advanced chip was removed from the shell header, so nothing can
// flip this any more — `setMode`/`toggle` below have no callers and the mode is
// in practice a constant. Advanced is that constant: the chatbox opens with the
// full Studio chrome and verbose chat.
//
// Read UNCONDITIONALLY rather than honouring the persisted key. That was the
// rule when the constant was 'simple' and it still holds, only mirrored: with
// no control left, anyone carrying `studio_view_mode=simple` from before the
// chip was removed would be pinned to Simple forever. The key is still written
// by setMode and still read by nothing, deliberately — restoring the chip is a
// revert of this function, not a rewrite.
function readMode(): ViewMode {
	return 'advanced';
}

interface ViewModeCtx {
	mode: ViewMode;
	/** convenience: mode === 'advanced' — the `verbose` signal the chat gates on. */
	advanced: boolean;
	setMode: (m: ViewMode) => void;
	toggle: () => void;
}

// Matches readMode(): a consumer rendered outside the provider must not fall
// back to the opposite mode and flash the wrong chrome.
const Ctx = createContext<ViewModeCtx>({
	mode: 'advanced',
	advanced: true,
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

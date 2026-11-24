// Virtual chat scopes — the thread tags that are NOT apps.
//
// Every saved chat thread carries an `app` tag so it can be resumed in the
// place it was started. For a real app that place is /studio/apps/<slug>. Four
// first-party surfaces dock the same chat with no app behind them, so they tag
// their threads with a reserved key instead (rationale for each lives beside
// its use in StudioChat.tsx). The keys are STORAGE identifiers, never routes:
// they must stay stable so existing threads keep resolving.
//
// Kept out of StudioChat.tsx on purpose: the shell (eager chunk) needs the
// mapping below, and importing it from StudioChat would drag the whole chat
// into the first paint.

export const LIBRARY_KEY = 'lumid-library';
export const DATA_KEY = 'lumid-data-mesh';
export const APPS_KEY = 'lumid-apps';
export const COMPUTE_KEY = 'lumid-compute';

const SCOPE_HOME: Record<string, string> = {
	[LIBRARY_KEY]: '/studio/library/marketplace',
	[DATA_KEY]: '/studio/data-warehouse',
	[COMPUTE_KEY]: '/studio/research-fleet',
	[APPS_KEY]: '/studio/apps',
};

/** True for a reserved scope key (no installed app behind it). */
export function isVirtualScope(app: string | null | undefined): boolean {
	return !!app && app in SCOPE_HOME;
}

/**
 * Where a thread tagged `app` lives. Treating every tag as an app slug sent
 * Research Fleet threads to /studio/apps/lumid-compute — "No app called
 * “lumid-compute”" — and Data Warehouse / Library threads to the same dead end.
 */
export function threadHome(app: string | null | undefined): string {
	if (!app) return '/studio';
	return SCOPE_HOME[app] ?? `/studio/apps/${encodeURIComponent(app)}`;
}

/** Human label for a thread's place, for tooltips and history rows. */
export function scopeLabel(app: string): string | null {
	return app === LIBRARY_KEY ? 'Library'
		: app === DATA_KEY ? 'Data Warehouse'
		: app === COMPUTE_KEY ? 'Research Fleet'
		: app === APPS_KEY ? 'Apps'
		: null;
}

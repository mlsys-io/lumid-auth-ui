// effects — declarative maps from tool names to their UI side effects.
//
//   TOOL_EFFECTS: tool → data scopes it invalidates. When a mutating
//     tool succeeds in the chat stream, protocol.ts dispatches one
//     `studio:data` CustomEvent with these scopes; pages subscribe via
//     useStudioRefetch(scopes, load) and refetch without polling lag.
//
//   toolLink: tool + result → an in-app deep link rendered on the tool
//     chip ("Open →"). Map-driven so new tools just add a row.

export type DataScope =
	| 'apps' | 'workflows' | 'loops' | 'runs' | 'cycles'
	| 'drafts' | 'knowledge' | 'config' | 'experiments';

export const TOOL_EFFECTS: Record<string, DataScope[]> = {
	// loop / workflow execution + schedule
	run_loop: ['runs', 'cycles', 'loops', 'workflows'],
	run_loop_now: ['runs', 'cycles', 'loops', 'workflows'],
	patch_loop: ['loops', 'workflows'],
	pause_workflow: ['loops', 'workflows'],
	resume_workflow: ['loops', 'workflows'],
	delete_loop: ['loops', 'workflows', 'apps'],
	// app lifecycle
	install_app: ['apps', 'workflows', 'loops'],
	uninstall_app: ['apps', 'workflows', 'loops'],
	fork_app: ['apps'],
	update_app: ['apps', 'workflows'],
	compose_workflow: ['workflows', 'drafts'],
	add_skill_to_workflow: ['workflows', 'apps'],
	// drafts / inbox
	send_draft: ['drafts'],
	edit_draft: ['drafts'],
	dismiss_draft: ['drafts'],
	// review + config (C3 tools)
	review_action: ['cycles', 'runs'],
	app_config_set: ['apps', 'config', 'workflows'],
	// knowledge
	xp_ingest: ['knowledge'],
	xp_feedback: ['knowledge'],
	subscribe_to_bank: ['knowledge'],
};

export interface StudioDataDetail {
	scopes: DataScope[];
	tool: string;
	app?: string;
	loop?: string;
}

/** Fire the chat→page invalidation event for a successful mutating tool. */
export function dispatchToolEffects(name: string, args?: Record<string, unknown>, result?: Record<string, unknown>): void {
	const scopes = TOOL_EFFECTS[name];
	if (!scopes) return;
	const pickStr = (...vals: unknown[]) => {
		for (const v of vals) if (typeof v === 'string' && v) return v;
		return undefined;
	};
	const detail: StudioDataDetail = {
		scopes,
		tool: name,
		app: pickStr(result?.app, result?.installed_as, result?.for_app, args?.app),
		loop: pickStr(result?.loop, args?.loop),
	};
	window.dispatchEvent(new CustomEvent('studio:data', { detail }));
}

/** In-app deep link for a completed tool call, if the tool yields one. */
export function toolLink(name: string, result?: Record<string, unknown>): { to: string; label: string } | undefined {
	if (!result) return undefined;
	const appName = String(result.app || result.installed_as || result.draft_slug || result.for_app || '');
	const loop = String(result.loop || '');
	switch (name) {
		case 'install_app':
		case 'compose_workflow':
			// Closes the install loop — without it the user has no way back
			// to their new workflow without leaving the chat.
			return appName ? { to: `/studio/apps/${encodeURIComponent(appName)}`, label: 'Open' } : undefined;
		case 'run_loop':
		case 'run_loop_now':
			return appName && loop
				? { to: `/studio/apps/${encodeURIComponent(appName)}?selected=${encodeURIComponent(loop)}`, label: 'Watch' }
				: undefined;
		case 'workflow_detail':
		case 'loop_status':
			return appName && loop
				? { to: `/studio/apps/${encodeURIComponent(appName)}?selected=${encodeURIComponent(loop)}`, label: 'Open' }
				: undefined;
		case 'cycle_detail': {
			const ts = String(result.ts || result.cycle_ts || '');
			return appName && loop && ts
				? { to: `/studio/apps/${encodeURIComponent(appName)}?selected=${encodeURIComponent(loop)}&cycle=${encodeURIComponent(ts)}`, label: 'Open run' }
				: undefined;
		}
		case 'app_detail':
			return appName ? { to: `/studio/apps/${encodeURIComponent(appName)}`, label: 'Open' } : undefined;
		default:
			return undefined;
	}
}

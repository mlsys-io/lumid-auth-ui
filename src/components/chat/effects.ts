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
	| 'drafts' | 'knowledge' | 'config' | 'experiments' | 'users' | 'ui'
	| 'prompts';

export const TOOL_EFFECTS: Record<string, DataScope[]> = {
	// loop / workflow execution + schedule
	run_loop: ['runs', 'cycles', 'loops', 'workflows'],
	run_loop_now: ['runs', 'cycles', 'loops', 'workflows'],
	patch_loop: ['loops', 'workflows'],
	pause_workflow: ['loops', 'workflows'],   // handles both pause + resume (enabled flag)
	delete_loop: ['loops', 'workflows', 'apps'],
	// NOTE: no `resume_workflow` key — pause_workflow covers resume via the
	// enabled flag; there is no separate resume_workflow tool.
	// app lifecycle
	install_app: ['apps', 'workflows', 'loops'],
	uninstall_app: ['apps', 'workflows', 'loops'],
	fork_app: ['apps'],
	app_update: ['apps', 'workflows'],   // tool is named `app_update` (was mis-keyed as `update_app` → refetch never fired)
	compose_workflow: ['workflows', 'drafts'],
	add_skill_to_workflow: ['workflows', 'apps'],
	// drafts / inbox
	send_draft: ['drafts'],
	edit_draft: ['drafts'],
	dismiss_draft: ['drafts'],
	// review + config (C3 tools)
	review_action: ['cycles', 'runs'],
	app_config_set: ['apps', 'config', 'workflows'],
	// app-surface authoring (chat edits/regenerates an app's page) → re-render
	// the live surface + the app page.
	app_ui_set: ['ui', 'apps', 'config'],
	app_ui_generate: ['ui', 'apps', 'config'],
	// run lifecycle (advisory markers the trajectory/run views read).
	run_promote: ['runs', 'cycles'],
	run_discard: ['runs', 'cycles'],
	// prompt authoring (Tune tab / WS-7) — an edit/revert re-renders the
	// prompt list + the app card (semver may bump on push).
	app_prompt_set: ['prompts', 'apps'],
	app_prompt_reset: ['prompts', 'apps'],
	// branch-with-intention (WS-5) — a new attempt lands as a queued run.
	branch_run: ['runs', 'cycles', 'workflows'],
	// knowledge
	xp_ingest: ['knowledge'],
	xp_feedback: ['knowledge'],
	subscribe_to_bank: ['knowledge'],
	// admin control plane (read-only admin_users needs no entry)
	admin_set_user_role: ['users'],
	admin_set_user_status: ['users'],
	// generic app-ops bridge — a form-action/qa write can touch anything the
	// app owns, so invalidate the broad scopes the indexes/cards read.
	app_action: ['apps', 'workflows', 'loops', 'runs', 'cycles', 'drafts'],
	qa_call: ['apps', 'workflows', 'runs'],
};

export interface StudioDataDetail {
	scopes: DataScope[];
	tool: string;
	app?: string;
	loop?: string;
}

/**
 * Fire the chat→page invalidation event for a successful mutating tool.
 *
 * `scopesOverride` is the server-authoritative scope list emitted on the
 * `tool_call` event (me_agent_scopes.go). When present it wins, so a NEW
 * backend tool refetches the right pages with no change here; the local
 * TOOL_EFFECTS map is the fallback for older servers / tools not yet emitting.
 */
export function dispatchToolEffects(name: string, args?: Record<string, unknown>, result?: Record<string, unknown>, scopesOverride?: DataScope[]): void {
	const scopes = (scopesOverride && scopesOverride.length ? scopesOverride : TOOL_EFFECTS[name]);
	if (!scopes || !scopes.length) return;
	const pickStr = (...vals: unknown[]) => {
		for (const v of vals) if (typeof v === 'string' && v) return v;
		return undefined;
	};
	// Bridge loop tools (run_loop, loop_status, …) are keyed by a single `name`
	// arg shaped "app:loop" (or bare "loop") and their result carries no
	// app/loop keys — so parse name to recover the target for a scoped refetch.
	const named = nameToAppLoop(pickStr(args?.name));
	const detail: StudioDataDetail = {
		scopes,
		tool: name,
		app: pickStr(result?.app, result?.installed_as, result?.for_app, args?.app, named.app),
		loop: pickStr(result?.loop, args?.loop, named.loop),
	};
	window.dispatchEvent(new CustomEvent('studio:data', { detail }));
}

/** Split a bridge loop key "app:loop" (or bare "loop") into parts. */
function nameToAppLoop(name?: string): { app?: string; loop?: string } {
	if (!name) return {};
	const i = name.indexOf(':');
	if (i >= 0) return { app: name.slice(0, i), loop: name.slice(i + 1) };
	return { loop: name };
}

/** In-app deep link for a completed tool call, if the tool yields one. */
export function toolLink(name: string, result?: Record<string, unknown>, args?: Record<string, unknown>): { to: string; label: string } | undefined {
	if (!result) return undefined;
	// draft_slug is deliberately NOT in this chain — it names a draft, not an
	// installed app, so routing to /studio/apps/<draft_slug> 404s (see
	// compose_workflow below). Bridge loop tools fall back to args.name.
	const named = nameToAppLoop(typeof args?.name === 'string' ? args.name : undefined);
	const appName = String(result.app || result.installed_as || result.for_app || named.app || '');
	const loop = String(result.loop || named.loop || '');
	switch (name) {
		case 'install_app':
			// Closes the install loop — without it the user has no way back
			// to their new workflow without leaving the chat.
			return appName ? { to: `/studio/apps/${encodeURIComponent(appName)}`, label: 'Open' } : undefined;
		case 'compose_workflow': {
			// compose produces a DRAFT (not yet installed). Link to the HOST app
			// (for_app), never draft_slug — the draft has no app route yet.
			const host = String(result.for_app || result.app || '');
			return host ? { to: `/studio/apps/${encodeURIComponent(host)}`, label: 'Open' } : undefined;
		}
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
		case 'app_ui_set':
		case 'app_ui_generate': {
			// Land on the surface the chat just authored so the user sees it.
			const surface = String(result.surface || '');
			const sfx = surface && surface !== 'home' ? `/${encodeURIComponent(surface)}` : '';
			return appName ? { to: `/studio/a/${encodeURIComponent(appName)}${sfx}`, label: 'View page' } : undefined;
		}
		case 'app_prompt_set':
		case 'app_prompt_reset':
			// Land on the app's prompt editor so the user sees the edited prompt.
			return appName ? { to: `/studio/a/${encodeURIComponent(appName)}/prompts`, label: 'Open prompts' } : undefined;
		case 'branch_run': {
			// A branch queues a new run on the loop — link to it being watched.
			const bl = String(result.loop || args?.loop || named.loop || '');
			return appName && bl
				? { to: `/studio/apps/${encodeURIComponent(appName)}?selected=${encodeURIComponent(bl)}`, label: 'Watch' }
				: undefined;
		}
		case 'app_action': {
			// GPU rental create returns a task_id → link to the live rental.
			const taskID = String(result.task_id || '');
			if (taskID) return { to: `/studio/a/lumid-gpu-rentals/${encodeURIComponent(taskID)}`, label: 'Open' };
			return appName ? { to: `/studio/a/${encodeURIComponent(appName)}?full=1`, label: 'Open' } : undefined;
		}
		default:
			return undefined;
	}
}

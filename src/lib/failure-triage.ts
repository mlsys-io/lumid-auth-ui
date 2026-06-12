// failure-triage — classify a workflow's raw error strings into
// actionable categories with a CTA, instead of dumping 220 chars of
// mono text on the user.
//
// Live fixtures this was built against (2026-06-11):
//   - personal-agent hourly_triage: "Google isn't connected yet"  → oauth_google
//   - mbb-ai case_cycle: "cannot import name 'analyst' from 'skills'" → skill_import
//
// `cta.ask` routes the fix into the chat rail (chat is the action
// surface); `cta.to` navigates (e.g. the Google connect page).

export type FailureKind =
	| 'oauth_google'
	| 'oauth_microsoft'
	| 'skill_import'
	| 'missing_secret'
	| 'rate_limit'
	| 'llm_backend'
	| 'unknown';

export interface FailureTriage {
	kind: FailureKind;
	/** Short human label, e.g. "Google not connected". */
	label: string;
	/** One sentence: what's wrong and what fixing it unblocks. */
	explanation: string;
	cta?: {
		label: string;
		/** Navigate… */
		to?: string;
		/** …or hand to the chat rail (studio:ask, autosend). */
		ask?: string;
	};
}

export function triageFailure(error: string, app?: string, loop?: string): FailureTriage {
	const e = String(error || '');
	const where = app && loop ? ` in ${app}'s ${loop}` : app ? ` in ${app}` : '';

	if (/google.*(isn't|is not|not).*(connect|authoriz)|invalid_grant|google (token|oauth|credential)/i.test(e)) {
		return {
			kind: 'oauth_google',
			label: 'Google not connected',
			explanation: 'This workflow reads your Gmail/Calendar but the Google connection is missing or expired. Runs will keep failing until it\'s reconnected.',
			cta: { label: 'Connect Google', to: '/studio/account/connect/google' },
		};
	}
	if (/microsoft|outlook.*(connect|authoriz|token)/i.test(e) && /(isn't|is not|not|expired|invalid)/i.test(e)) {
		return {
			kind: 'oauth_microsoft',
			label: 'Microsoft not connected',
			explanation: 'This workflow needs your Microsoft account but the connection is missing or expired.',
			cta: { label: 'Connect Microsoft', to: '/studio/account/connect/microsoft' },
		};
	}
	if (/cannot import name|ModuleNotFoundError|ImportError|skill .* not found|skill card missing|prompt card .* not found/i.test(e)) {
		return {
			kind: 'skill_import',
			label: 'Missing skill or prompt',
			explanation: 'The app references a skill or prompt card that isn\'t installed — usually a skill_imports[] entry that didn\'t get pulled. Updating the app re-pulls its imports.',
			cta: {
				label: 'Fix it',
				ask: `My workflow${where} is failing with: "${e.slice(0, 180)}". Diagnose the missing skill import and fix it (try updating the app to re-pull skill_imports).`,
			},
		};
	}
	if (/missing (api[_ ]?key|secret|token)|API key|credential.* (missing|empty|not set)|env(ironment)? var/i.test(e)) {
		return {
			kind: 'missing_secret',
			label: 'Missing credential',
			explanation: 'A required API key or secret isn\'t configured for this app.',
			cta: {
				label: 'Fix it',
				ask: `My workflow${where} is failing with a missing credential: "${e.slice(0, 160)}". What secret does it need and where do I set it?`,
			},
		};
	}
	if (/429|rate.?limit|quota.*exceed|budget exhausted/i.test(e)) {
		return {
			kind: 'rate_limit',
			label: 'Rate limited',
			explanation: 'An upstream service is rate-limiting this workflow. It usually recovers on its own; consider spacing the schedule out.',
			cta: {
				label: 'Adjust schedule',
				ask: `My workflow${where} is hitting rate limits. Suggest and apply a less aggressive schedule.`,
			},
		};
	}
	if (/IncompleteRead|claude exited|no text \(stream\)|LLM|model.*(offline|unavailable)|503/i.test(e)) {
		return {
			kind: 'llm_backend',
			label: 'Model backend hiccup',
			explanation: 'The LLM backend dropped or refused a call mid-run. These are usually transient — the next scheduled run often succeeds.',
			cta: {
				label: 'Run again now',
				ask: `My workflow${where} failed with an LLM backend error ("${e.slice(0, 120)}"). Fire a one-off run now and tell me if it recovers.`,
			},
		};
	}
	return {
		kind: 'unknown',
		label: 'Run failed',
		explanation: 'The last run failed and hasn\'t recovered yet.',
		cta: {
			label: 'Diagnose in chat',
			ask: `My workflow${where} is failing with: "${e.slice(0, 200)}". Look at the last run and tell me what's wrong and how to fix it.`,
		},
	};
}

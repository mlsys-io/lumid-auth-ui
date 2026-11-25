// How a paused Claude pool account is actually behaving. Shared by the admin
// accounts table (studio/claude-quota) and the pool-manager page
// (account/claude-pool).
//
// The pill used to say only "paused", whatever was really happening. On
// 2026-11-25 ac5 was "paused" while it served 70-90% of traffic for about
// 50 minutes, and then while identity's availability backstop kept serving it
// because the pool had nothing else free. The operator could not see either.

// How recently the backstop must have fired for the pause to count as not
// holding. Identity writes the stamp at most once a minute per replica, and
// the accounts table does not auto-refresh, so this is generous on purpose.
export const OVERRIDE_WINDOW_MS = 10 * 60_000;

export type PauseState =
	| { kind: 'none' }
	// Inside the pin grace: live sessions are still served, and they move at
	// enforcedAt.
	| { kind: 'grace'; enforcedAt: Date }
	// Grace over, and nothing has overridden it recently.
	| { kind: 'holding' }
	// The backstop served this paused account recently. The pause is not
	// holding.
	| { kind: 'overridden'; at: Date };

export interface PausableAccount {
	draining_since?: string;
	pause_enforced_at?: string;
	drain_overridden_at?: string;
}

function parse(iso?: string): Date | null {
	if (!iso || iso.startsWith('0001')) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function pauseState(a: PausableAccount, now: Date = new Date()): PauseState {
	if (!parse(a.draining_since)) return { kind: 'none' };
	const over = parse(a.drain_overridden_at);
	if (over && now.getTime() - over.getTime() < OVERRIDE_WINDOW_MS) {
		return { kind: 'overridden', at: over };
	}
	const enf = parse(a.pause_enforced_at);
	// An older identity does not send pause_enforced_at. Show plain "paused"
	// rather than inventing a deadline.
	if (enf && enf.getTime() > now.getTime()) return { kind: 'grace', enforcedAt: enf };
	return { kind: 'holding' };
}

function clock(d: Date): string {
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Short pill text. */
export function pauseLabel(s: PauseState): string {
	switch (s.kind) {
		case 'grace': return `paused · live sessions move ${clock(s.enforcedAt)}`;
		case 'overridden': return 'paused · still serving';
		case 'holding': return 'paused';
		default: return '';
	}
}

/** Tooltip: what is happening and what the operator can do about it. */
export function pauseExplain(s: PauseState): string {
	switch (s.kind) {
		case 'grace':
			return `Takes no new sessions. Conversations already on it keep this account until ${clock(s.enforcedAt)}, ` +
				'then move to another account (one switch per conversation). Idle users have already been moved.';
		case 'overridden':
			return `The pause is NOT holding: at ${clock(s.at)} no other account in this pool was free, so the pool ` +
				'served this paused account rather than refusing users. Add or resume an account, or wait for a ' +
				'sibling\'s quota window to reset.';
		case 'holding':
			return 'Paused and holding: it takes no sessions. It stays paused until someone resumes it.';
		default:
			return '';
	}
}

/** Pause confirmation text, matching the backend's actual behaviour. */
export function pauseConfirmText(email: string): string {
	return `Pause ${email}?\n\n` +
		'It stops taking NEW sessions right away, and idle users move off now. Conversations already on it ' +
		'keep it for a short grace period (5 min), then move to another account, one switch each. ' +
		'Nobody is refused.\n\n' +
		'If no other account in the pool is free, the pool will still serve this one rather than refuse ' +
		'users; the row will say so.';
}

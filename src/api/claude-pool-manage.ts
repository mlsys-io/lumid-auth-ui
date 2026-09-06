// Delegated Claude-pool management — the DELEGATE's own surface.
//
// Deliberately its own module rather than a corner of super-admin.ts: a
// delegate holds no role, and a user-facing page importing an admin client
// invites someone to reach for an admin call that will 403 for its actual
// audience.
//
// The server is the authority on who may see this. `fetchClaudePoolManage`
// answers 200 with an empty roster for everyone who has not been granted, so
// callers decide visibility from the DATA, never from a role check — and every
// write is independently enforced server-side, so hiding is presentation only.

import apiClient from './client';
import type { DataResponse } from './types';

export interface ManagedPool {
	id: string;
	name: string;
	mode: 'distributed' | 'conservative';
	allow_onprem?: boolean;
	allow_openrouter?: boolean;
}

export interface ManagedAccount {
	email: string;
	pool_id: string;
	label?: string;
	draining_since?: string;
	drain_reason?: string;
	revoked?: boolean;
}

export interface ManagedMember {
	user_sub: string;
	email: string;
	pool_id: string;
}

export interface ClaudePoolManageRoster {
	pools: ManagedPool[];
	accounts: ManagedAccount[];
	members: ManagedMember[];
}

// Empty roster = "you manage nothing". NOT an error: every session may call
// this on load, so the server answers 200 rather than 403.
export async function fetchClaudePoolManage(): Promise<ClaudePoolManageRoster> {
	const r = await apiClient.get<DataResponse<ClaudePoolManageRoster>>('/api/v1/me/claude-pool/manage');
	return r.data.data;
}

// Pause (draining=true) or resume (false) one account in a pool you manage.
// The server refuses to pause a pool's last usable account.
export async function manageDrainAccount(
	email: string,
	draining: boolean,
	reason?: string,
): Promise<void> {
	await apiClient.post(
		`/api/v1/me/claude-pool/accounts/${encodeURIComponent(email)}/drain`,
		{ draining, reason: reason ?? '' },
	);
}

// Reset one member's usage clock. A target is REQUIRED — unlike the admin
// endpoint, the delegated form has no "reset everyone" shape at all.
export async function manageResetWindow(
	userSub: string,
	window?: string,
): Promise<{ rows: number; window: string }> {
	const r = await apiClient.post<DataResponse<{ rows: number; window: string }>>(
		'/api/v1/me/claude-pool/reset-window',
		{ user_sub: userSub, window: window ?? '' },
	);
	return r.data.data;
}

import apiClient from './client';
import type { DataResponse } from './types';

// Canonical scope shape is `<service>:<level>` where level is
// `read` / `write` / `admin`, plus the special `*` for global admin
// and `<service>:*` (treated as service-wide admin).
//
// Legacy flat QuantArena scopes (`read` / `trading` / `strategy` /
// `admin` / `*`) still parse correctly on the backend — existing
// tokens keep working — but new tokens should always be minted with
// the namespaced shape so the access matrix lights up.
export type Scope = string;

// Level ladder used by the picker + gate. Keep in sync with the
// backend's levelRank() in admin_users.go.
export type ScopeLevel = 'none' | 'read' | 'write' | 'admin';

export const SCOPE_SERVICES = [
	'lumid',
	'qa',
	'runmesh',
	'lumilake',
	'flowmesh',
	'xpcloud',
] as const;
export type ScopeService = (typeof SCOPE_SERVICES)[number];

export interface PATInfo {
	id: number;
	name: string;
	token_prefix: string;
	scopes: Scope[];
	status: 'active' | 'revoked' | 'expired';
	last_used_at: number;
	expires_at: number;
	revoked_at: number;
	create_time: number;
}

export interface MintPATResponse extends PATInfo {
	token: string; // cleartext — shown once
}

export interface PATAccessLogEntry {
	timestamp: number;
	source: string;
	method: string;
	path: string;
	status: number;
	duration_ms: number;
	ip: string;
	user_agent: string;
}

export async function mintPAT(payload: {
	name: string;
	scopes: Scope[];
	ttl_days?: number;
}): Promise<MintPATResponse> {
	const r = await apiClient.post<DataResponse<MintPATResponse>>(
		'/api/v1/identity/personal-access-tokens',
		payload,
	);
	return r.data.data;
}

export async function listPATs(): Promise<PATInfo[]> {
	const r = await apiClient.get<DataResponse<{ tokens: PATInfo[] }>>(
		'/api/v1/identity/personal-access-tokens',
	);
	return r.data.data?.tokens ?? [];
}

export async function revokePAT(patId: number): Promise<void> {
	await apiClient.delete(`/api/v1/identity/personal-access-tokens/${patId}`);
}

export async function getPATAccessLog(patId: number): Promise<PATAccessLogEntry[]> {
	const r = await apiClient.get<DataResponse<{ entries: PATAccessLogEntry[] }>>(
		`/api/v1/identity/personal-access-tokens/${patId}/access-log`,
	);
	return r.data.data?.entries ?? [];
}

// Scope preset metadata — drives the mint dialog's quick-pick row.
// Scopes use the canonical `<svc>:<level>` shape so the resulting
// token lights up the access matrix correctly.
//
// `requires` signals the minimum matrix level the user needs on each
// referenced service; the picker disables presets the caller can't
// actually mint (backend will 403 anyway, but the UI should not offer
// a choice that's known to fail).
export interface ScopePreset {
	id: 'readonly' | 'trading_bot' | 'full' | 'custom';
	label: string;
	description: string;
	scopes: Scope[];
	/** { service: minLevel } — all must be satisfied by the caller. */
	requires: Partial<Record<ScopeService | '*', ScopeLevel>>;
}

export const SCOPE_PRESETS: ScopePreset[] = [
	{
		id: 'readonly',
		label: 'Read-only',
		description: 'Observe every service you have access to. No writes.',
		scopes: SCOPE_SERVICES.map((s) => `${s}:read`),
		requires: { lumid: 'read' },
	},
	{
		id: 'trading_bot',
		label: 'Trading bot',
		description: 'QuantArena read + trade. Typical for LLM trading bots.',
		scopes: ['qa:write'],
		requires: { qa: 'write' },
	},
	{
		id: 'full',
		label: 'Full access',
		description:
			'Admin-everywhere (global wildcard). Admins only — scoped to the calling user.',
		scopes: ['*'],
		requires: { '*': 'admin' },
	},
];

// ---- grantable-scopes ----

export interface GrantableScopes {
	role: 'user' | 'admin';
	services: ScopeService[];
	matrix: Record<ScopeService, ScopeLevel>;
	can_wildcard: boolean;
}

export async function getGrantableScopes(): Promise<GrantableScopes> {
	const r = await apiClient.get<DataResponse<GrantableScopes>>(
		'/api/v1/identity/grantable-scopes',
	);
	return r.data.data;
}

// Level rank — matches backend levelRank(). Used by the picker to
// decide whether a preset / individual scope is grantable.
const LEVEL_RANK: Record<ScopeLevel, number> = {
	none: 0,
	read: 1,
	write: 2,
	admin: 3,
};

export function levelSatisfies(have: ScopeLevel, want: ScopeLevel): boolean {
	return LEVEL_RANK[have] >= LEVEL_RANK[want];
}

/** Is the given preset grantable given the caller's current matrix row? */
export function canGrantPreset(p: ScopePreset, g: GrantableScopes): boolean {
	for (const [svc, want] of Object.entries(p.requires)) {
		if (svc === '*') {
			if (!g.can_wildcard) return false;
			continue;
		}
		const have = g.matrix[svc as ScopeService] ?? 'none';
		if (!levelSatisfies(have, want as ScopeLevel)) return false;
	}
	return true;
}

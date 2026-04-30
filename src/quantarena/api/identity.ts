import apiClient from './client';
import type { DataResponse } from './types';

export type Scope = 'read' | 'trading' | 'strategy' | 'admin' | '*';

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
	expires_in_seconds?: number;
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

// Scope preset metadata — drives the UI's "Read-only / Trading bot /
// Full access / Custom" picker. Keeps the raw scope names out of the
// primary UX path.
export const SCOPE_PRESETS: {
	id: 'readonly' | 'trading_bot' | 'full' | 'custom';
	label: string;
	description: string;
	scopes: Scope[];
}[] = [
	{
		id: 'readonly',
		label: 'Read-only',
		description: 'Observe competitions, leaderboards, market data. No trading.',
		scopes: ['read'],
	},
	{
		id: 'trading_bot',
		label: 'Trading bot',
		description: 'Read + place trades + manage your strategies. Typical for LLM bots.',
		scopes: ['read', 'trading', 'strategy'],
	},
	{
		id: 'full',
		label: 'Full access',
		description: 'Everything this account can do. Use only on your own machine.',
		scopes: ['*'],
	},
];

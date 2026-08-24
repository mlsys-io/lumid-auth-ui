import apiClient from './client';
import type { DataResponse } from './types';

export interface InvitationCode {
	code: string;
	note?: string;
	/**
	 * Space-separated access grants applied when the code is redeemed,
	 * e.g. "lumid:write". Surfaced in the list because once a code confers
	 * entitlement rather than mere signup, "what does this code do" is no
	 * longer answerable from the note field.
	 */
	scopes?: string;
	max_uses: number;
	uses_remaining: number;
	expires_at?: string;
	revoked_at?: string;
	last_used_at?: string;
	created_at: string;
}

export interface MintInviteReq {
	count?: number;
	max_uses?: number;
	note?: string;
	ttl_days?: number;
	/**
	 * Space-separated scopes, e.g. "lumid:write findata:read". Redeeming writes
	 * these as durable user_access_grants rows, which is how an operator hands
	 * out an entitlement a user cannot self-grant WITHOUT any credential passing
	 * through their hands. The server validates at mint and refuses wildcards.
	 */
	scopes?: string;
}

export async function mintInvitations(req: MintInviteReq): Promise<{ codes: InvitationCode[]; total: number }> {
	const r = await apiClient.post<DataResponse<{ codes: InvitationCode[]; total: number }>>(
		'/api/v1/admin/invitation-codes',
		req
	);
	return r.data.data;
}

export async function listInvitations(status = 'active'): Promise<{ codes: InvitationCode[]; total: number }> {
	const r = await apiClient.get<DataResponse<{ codes: InvitationCode[]; total: number }>>(
		'/api/v1/admin/invitation-codes',
		{ params: { status } }
	);
	return r.data.data;
}

export async function revokeInvitation(code: string): Promise<void> {
	await apiClient.delete(`/api/v1/admin/invitation-codes/${encodeURIComponent(code)}`);
}

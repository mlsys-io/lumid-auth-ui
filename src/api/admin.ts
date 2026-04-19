import apiClient from './client';
import type { DataResponse } from './types';

export interface InvitationCode {
	code: string;
	note?: string;
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

// Thin client for /api/v1/user/ssh-keys. Backed by lumid-identity;
// same-origin + lm_session cookie auth.

import apiClient from "./client";
import type { DataResponse } from "./types";

export interface SshKey {
	id: number;
	title: string;
	key_type: string;
	fingerprint: string;
	public_key: string;
	created_at: number; // unix seconds
	last_used_at: number; // 0 if never
}

export async function listSshKeys(): Promise<SshKey[]> {
	const r = await apiClient.get<DataResponse<{ keys: SshKey[] }>>(
		"/api/v1/user/ssh-keys",
	);
	return r.data.data?.keys ?? [];
}

export interface UploadSshKeyRequest {
	title: string;
	public_key: string;
}
export async function uploadSshKey(req: UploadSshKeyRequest): Promise<SshKey> {
	// Upload handler returns the row directly as `data` (unlike list
	// which wraps as `data.keys`) — see ok_(c, "added", sshKeyItem{...}).
	const r = await apiClient.post<DataResponse<SshKey>>(
		"/api/v1/user/ssh-keys",
		req,
	);
	return r.data.data;
}

export async function deleteSshKey(id: number): Promise<void> {
	await apiClient.delete(`/api/v1/user/ssh-keys/${id}`);
}

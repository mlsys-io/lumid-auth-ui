import apiClient from './client';
import type { DataResponse, UserInfo } from './types';

/**
 * Update the current user's profile — username / avatar. Both
 * optional. Avatar is a base64 data URL (matches the shape the
 * ported Runmesh + LQA modals already send).
 */
export async function updateProfile(input: { username?: string; avatar?: string }): Promise<UserInfo> {
	const r = await apiClient.put<DataResponse<UserInfo>>('/api/v1/user', input);
	return r.data.data;
}

/**
 * Change password. Backend revokes every OTHER session, so other
 * devices will see 401 on their next request; the caller's own
 * session stays valid.
 */
export async function changePassword(input: {
	old_password: string;
	new_password: string;
}): Promise<void> {
	await apiClient.post('/api/v1/user/password', input);
}

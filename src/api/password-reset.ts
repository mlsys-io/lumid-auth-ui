import apiClient from './client';

/**
 * Request a password-reset email. The backend replies 200 even when
 * the email doesn't exist (no enumeration) — the UI always shows a
 * neutral confirmation.
 */
export async function requestPasswordReset(email: string): Promise<void> {
	await apiClient.post('/api/v1/forgot-password', { email });
}

/**
 * Redeem a reset token from an emailed link. On success the server
 * revokes every live session for the account; the caller will have
 * to sign in again with the new password.
 */
export async function confirmPasswordReset(input: {
	token: string;
	new_password: string;
}): Promise<void> {
	await apiClient.post('/api/v1/reset-password', input);
}

import apiClient from './client';
import type {
	LoginRequest,
	LoginResponse,
	RegisterRequest,
	RegisterResponse,
	GoogleLoginRequest,
	GoogleLoginResponse,
	SendVerificationCodeRequest,
	SendVerificationCodeResponse,
	SubmitInvitationCodeRequest,
	SubmitInvitationCodeResponse,
	DataResponse,
	BaseResponse,
} from './types';

/**
 * User login
 * POST /api/v1/login
 */
export async function login(data: LoginRequest): Promise<LoginResponse> {
	const response = await apiClient.post<DataResponse<LoginResponse>>('/api/v1/login', data);
	return response.data.data;
}

/**
 * User logout
 * POST /api/v1/logout
 */
export async function logout(): Promise<void> {
	await apiClient.post<BaseResponse>('/api/v1/logout');
}

/**
 * User registration
 * POST /api/v1/register
 */
export async function register(data: RegisterRequest): Promise<RegisterResponse> {
	const response = await apiClient.post<DataResponse<RegisterResponse>>('/api/v1/register', data);
	return response.data.data;
}

/**
 * Google OAuth login
 * POST /api/v1/oauth/google/login
 */
export async function googleLogin(data: GoogleLoginRequest): Promise<GoogleLoginResponse> {
	const response = await apiClient.post<DataResponse<GoogleLoginResponse>>('/api/v1/oauth/google/login', data);
	return response.data.data;
}

/**
 * Send email verification code
 * POST /api/v1/send-verification-code
 */
export async function sendVerificationCode(data: SendVerificationCodeRequest): Promise<SendVerificationCodeResponse> {
	const response = await apiClient.post<DataResponse<SendVerificationCodeResponse>>(
		'/api/v1/send-verification-code',
		data
	);
	return response.data.data;
}

/**
 * Submit invitation code for Google OAuth user
 * POST /api/v1/oauth/google/submit-invitation-code
 */
export async function updateInvitationCode(data: SubmitInvitationCodeRequest): Promise<SubmitInvitationCodeResponse> {
	const response = await apiClient.put<DataResponse<SubmitInvitationCodeResponse>>(
		'/api/v1/user/invitation-code',
		data
	);
	return response.data.data;
}

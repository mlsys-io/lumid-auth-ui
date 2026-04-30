import apiClient from './client';
import type { UserResponse, UpdateUserRequest, UpdateUserResponse, DataResponse } from './types';

/**
 * Get current user information
 * GET /api/v1/user
 */
export async function getUserInfo(): Promise<UserResponse> {
	const response = await apiClient.get<DataResponse<UserResponse>>('/api/v1/user');
	return response.data.data;
}

/**
 * Update user information
 * PUT /api/v1/user
 */
export async function updateUserInfo(data: UpdateUserRequest): Promise<UpdateUserResponse> {
	const response = await apiClient.put<DataResponse<UpdateUserResponse>>('/api/v1/user', data);
	return response.data.data;
}

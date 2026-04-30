import apiClient from './client';
import {
	GetSystemTagsResponse,
	TemplateTypeParams,
	PaginatedResponse,
	TemplateInfo,
	TemplateBaseInfo,
	GetMarketsResponse,
	MarketInfo,
	type DataResponse,
} from './types';

/**
 * Get system/custom tags
 * GET /api/v1/templates
 */
export async function getTemplateList(params: TemplateTypeParams): Promise<PaginatedResponse<GetSystemTagsResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetSystemTagsResponse>>('/api/v1/templates', { params });
	return response.data;
}

/**
 * Create custom tag
 * POST /api/v1/templates
 */
export async function createCustomTag(data: TemplateBaseInfo): Promise<TemplateInfo> {
	const response = await apiClient.post<TemplateInfo>('/api/v1/templates', data);
	return response.data;
}
/**
 * Update custom tag
 * PUT /api/v1/templates/{id}
 */
export async function updateCustomTag(id: number, data: TemplateBaseInfo): Promise<TemplateInfo> {
	const response = await apiClient.put<TemplateInfo>(`/api/v1/templates/${id}`, data);
	return response.data;
}
/**
 * Delete custom tag
 * DELETE /api/v1/templates/{id}
 */
export async function deleteCustomTag(id: number): Promise<void> {
	const response = await apiClient.delete<void>(`/api/v1/templates/${id}`);
	return response.data;
}
/**
 * Get market
 * GET /api/v1/markets
 */
export async function getMarkets(): Promise<MarketInfo[]> {
	const response = await apiClient.get<DataResponse<GetMarketsResponse>>(
		'/api/v1/markets?limit=' + Number.MAX_SAFE_INTEGER
	);
	return response.data.data.markets;
}

import apiClient from './client';
import type {
	StrategyListParams,
	GetStrategyListResponse,
	CreateStrategyRequest,
	CreateStrategyResponse,
	UpdateStrategyRequest,
	EditStrategyCodeRequest,
	GetStrategyVersionsResponse,
	PaginatedResponse,
	DataResponse,
	BaseResponse,
	GetSimulationStrategiesParams,
	GetSimulationStrategiesResponse,
	CreateSimulationStrategyRequest,
} from './types';

/**
 * Get strategy list
 * GET /api/v1/strategies
 */
export async function getStrategies(params?: StrategyListParams): Promise<PaginatedResponse<GetStrategyListResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetStrategyListResponse>>('/api/v1/strategies', {
		params: {
			...params,
			framework: params?.framework?.join(','),
			visibility: params?.visibility?.join(','),
		},
	});
	return response.data;
}

/**
 * Create a new strategy
 * POST /api/v1/strategies
 */
export async function createStrategy(data: CreateStrategyRequest): Promise<CreateStrategyResponse> {
	const formData = new FormData();
	formData.append('name', data.name);
	if (data.description) formData.append('description', data.description);
	if (data.tags) formData.append('tags', data.tags);
	formData.append('framework', data.framework);
	formData.append('visibility', data.visibility);
	formData.append('file', data.file);
	if (data.template_ids?.length) formData.append('template_ids', data.template_ids.join(','));
	if (data.bundle_code) formData.append('bundle_code', data.bundle_code);

	const response = await apiClient.post<DataResponse<CreateStrategyResponse>>('/api/v1/strategies', formData, {
		headers: {
			'Content-Type': 'multipart/form-data',
		},
	});
	return response.data.data;
}

/**
 * Update strategy base info
 * PUT /api/v1/strategies/{strategy_id}
 */
export async function updateStrategy(strategyId: number, data: UpdateStrategyRequest): Promise<void> {
	await apiClient.put<BaseResponse>(`/api/v1/strategies/${strategyId}`, data);
}

/**
 * Delete strategy
 * DELETE /api/v1/strategies/{strategy_id}
 */
export async function deleteStrategy(strategyId: number): Promise<void> {
	await apiClient.delete<BaseResponse>(`/api/v1/strategies/${strategyId}`);
}

/**
 * Edit strategy code
 * PUT /api/v1/strategies/{strategy_id}/code
 */
export async function editStrategyCode(strategyId: number, data: EditStrategyCodeRequest): Promise<void> {
	await apiClient.put<BaseResponse>(`/api/v1/strategies/${strategyId}/code`, data);
}

/**
 * Get strategy versions
 * GET /api/v1/strategies/{strategy_id}/versions
 */
export async function getStrategyVersions(strategyId: number): Promise<GetStrategyVersionsResponse> {
	const response = await apiClient.get<DataResponse<GetStrategyVersionsResponse>>(
		`/api/v1/strategies/${strategyId}/versions`
	);
	return response.data.data;
}

/**
 * Export strategy code
 * GET /api/v1/strategies/{strategy_id}/export
 */
export async function exportStrategyCode(strategyId: number, versionId?: number): Promise<Blob> {
	const response = await apiClient.get(`/api/v1/strategies/${strategyId}/export`, {
		params: { version_id: versionId || 0 },
		responseType: 'blob',
	});
	return response.data;
}

/**
 * get simulation strategies
 * GET /api/v1/strategies/simulation
 */
export async function getSimulationStrategies(
	params?: GetSimulationStrategiesParams
): Promise<PaginatedResponse<GetSimulationStrategiesResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetSimulationStrategiesResponse>>(
		'/api/v1/simulation-strategies',
		{
			params,
		}
	);
	return response.data;
}
/**
 * create simulation strategy
 * POST /api/v1/simulation-strategies
 */
export async function createSimulationStrategy(
	data: CreateSimulationStrategyRequest
): Promise<GetSimulationStrategiesResponse> {
	const response = await apiClient.post<DataResponse<GetSimulationStrategiesResponse>>(
		'/api/v1/simulation-strategies',
		data
	);
	return response.data.data;
}

/**
 * Delete simulation strategy
 * DELETE /api/v1/simulation-strategies/{strategy_id}
 */
export async function deleteSimulationStrategy(strategyId: number): Promise<void> {
	await apiClient.delete(`/api/v1/simulation-strategies/${strategyId}`);
}

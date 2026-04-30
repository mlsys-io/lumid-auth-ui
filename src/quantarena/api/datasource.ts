import apiClient from './client';
import type {
	CreateHistoryDatabaseRequest,
	GetHistoryDatabasesResponse,
	PaginatedResponse,
	PaginationParams,
	BaseResponse,
	GetUniversesResponse,
	GetSymbolsResponse,
	CreateUniverseRequest,
	GetBundlesResponse,
	CreateBundleRequest,
	DataResponse,
} from './types';

/**
 * Get history databases
 * GET /api/v1/datasource/history-databases
 */
export async function getHistoryDatabases(
	params: PaginationParams
): Promise<PaginatedResponse<GetHistoryDatabasesResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetHistoryDatabasesResponse>>('/api/v1/history-databases', {
		params,
	});
	return response.data;
}

/**
 * Create history database
 * POST /api/v1/history-databases
 */
export async function createHistoryDatabase(data: CreateHistoryDatabaseRequest): Promise<GetHistoryDatabasesResponse> {
	const response = await apiClient.post<GetHistoryDatabasesResponse>('/api/v1/history-databases', data);
	return response.data;
}

/**
 * Ingest history database
 * POST /api/v1/history-databases/{code}/ingest
 */
export async function ingestHistoryDatabase(code: string): Promise<BaseResponse> {
	const response = await apiClient.post<BaseResponse>(`/api/v1/history-databases/ingest`, { code });
	return response.data;
}

/**
 * Get universes
 * GET /api/v1/universes
 */
export async function getUniverses(params: PaginationParams): Promise<PaginatedResponse<GetUniversesResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetUniversesResponse>>('/api/v1/universes', { params });
	return response.data;
}
/**
 * Get symbols
 * GET /api/v1/symbols
 */
export async function getSymbols(): Promise<GetSymbolsResponse> {
	const response = await apiClient.get<DataResponse<GetSymbolsResponse>>('/api/v1/securities');
	return response.data.data;
}
/**
 * Create universe
 * POST /api/v1/universes
 */
export async function createUniverse(data: CreateUniverseRequest): Promise<GetUniversesResponse> {
	const response = await apiClient.post<GetUniversesResponse>('/api/v1/universes', data);
	return response.data;
}
/**
 * Get bundles
 * GET /api/v1/bundles
 */
export async function getBundles(params: PaginationParams): Promise<PaginatedResponse<GetBundlesResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetBundlesResponse>>('/api/v1/bundles', { params });
	return response.data;
}
/**
 * Create bundle
 * POST /api/v1/bundles
 */
export async function createBundle(data: CreateBundleRequest): Promise<GetBundlesResponse> {
	const response = await apiClient.post<GetBundlesResponse>('/api/v1/bundles', data);
	return response.data;
}
/**
 * Ingest bundle
 * POST /api/v1/bundles/{code}/ingest
 */
export async function ingestBundle(code: string): Promise<BaseResponse> {
	const response = await apiClient.post<BaseResponse>(`/api/v1/bundles/ingest`, { code });
	return response.data;
}

/**
 * Delete bundle
 * DELETE /api/v1/bundles/{bundle_id}
 */
export async function deleteBundle(bundleId: number): Promise<void> {
	await apiClient.delete(`/api/v1/bundles/${bundleId}`);
}

/**
 * Delete universe
 * DELETE /api/v1/universes/{universe_id}
 */
export async function deleteUniverse(universeId: number): Promise<void> {
	await apiClient.delete(`/api/v1/universes/${universeId}`);
}

/**
 * Delete history database
 * DELETE /api/v1/history-databases/{database_id}
 */
export async function deleteHistoryDatabase(databaseId: number): Promise<void> {
	await apiClient.delete(`/api/v1/history-databases/${databaseId}`);
}

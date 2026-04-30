import apiClient from './client';
import type {
	CreateFreqTradeDatasetRequest,
	CreateFreqTradeDatasetResponse,
	GetFreqTradeDatasetListResponse,
	DownloadFreqTradeDataRequest,
	GetFreqTradeAvailablePairsResponse,
	FreqTradeDatasetInfo,
	PaginatedResponse,
	DataResponse,
	PaginationParams,
} from './types';

/**
 * Get FreqTrade datasets
 * GET /api/v1/freqtrade-datasets
 */
export async function getFreqTradeDatasets(
	params?: PaginationParams
): Promise<PaginatedResponse<GetFreqTradeDatasetListResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetFreqTradeDatasetListResponse>>(
		'/api/v1/freqtrade-datasets',
		{ params }
	);
	return response.data;
}

/**
 * Create FreqTrade dataset
 * POST /api/v1/freqtrade-datasets
 */
export async function createFreqTradeDataset(
	data: CreateFreqTradeDatasetRequest
): Promise<CreateFreqTradeDatasetResponse> {
	const response = await apiClient.post<DataResponse<CreateFreqTradeDatasetResponse>>(
		'/api/v1/freqtrade-datasets',
		data
	);
	return response.data.data;
}

/**
 * Download FreqTrade data
 * POST /api/v1/freqtrade-datasets/download
 */
export async function downloadFreqTradeData(data: DownloadFreqTradeDataRequest): Promise<void> {
	await apiClient.post('/api/v1/freqtrade-datasets/download', data);
}

/**
 * Get FreqTrade dataset by ID
 * GET /api/v1/freqtrade-datasets/{dataset_id}
 */
export async function getFreqTradeDatasetByID(datasetId: number): Promise<FreqTradeDatasetInfo> {
	const response = await apiClient.get<DataResponse<FreqTradeDatasetInfo>>(
		`/api/v1/freqtrade-datasets/${datasetId}`
	);
	return response.data.data;
}

/**
 * Delete FreqTrade dataset
 * DELETE /api/v1/freqtrade-datasets/{dataset_id}
 */
export async function deleteFreqTradeDataset(datasetId: number): Promise<void> {
	await apiClient.delete(`/api/v1/freqtrade-datasets/${datasetId}`);
}

/**
 * Get available trading pairs from FreqTrade
 * GET /api/v1/freqtrade-available-pairs
 */
export async function getFreqTradeAvailablePairs(
	timeframe?: string
): Promise<GetFreqTradeAvailablePairsResponse> {
	const response = await apiClient.get<DataResponse<GetFreqTradeAvailablePairsResponse>>(
		'/api/v1/freqtrade-available-pairs',
		{ params: { timeframe } }
	);
	return response.data.data;
}

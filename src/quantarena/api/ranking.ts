import apiClient from './client';
import type {
	RankingParams,
	GetStrategyRankingResponse,
	GetRankingTagsResponse,
	PaginatedResponse,
	DataResponse,
	GetRankingTemplatesResponse,
} from './types';

/**
 * Get strategy ranking by backtesting results
 * GET /api/v1/backtesting-ranking
 */
export async function getStrategyRanking(
	params?: RankingParams
): Promise<PaginatedResponse<GetStrategyRankingResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetStrategyRankingResponse>>('/api/v1/backtesting-ranking', {
		params,
	});
	return response.data;
}

/**
 * Get available tags for ranking filter
 * GET /api/v1/backtesting-ranking/tags
 */
export async function getRankingTags(): Promise<DataResponse<GetRankingTagsResponse>> {
	const response = await apiClient.get<DataResponse<GetRankingTagsResponse>>('/api/v1/backtesting-ranking/tags');
	return response.data;
}
/**
 * Get available templates for ranking filter
 * GET /api/v1/backtesting-ranking/templates
 */
export async function getRankingTemplatesList(): Promise<DataResponse<GetRankingTemplatesResponse>> {
	const response = await apiClient.get<DataResponse<GetRankingTemplatesResponse>>(
		'/api/v1/backtesting-ranking/templates'
	);
	return response.data;
}

import apiClient from './client';
import {
	CompetitionListParams,
	GetCompetitionsListResponse,
	PaginatedResponse,
	GetCompetitionDetailResponse,
	DataResponse,
	GetMyStrategiesResponse,
	GetCompetitionLeaderboardResponse,
	LeaderboardParams,
	StrategyDetail,
} from './types';

/**
 *
 * GET /api/v1/competitions/my
 * @returns
 */
export async function getMyCompetitionsList(
	params: CompetitionListParams
): Promise<PaginatedResponse<GetCompetitionsListResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetCompetitionsListResponse>>('/api/v1/competitions/my', {
		params,
	});
	return response.data;
}
/**
 * Get competitions list
 * GET /api/v1/competitions
 */
export async function getCompetitionsList(
	params: CompetitionListParams
): Promise<PaginatedResponse<GetCompetitionsListResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetCompetitionsListResponse>>('/api/v1/competitions', {
		params,
	});
	return response.data;
}
/**
 * Register strategy for competition
 * POST /api/v1/competitions/{competition_id}/join
 */
export async function registerStrategyForCompetition(competitionId: number, strategyId: number): Promise<void> {
	const response = await apiClient.post<void>(`/api/v1/competitions/${competitionId}/join`, {
		simulation_strategy_id: strategyId,
	});
	return response.data;
}
/**
 * Get competition detail
 * GET /api/v1/competitions/{competition_id}
 */
export async function getCompetitionDetail(competitionId: number): Promise<DataResponse<GetCompetitionDetailResponse>> {
	const response = await apiClient.get<DataResponse<GetCompetitionDetailResponse>>(
		`/api/v1/competitions/${competitionId}`
	);
	return response.data;
}
/**
 * Get my-strategies list
 * GET /api/v1/competitions/{competition_id}/my-strategies
 */
export async function getMyStrategies(competitionId: number): Promise<DataResponse<GetMyStrategiesResponse>> {
	const response = await apiClient.get<DataResponse<GetMyStrategiesResponse>>(
		`/api/v1/competitions/${competitionId}/my-strategies`
	);
	return response.data;
}
/**
 * get leaderboard for a competition
 * GET /api/v1/competitions/{competition_id}/leaderboard
 */
export async function getCompetitionLeaderboard(
	competitionId: number,
	params: LeaderboardParams
): Promise<DataResponse<GetCompetitionLeaderboardResponse>> {
	const response = await apiClient.get<DataResponse<GetCompetitionLeaderboardResponse>>(
		`/api/v1/competitions/${competitionId}/leaderboard`,
		{
			params,
		}
	);
	return response.data;
}
/**
 * get my-strategy info
 * GET /api/v1/competitions/{competition_id}/strategies/{strategy_id}
 */
export async function getStrategyDetail(
	competitionId: number,
	strategyId: number
): Promise<DataResponse<StrategyDetail>> {
	const response = await apiClient.get<DataResponse<StrategyDetail>>(
		`/api/v1/competitions/${competitionId}/strategies/${strategyId}`
	);
	return response.data;
}
/**
 * follow a strategy
 * POST /api/v1/competitions/{competition_id}/strategies/{strategy_id}/follow
 */
export async function followStrategy(competitionId: number, strategyId: number): Promise<void> {
	const response = await apiClient.post<void>(
		`/api/v1/competitions/${competitionId}/strategies/${strategyId}/follow`,
		{
			follow_ratio: 0,
		}
	);
	return response.data;
}

export interface ActivityTradeInfo {
	id: number;
	symbol: string;
	direction: string;
	price: number;
	volume: number;
	value: number;
	trade_time: number;
	username: string;
	user_avatar: string;
	strategy_name: string;
}

export interface RecentTradesResponse {
	trades: ActivityTradeInfo[];
	total: number;
}

/**
 * GET /api/v1/competitions/{competition_id}/recent-trades
 */
export async function getCompetitionRecentTrades(
	competitionId: number,
	params?: { limit?: number; since_time?: number }
): Promise<RecentTradesResponse> {
	const response = await apiClient.get<{ data: RecentTradesResponse }>(
		`/api/v1/competitions/${competitionId}/recent-trades`,
		{ params }
	);
	return response.data.data;
}

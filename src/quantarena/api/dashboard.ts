import apiClient from './client';
import type {
	GetCompetitionsResponse,
	GetLeaderboardResponse,
	GetEquityChartResponse,
	DashboardOverviewResponse,
	DataResponse,
} from './types';

/**
 * Get competitions list
 * GET /api/v1/dashboard/competitions
 */
export async function getCompetitions(): Promise<GetCompetitionsResponse> {
	const response = await apiClient.get<DataResponse<GetCompetitionsResponse>>('/api/v1/dashboard/competitions');
	return response.data.data;
}

/**
 * Get leaderboard for a competition
 * GET /api/v1/dashboard/leaderboard/{competition_id}
 */
export async function getLeaderboard(competitionId: number): Promise<GetLeaderboardResponse> {
	const response = await apiClient.get<DataResponse<GetLeaderboardResponse>>(
		`/api/v1/dashboard/leaderboard/${competitionId}`
	);
	return response.data.data;
}

/**
 * Get equity chart data for a competition
 * GET /api/v1/dashboard/equity-chart/{competition_id}
 */
export async function getEquityChart(
	competitionId: number,
	params?: { start_time?: number; end_time?: number }
): Promise<GetEquityChartResponse> {
	const response = await apiClient.get<DataResponse<GetEquityChartResponse>>(
		`/api/v1/dashboard/equity-chart/${competitionId}`,
		{ params }
	);
	return response.data.data;
}

/**
 * Get dashboard overview (all data in one call)
 * GET /api/v1/dashboard/overview
 */
export async function getDashboardOverview(): Promise<DashboardOverviewResponse> {
	const response = await apiClient.get<DataResponse<DashboardOverviewResponse>>(
		'/api/v1/dashboard/overview'
	);
	return response.data.data;
}

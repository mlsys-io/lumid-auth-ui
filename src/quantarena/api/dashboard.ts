import apiClient from './client';
import type {
	GetCompetitionsResponse,
	GetLeaderboardResponse,
	GetEquityChartResponse,
	DashboardOverviewResponse,
	LeaderboardItem,
	DataResponse,
} from './types';

/**
 * Get competitions list
 * GET /api/v1/dashboard/competitions
 */
export async function getCompetitions(params?: { status?: string }): Promise<GetCompetitionsResponse> {
	const response = await apiClient.get<DataResponse<GetCompetitionsResponse>>(
		'/api/v1/dashboard/competitions',
		{ params },
	);
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

/**
 * Leaderboard for the first Ongoing competition, with competition_id injected per row.
 * Used by qa://dashboard/leaderboard/latest in the surface directive system.
 */
export async function getDashboardLeaderboardLatest(
	limit = 10,
): Promise<Array<LeaderboardItem & { competition_id: number }>> {
	const comps = await getCompetitions({ status: 'Ongoing' });
	// Skip private competitions — their detail page 404s for non-owners, so a
	// row_href into one would dead-end. Only link to openable (public) comps.
	const ongoing = (comps.competitions ?? []).filter((c) => !(c as { is_private?: boolean }).is_private);
	if (!ongoing.length) return [];
	const compId = ongoing[0].id;
	const lb = await getLeaderboard(compId);
	return (lb.participants ?? []).slice(0, limit).map((p) => ({ ...p, competition_id: compId }));
}

/**
 * Equity chart for the first Ongoing competition, normalized to flat [{ts, equity, name}] rows.
 * Used by qa://dashboard/equity-chart/latest in the surface directive system.
 */
export async function getDashboardEquityChartLatest(): Promise<
	Array<{ ts: number; equity: number; name: string }>
> {
	const comps = await getCompetitions({ status: 'Ongoing' });
	const ongoing = (comps.competitions ?? []).filter((c) => !(c as { is_private?: boolean }).is_private);
	if (!ongoing.length) return [];
	const chart = await getEquityChart(ongoing[0].id);
	return (chart.charts ?? []).flatMap((s) =>
		(s.data_points ?? []).map((p) => ({ ts: p.timestamp, equity: p.total_equity, name: s.strategy_name })),
	);
}

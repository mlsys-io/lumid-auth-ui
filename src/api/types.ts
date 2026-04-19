// Base response types
export interface BaseResponse {
	ret_code: number;
	message: string;
}

export interface DataResponse<T> extends BaseResponse {
	data: T;
}

export interface PaginatedResponse<T> extends DataResponse<T> {
	total: number;
}

export interface ErrorResponse {
	ret_code: number;
	message: string;
}

// User types
export interface UserInfo {
	id: number | string;
	username: string;
	email: string;
	avatar?: string;
	invitation_code?: string;
	// Lum.id adds `role` (user|admin) and `status` — AdminGuard reads
	// role to gate /account/admin/*.
	role?: string;
	status?: string;
}

export interface UserResponse extends UserInfo {
	create_time: number;
	update_time: number;
}

export interface LoginRequest {
	email: string;
	password: string;
	recaptcha_token: string;
}

export interface LoginResponse {
	token: string;
	expires_in: number;
	user_info: UserInfo;
}

export interface RegisterRequest {
	username: string;
	email: string;
	password: string;
	verification_code: string; // Email verification code (6 digits, required)
	avatar?: string;
	invitation_code?: string;
}

export interface RegisterResponse {
	id: number;
	username: string;
	email: string;
	avatar?: string;
}

export interface UpdateUserRequest {
	username?: string;
	email?: string;
	avatar?: string;
}

export interface UpdateUserResponse {
	id: number;
	username: string;
	email: string;
	avatar?: string;
}

export interface GoogleLoginRequest {
	code: string;
	state: string;
}

export interface GoogleLoginResponse {
	token: string;
	expires_in: number;
	user_info: UserInfo;
}

export interface SendVerificationCodeRequest {
	email: string;
}

export interface SendVerificationCodeResponse {
	message: string;
}

export interface SubmitInvitationCodeRequest {
	invitation_code: string;
}

export interface SubmitInvitationCodeResponse {
	token: string;
	expires_in: number;
}

// Strategy types
export interface StrategyInfo {
	id: number;
	name: string;
	description: string;
	tags: string[];
	templates: TemplateInfo[];
	template_ids?: number[];
	framework: 'Moonshot' | 'Zipline' | 'FreqTrade';
	visibility: 'Public' | 'Private';
	bundle_code?: string;
	freqtrade_config?: string;
	current_version: number;
	create_time: number;
}

export interface CreateStrategyRequest {
	name: string;
	description?: string;
	tags?: string;
	framework: 'Moonshot' | 'Zipline' | 'FreqTrade';
	visibility: 'Public' | 'Private';
	file: File;
	template_ids?: number[];
	bundle_code?: string;
	freqtrade_config?: string;
}

export interface CreateStrategyResponse {
	id: number;
}

export interface UpdateStrategyRequest {
	name: string;
	description?: string;
	template_ids?: number[];
	visibility: 'Public' | 'Private';
}

export interface EditStrategyCodeRequest {
	code_content: string;
	note?: string;
}

export interface StrategyVersionInfo {
	id: number;
	version: number;
	note: string;
	code_text: string;
	create_time: number;
	backtest_tasks: BacktestTaskInfo[];
}

export interface BacktestTaskInfo {
	id: number;
	status: 'Pending' | 'Running' | 'Finished' | 'Failed' | 'Cancelled';
	cagr?: number;
	sharpe_ratio?: number;
	max_drawdown?: number;
	cumulative_return?: number;
}

export interface GetStrategyListResponse {
	strategies: StrategyInfo[];
}

export interface GetStrategyVersionsResponse {
	versions: StrategyVersionInfo[];
}

export interface GetSimulationStrategiesParams extends PaginationParams {
	status?: string[];
}
export interface GetSimulationStrategiesResponse {
	strategies: SimulationStrategyInfo[];
}
export interface SimulationStrategyInfo {
	id: number;
	name: string;
	description: string;
	create_time: number;
	status: 'Competing' | 'Idle';
	api_token: string;
	competition_id?: number;
	competition_name?: string;
}

export interface CreateSimulationStrategyRequest {
	name: string;
	description: string;
	competition_id: number;
}

// Backtesting types
export interface CreateBacktestingTaskRequest {
	strategy_id: number;
	template_id: number;
}

export interface CreateBacktestingTaskResponse {
	id: number;
}

export interface BacktestingTaskInfo {
	id: number;
	strategy_id: number;
	strategy_name: string;
	strategy_description: string;
	strategy_version: number;
	framework: 'Moonshot' | 'Zipline' | 'FreqTrade';
	status: 'Pending' | 'Running' | 'Finished' | 'Failed' | 'Cancelled';
	start_date: number;
	end_date: number;
	results?: BacktestingResultMetrics;
	create_time: number;
}

export interface GetBacktestingTasksResponse {
	tasks: BacktestingTaskInfo[];
}

export interface BacktestingResultMetrics {
	cagr: number;
	sharpe_ratio: number;
	max_drawdown: number;
	cumulative_return: number;
	freqtrade_extra?: FreqTradeExtraMetrics;
}

export interface FreqTradeExtraMetrics {
	win_rate?: number;
	profit_factor?: number;
	total_trades?: number;
	avg_trade_duration?: string;
	sortino_ratio?: number;
	calmar_ratio?: number;
	wins?: number;
	losses?: number;
	final_balance?: number;
	trading_volume?: number;
}

export interface BacktestingTaskResultData {
	id: number;
	results?: BacktestingResultMetrics;
	error_message?: string;
}

export interface CancelBacktestingTaskResponse {
	id: number;
}

// Ranking types
export interface StrategyRankingItem {
	rank: number;
	strategy_id: number;
	strategy_name: string;
	strategy_description: string;
	tags?: string[];
	version: number;
	framework: 'Moonshot' | 'Zipline' | 'FreqTrade';
	visibility: 'Private' | 'Public';
	user_id: number;
	username: string;
	user_avatar: string;
	backtest_task_id: number;
	cagr: number;
	sharpe_ratio: number;
	max_drawdown: number;
	cumulative_return: number;
	create_time: number;
	template_id: number;
}

export interface GetStrategyRankingResponse {
	rankings: StrategyRankingItem[];
}

// Query parameter types
export interface PaginationParams {
	page?: number;
	page_size?: number;
}

export interface StrategyListParams extends PaginationParams {
	framework?: string[];
	visibility?: string[];
}

export interface BacktestingTasksParams extends PaginationParams {
	status?: string[];
}

export interface RankingParams extends PaginationParams {
	sort_by?: 'cagr' | 'sharpe_ratio' | 'max_drawdown' | 'cumulative_return';
	order?: 'asc' | 'desc';
	tags?: string[];
	template_ids?: number[];
}

export interface GetRankingTagsResponse {
	tags: string[];
}

export interface ExportParams {
	file_type: 'csv' | 'pdf' | 'json';
}

// Dashboard types
export interface DashboardCompetitionInfo {
	id: number;
	name: string;
	participant_count: number;
	initial_funding: number;
	start_time: number;
	end_time: number;
	status: 'Upcoming' | 'Ongoing' | 'Completed';
	featured: boolean;
	showcase: boolean;
}

export interface GetCompetitionsResponse {
	competitions: DashboardCompetitionInfo[];
}

export interface DashboardOverviewCompetition extends DashboardCompetitionInfo {
	leaderboard: LeaderboardItem[];
	charts: EquityChartSeries[];
	// "Featured display" decoration pulled from tbl_campaign where
	// competition_id = this competition's id. Null/absent when no campaign
	// is linked — the dashboard renders the plain leaderboard/chart view.
	campaign?: CampaignDisplay | null;
}

// CampaignDisplay mirrors the backend types.CampaignInfo.
export interface CampaignDisplay {
	id: number;
	competition_id: number;
	title: string;
	subtitle: string;
	type: 'battle' | 'prediction' | 'championship' | 'challenge';
	description: string;
	image_url: string;
	cta_text: string;
	cta_url: string;
	start_time: number;
	end_time: number;
	status: string;
	sort_order: number;
	featured: boolean;
	meta_json: string;
}

export interface DashboardOverviewResponse {
	competitions: DashboardOverviewCompetition[];
}

// Leaderboard types
export interface LeaderboardItem {
	rank: number;
	id: number;
	strategy_name: string;
	user_id: number;
	username: string;
	user_avatar: string;
	return_rate: number; // Percentage as decimal (e.g., 0.4580 for 45.80%)
	max_drawdown: number;
	trading_times: number;
	total_equity: number;
	sharpe_ratio: number;
}

export interface GetLeaderboardResponse {
	participants: LeaderboardItem[];
}

// Equity Chart types
export interface EquityChartDataPoint {
	timestamp: number; // Date in format "MM/DD" or timestamp
	total_equity: number; // Dynamic strategy names as keys with equity values
}

export interface EquityChartSeries {
	strategy_name: string;
	participant_id: number;
	user_id: number;
	data_points: EquityChartDataPoint[];
	username: string;
}

export interface GetEquityChartResponse {
	charts: EquityChartSeries[];
}

// Datasource types
export interface HistoryDatabaseInfo {
	id: number;
	create_time: number;
	name: string;
	description: string;
	vendor: number;
	code: string;
	ingest_status: 'Unstarted' | 'Completed';
}
export interface GetHistoryDatabasesResponse {
	history_databases: HistoryDatabaseInfo[];
}
export interface CreateHistoryDatabaseRequest {
	name: string;
	description: string;
	vendor: string;
	code: string;
}
export interface CreateHistoryDatabaseResponse {
	id: number;
}

export interface UniverseInfo {
	id: number;
	create_time: number;
	name: string;
	description: string;
	code: string;
	sids: string[];
}
export interface GetUniversesResponse {
	universes: UniverseInfo[];
}
export interface GetSymbolsResponse {
	securities: {
		symbol: string;
		sid: string;
		name: string;
	}[];
}
export interface CreateUniverseRequest {
	name: string;
	description: string;
	code: string;
	sids: string[];
}
export interface GetBundlesResponse {
	bundles: BundleInfo[];
}
export interface BundleInfo {
	id: number;
	create_time: number;
	name: string;
	description: string;
	code: string;
	ingest_type: string;
	universe_code: string;
	ingest_status: 'Unstarted' | 'Completed';
}
export interface CreateBundleRequest {
	name: string;
	description: string;
	code: string;
	ingest_type: string;
	//	universe_code: string;
}

// Template types
export interface TemplateBaseInfo {
	name: string;
	description: string;
	start_date: number;
	end_date: number;
	market_id?: number;
	type?: 'system' | 'custom';
}
export interface TemplateInfo extends TemplateBaseInfo {
	id: number;
}
export interface GetSystemTagsResponse {
	templates: TemplateInfo[];
}
export interface TemplateTypeParams extends PaginationParams {
	type: 'system' | 'custom' | 'all';
}
export interface MarketInfo {
	id: number;
	name: string;
	live_price_source: string;
	symbols: string[];
	create_time: number;
	update_time: number;
}
export interface GetMarketsResponse {
	markets: MarketInfo[];
}
// Competition types
export interface CompetitionListParams extends PaginationParams {
	status?: string[];
}
export interface GetCompetitionsListResponse {
	competitions: CompetitionInfo[];
}
export interface CompetitionInfo {
	create_time: number;
	id: number;
	name: string;
	start_time: number;
	end_time: number;
	initial_funding: number;
	market_id: number;
	market_name: string;
	participant_count: number;
	trading_fees: number;
	update_time: number;
	status: 'Upcoming' | 'Ongoing' | 'Completed';
	symbols: string[];
}
export interface SymbolTradingHour {
	symbol: string;
	open_time: string;
}

export interface GetCompetitionDetailResponse {
	create_time: number;
	id: number;
	name: string;
	start_time: number;
	end_time: number;
	initial_funding: number;
	market_id: number;
	market_name: string;
	participant_count: number;
	trading_fees: number;
	update_time: number;
	status: 'Upcoming' | 'Ongoing' | 'Completed';
	symbols: string[];
	symbol_trading_hours?: SymbolTradingHour[];
}
export interface GetMyStrategiesResponse {
	strategies: MyStrategyInfo[];
}
export interface MyStrategyInfo {
	id: number;
	is_follower_strategy?: boolean;
	available_cash: number;
	initial_funding: number;
	max_drawdown: number;
	joined_at: number;
	rank: number;
	return_rate: number;
	sharpe_ratio: number;
	simulation_strategy_id: number;
	strategy_name: string;
	total_equity: number;
	user_id: number;
	username: string;
	user_avatar: string;
	trading_times: number;
}
export interface LeaderboardParams {
	sort_by?: 'TotalEquity' | 'ReturnRate' | 'MaxDrawdown' | 'SharpeRatio' | 'TradingTimes';
	order?: 'asc' | 'desc';
}
export interface GetCompetitionLeaderboardResponse {
	participants: MyStrategyInfo[];
}
export interface StrategyDetail {
	participant_info: MyStrategyInfo;
	positions: PositionInfo[];
	recent_trades: RecentTradeInfo[];
}
export interface RecentTradeInfo {
	direction: string;
	id: number;
	symbol: string;
	trade_time: number;
	value: number;
	volume: number;
	price: number;
}
export interface PositionInfo {
	symbol: string;
	average_price: number;
	market_price: number;
	position_size: number;
	unrealized_pnl: number;
}
export interface GetRankingTemplatesResponse {
	templates: { id: number; name: string }[];
}

// FreqTrade dataset types
export interface FreqTradeDatasetInfo {
	id: number;
	name: string;
	description: string;
	exchange: string;
	pairs: string[];
	timeframe: string;
	start_date: string;
	end_date: string;
	download_status: 'Pending' | 'Running' | 'Completed' | 'Failed';
	create_time: number;
}

export interface GetFreqTradeDatasetListResponse {
	datasets: FreqTradeDatasetInfo[];
}

export interface CreateFreqTradeDatasetRequest {
	name: string;
	description?: string;
	exchange: string;
	pairs: string[];
	timeframe: string;
	start_date?: string;
	end_date?: string;
}

export interface CreateFreqTradeDatasetResponse {
	id: number;
}

export interface DownloadFreqTradeDataRequest {
	dataset_id: number;
}

export interface GetFreqTradeAvailablePairsResponse {
	pairs: string[];
}

export interface FreqTradeStrategyConfig {
	exchange: string;
	pairs: string[];
	timeframe: string;
}

// FlowMesh Job types
export interface FlowMeshJobItem {
	id: number;
	user_id: number;
	competition_id: number;
	competition_name: string;
	simulation_strategy_id: number;
	strategy_name: string;
	name: string;
	description: string;
	workflow_yaml: string;
	cron_expression: string;
	flowmesh_url: string;
	lumidos_job_id: string;
	status: string;
	max_executions: number;
	total_executions: number;
	last_triggered_at: number;
	create_time: number;
	update_time: number;
}

export interface CreateFlowMeshJobRequest {
	name: string;
	description: string;
	competition_id: number;
	simulation_strategy_id: number;
	workflow_yaml: string;
	cron_expression: string;
	flowmesh_url: string;
	max_executions: number;
}

export interface GetFlowMeshJobListResponse {
	jobs: FlowMeshJobItem[];
}

// Scheduler writes three well-known result shapes:
//   1. success       → { ok: true,  status_code: 200, body: <object|string> }
//   2. http failure  → { ok: false, status_code: N,    body: <error body> }
//   3. pre-http fail → { ok: false, error: "<message>" }
// All fields optional; the dialog fallback-chains body → error → result.
export interface FlowMeshJobExecutionResult {
	ok?: boolean;
	status_code?: number;
	body?: unknown;
	error?: string;
}

export interface FlowMeshJobExecutionItem {
	job_id: string;
	timestamp: string;
	result: FlowMeshJobExecutionResult;
}

export interface GetFlowMeshJobExecutionsResponse {
	executions: FlowMeshJobExecutionItem[];
}

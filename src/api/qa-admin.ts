// QuantArena admin endpoints bridged through lum.id.
//
// These call `/api/v1/qa-admin/*` on lum.id, which nginx rewrites to
// `/api/v1/admin/*` and forwards to trading_app (LQA backend). The
// lm_session cookie rides along automatically (same origin from the
// browser's perspective); LQA's introspect middleware reads it via
// its cookie fallback. No new bearer flow needed.
//
// Surface mirrors the LQA management app's own API files so a
// future retirement of `/proj/quantarena/management` is literally a
// file delete + route remove, nothing else.

import apiClient from "./client";

// ─── Shared envelopes ────────────────────────────────────────────

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

// ─── Competitions ────────────────────────────────────────────────

export interface CampaignFields {
	id?: number;
	title: string;
	subtitle: string;
	type: string;
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
	competition_id?: number;
}

export interface CompetitionItem {
	id: number;
	name: string;
	market_id: number;
	market_name: string;
	symbols: string[];
	initial_funding: number;
	trading_fees: number;
	live_price_source: string;
	start_time: number;
	end_time: number;
	status: string;
	participant_count: number;
	featured: boolean;
	showcase: boolean;
	campaign?: CampaignFields | null;
	create_time: number;
	update_time: number;
}

export interface GetCompetitionListResponse {
	competitions: CompetitionItem[];
}

export interface CompetitionListParams {
	page?: number;
	page_size?: number;
	status?: string;
}

export interface CreateCompetitionRequest {
	name: string;
	market_id: number;
	initial_funding: number;
	trading_fees: number;
	start_time: number;
	end_time: number;
}

export interface UpdateCompetitionWithCampaignRequest {
	competition: CreateCompetitionRequest;
	campaign?: CampaignFields | null;
	remove_campaign?: boolean;
}

export async function listCompetitions(
	params: CompetitionListParams
): Promise<PaginatedResponse<GetCompetitionListResponse>> {
	const r = await apiClient.get<PaginatedResponse<GetCompetitionListResponse>>(
		"/api/v1/qa-admin/competitions",
		{ params }
	);
	return r.data;
}

export async function createCompetition(
	data: CreateCompetitionRequest
): Promise<BaseResponse> {
	const r = await apiClient.post<BaseResponse>(
		"/api/v1/qa-admin/competitions",
		data
	);
	return r.data;
}

export async function updateCompetition(
	id: number,
	data: CreateCompetitionRequest
): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/competitions/${id}`,
		data
	);
	return r.data;
}

export async function deleteCompetition(id: number): Promise<BaseResponse> {
	const r = await apiClient.delete<BaseResponse>(
		`/api/v1/qa-admin/competitions/${id}`
	);
	return r.data;
}

export async function setCompetitionFeatured(
	id: number,
	featured: boolean
): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/competitions/${id}/featured`,
		{ featured }
	);
	return r.data;
}

export async function setCompetitionShowcase(
	id: number,
	showcase: boolean
): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/competitions/${id}/showcase`,
		{ showcase }
	);
	return r.data;
}

export async function updateCompetitionWithCampaign(
	id: number,
	data: UpdateCompetitionWithCampaignRequest
): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/competitions/${id}/with-campaign`,
		data
	);
	return r.data;
}

export async function getCompetitionCampaign(
	id: number
): Promise<DataResponse<CampaignFields | null>> {
	const r = await apiClient.get<DataResponse<CampaignFields | null>>(
		`/api/v1/qa-admin/competitions/${id}/campaign`
	);
	return r.data;
}

// ─── Markets (needed for the competition edit dialog's dropdown) ─

export interface MarketItem {
	id: number;
	name: string;
	symbols: string[];
	live_price_source: string;
	create_time: number;
	update_time: number;
}

export interface GetMarketListResponse {
	markets: MarketItem[];
}

export async function listMarkets(params: {
	page?: number;
	page_size?: number;
}): Promise<PaginatedResponse<GetMarketListResponse>> {
	const r = await apiClient.get<PaginatedResponse<GetMarketListResponse>>(
		"/api/v1/qa-admin/markets",
		{ params }
	);
	return r.data;
}

export interface CreateMarketRequest {
	name: string;
	symbols: string[];
	live_price_source: string;
}

export async function createMarket(
	data: CreateMarketRequest
): Promise<BaseResponse> {
	const r = await apiClient.post<BaseResponse>(
		"/api/v1/qa-admin/markets",
		data
	);
	return r.data;
}

export async function updateMarket(
	id: number,
	data: { name: string }
): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/markets/${id}`,
		data
	);
	return r.data;
}

export async function deleteMarket(id: number): Promise<BaseResponse> {
	const r = await apiClient.delete<BaseResponse>(
		`/api/v1/qa-admin/markets/${id}`
	);
	return r.data;
}

export interface GetLivePriceSourceListResponse {
	sources: string[];
}

export async function listLivePriceSources(): Promise<
	DataResponse<GetLivePriceSourceListResponse>
> {
	const r = await apiClient.get<DataResponse<GetLivePriceSourceListResponse>>(
		"/api/v1/qa-admin/markets/live-price-sources"
	);
	return r.data;
}

export interface SymbolItem {
	symbol: string;
	name: string;
}

export interface GetSymbolsListResponse {
	symbols: SymbolItem[];
}

export async function listSymbols(params: {
	source: string;
	fuzzy?: string;
}): Promise<DataResponse<GetSymbolsListResponse>> {
	const r = await apiClient.get<DataResponse<GetSymbolsListResponse>>(
		"/api/v1/qa-admin/markets/symbols",
		{ params }
	);
	return r.data;
}

// ─── Backtesting templates ───────────────────────────────────────

export interface TemplateItem {
	id: number;
	user_id: number;
	name: string;
	description: string;
	type: string;
	start_date: number;
	end_date: number;
	create_time: number;
	update_time: number;
}

export interface GetTemplateListResponse {
	templates: TemplateItem[];
}

export interface CreateTemplateRequest {
	name: string;
	description: string;
	start_date: number;
	end_date: number;
}

export async function listTemplates(params: {
	page?: number;
	page_size?: number;
}): Promise<PaginatedResponse<GetTemplateListResponse>> {
	const r = await apiClient.get<PaginatedResponse<GetTemplateListResponse>>(
		"/api/v1/qa-admin/templates",
		{ params: { ...params, type: "system" } }
	);
	return r.data;
}

export async function createTemplate(
	data: CreateTemplateRequest
): Promise<BaseResponse> {
	const r = await apiClient.post<BaseResponse>(
		"/api/v1/qa-admin/templates",
		data
	);
	return r.data;
}

export async function deleteTemplate(id: number): Promise<BaseResponse> {
	const r = await apiClient.delete<BaseResponse>(
		`/api/v1/qa-admin/templates/${id}`
	);
	return r.data;
}

// ─── FlowMesh jobs ───────────────────────────────────────────────

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

export interface GetFlowMeshJobListResponse {
	jobs: FlowMeshJobItem[];
}

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

export async function listFlowMeshJobs(params: {
	page?: number;
	page_size?: number;
}): Promise<PaginatedResponse<GetFlowMeshJobListResponse>> {
	const r = await apiClient.get<PaginatedResponse<GetFlowMeshJobListResponse>>(
		"/api/v1/qa-admin/flowmesh-jobs",
		{ params }
	);
	return r.data;
}

export async function deleteFlowMeshJob(id: number): Promise<BaseResponse> {
	const r = await apiClient.delete<BaseResponse>(
		`/api/v1/qa-admin/flowmesh-jobs/${id}`
	);
	return r.data;
}

export async function pauseFlowMeshJob(id: number): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/flowmesh-jobs/${id}/pause`
	);
	return r.data;
}

export async function resumeFlowMeshJob(id: number): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/flowmesh-jobs/${id}/resume`
	);
	return r.data;
}

export async function stopFlowMeshJob(id: number): Promise<BaseResponse> {
	const r = await apiClient.put<BaseResponse>(
		`/api/v1/qa-admin/flowmesh-jobs/${id}/stop`
	);
	return r.data;
}

export async function listFlowMeshJobExecutions(id: number): Promise<
	DataResponse<GetFlowMeshJobExecutionsResponse>
> {
	const r = await apiClient.get<DataResponse<GetFlowMeshJobExecutionsResponse>>(
		`/api/v1/qa-admin/flowmesh-jobs/${id}/executions`
	);
	return r.data;
}

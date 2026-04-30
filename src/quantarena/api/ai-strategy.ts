import apiClient from './client';
import type { DataResponse } from './types';

export interface CreateAIStrategyRequest {
	name: string;
	description?: string;
	competition_id: number;
	template: 'llm_bot' | 'auto_research';
	provider: 'openai' | 'anthropic' | 'xai' | 'deepseek';
	symbols: string[];
	interval_seconds?: number;
	prompt?: string;
}

export interface CreateAIStrategyResponse {
	strategy_id: number;
	strategy_name: string;
	api_token: string;
	template: string;
	provider: string;
	symbols: string[];
	interval_seconds: number;
	bot_status: 'scheduled' | 'failed';
	bot_job_id?: string;
	bot_script?: string;
	bot_error?: string;
	research_url: string;
}

export async function createAIStrategy(req: CreateAIStrategyRequest): Promise<CreateAIStrategyResponse> {
	const r = await apiClient.post<DataResponse<CreateAIStrategyResponse>>('/api/v1/ai-strategies', req);
	return r.data.data;
}

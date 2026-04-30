import apiClient from './client';
import type { DataResponse } from './types';

export interface ResearchExecution {
	timestamp: string;
	ok: boolean;
	error?: string;
	body_tail?: string;
}

export interface ResearchJobInfo {
	job_id: number;
	name: string;
	cron: string;
	status: string;
	scheduler_status?: string;
	lumidos_job_id: string;
	total_runs: number;
	last_run_at?: string;
	last_error?: string;
	executions?: ResearchExecution[];
	source?: 'hosted' | 'local' | string;
	reported_at?: number;
	create_time: number;
}

export interface ResearchBundle {
	strategy_id: number;
	strategy_name: string;
	description: string;
	status: string;
	competition_id?: number;
	competition_name?: string;
	jobs: ResearchJobInfo[];
}

export async function getResearchByStrategy(strategyId: number): Promise<ResearchBundle> {
	const r = await apiClient.get<DataResponse<ResearchBundle>>(`/api/v1/research/${strategyId}`);
	return r.data.data;
}

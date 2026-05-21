// Typed client for GET /api/v1/admin/jobs — the unified Running Jobs surface.
//
// Shape mirrors lumid_identity/internal/handler/jobs.go (JobRow + JobsResponse).
// The backend reads ~/.lumilake/jobs.jsonl, where the autoresearch loops
// (and any future submitter) append job records via the submit_jobs skill set
// at LumidOS/sdk/skills/submit_jobs/. One ledger, one client, one panel.

import axios from 'axios';

export type JobSource = 'cron' | 'flowmesh' | 'lumilake' | 'loop_cycle';

export type JobState =
	| 'queued'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'scheduled';

export interface JobRow {
	job_id: string;
	source: JobSource;
	kind: string;
	submitter_app: string;
	submitter_loop: string;
	state: JobState;
	started_at: number;
	finished_at?: number;
	spec_summary: string;
	spec?: Record<string, unknown>;
	output_url?: string;
	output?: unknown;
	error?: string;
	updated_at: number;
}

export interface JobsSummary {
	running: number;
	queued: number;
	succeeded_24h: number;
	failed_24h: number;
	total_in_ledger: number;
}

export interface JobsResponse {
	jobs: JobRow[];
	summary: JobsSummary;
}

export interface ListJobsParams {
	submitter_app?: string;
	submitter_loop?: string;
	source?: JobSource;
	state?: JobState;
}

const api = axios.create({ baseURL: '/', timeout: 15_000, withCredentials: true });

export async function listJobs(params: ListJobsParams = {}): Promise<JobsResponse> {
	const r = await api.get<JobsResponse>('/api/v1/admin/jobs', { params });
	return r.data;
}

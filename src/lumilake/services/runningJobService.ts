import { apiService } from "@/lumilake/services/api";
import {
  JOB_STATUSES,
  RunningJob,
  RunningJobListResponse,
  RunningJobKillResponse,
  JobProgressResponse,
  JobResultResponse,
  JobPreviewResponse,
  SubmitJobRequest,
  SubmitJobResponse,
} from "@/lumilake/types/jobs";

export type RunningJobFilter = {
  page: number;
  pageSize: number;
  search?: string;
  filterBy?: "name" | "status";
  status?: JOB_STATUSES;
  executedAt?: string;
};


export const RunningJobService = {

  getRunningJobs: async (
    filter: RunningJobFilter
  ): Promise<RunningJobListResponse> => {

    const query = new URLSearchParams();

    query.append("include_all", "true");
    query.append("page", filter.page.toString());

    query.append("page_size", filter.pageSize.toString());

    if (filter.search)
      query.append("search", filter.search);

    if (filter.status)
      query.append("status", filter.status);

    if (filter.executedAt)
      query.append("executed_at", filter.executedAt);

    /**
     * API RESPONSE FORMAT:
     * {
     *   ok: true,
     *   data: {
     *     items: [],
     *     page: number,
     *     page_size: number,
     *     total: number,
     *     total_pages: number
     *   }
     * }
     */

    const res = await apiService.get<any>(
      `/jobs?${query.toString()}`
    );

    const data = res.data;

    return {
      total: data.total,
      page: data.page,
      page_size: data.page_size,
      total_page: data.total_pages,
      items: data.items.map((job: any): RunningJob => ({
        id: job.job_id,
        description: job.description || "",
        status: job.status?.toLowerCase(),
        started_at: job.started_at
          ? new Date(job.started_at)
          : undefined,
        submitted_at: job.submitted_at
          ? new Date(job.submitted_at)
          : undefined,
        finished_at: job.finished_at
          ? new Date(job.finished_at)
          : undefined,
        error: job.error || "",
        user_id: job.user_id || "",
      })),

    };

    

  },

  getJobProgress: async (
    jobId: string
  ): Promise<JobProgressResponse> => {
    const res = await apiService.get<JobProgressResponse>(
      `/jobs/${jobId}/progress`
    );
    return res;
  },

  

getJobDetail: async (
  jobId: string
): Promise<RunningJob> => {

  try {
    const res = await apiService.get<any>(`/jobs/${jobId}`);
    const job = res.data;
    
    return {
      id: job.job_id ?? job.id ?? jobId,
      description: job.description ?? "sample job description",
      status: (job.status ?? "queued").toLowerCase() as JOB_STATUSES,
      started_at: job.started_at ? new Date(job.started_at) : undefined,
      submitted_at: job.submitted_at ? new Date(job.submitted_at) : undefined,
      executed_at: job.executed_at ? new Date(job.executed_at) : undefined,
      finished_at: job.finished_at ? new Date(job.finished_at) : undefined,
      error: job.error ?? "",
      user_id: job.user_id ?? "",
      result: job.result ?? undefined,
      
    };
  } catch (_err) {
    // Fallback to mocked single job so JobDetail shows data during development
    return {
      id: "Job 1",
      description: "This is a sample job description for Job 1.",
      status: "running" as JOB_STATUSES,
      submitted_at: new Date("2026-08-24T14:15:22Z"),
      executed_at: new Date("2026-08-24T14:15:22Z"),
      started_at: new Date("2026-08-24T14:15:22Z"),
      finished_at: new Date("2026-08-24T14:15:22Z"),
      error: "string",
      user_id: "string",
    };
  }
},


requestKillJob: async (
  jobId: string
): Promise<RunningJobKillResponse> => {
  return await apiService.post(
    `/jobs/${jobId}/cancel`
  );
},

getJobResult: async (
  jobId: string
): Promise<JobResultResponse> => {
  const res = await apiService.get<JobResultResponse>(
    `/jobs/${jobId}/result`
  );

  return res;
},

downloadJobArtifact: (
jobId: string,
path: string
): Promise<Blob> => {
return apiService.get<Blob>(
  `/jobs/${jobId}/artifact`,
  {
    responseType: "blob",
    params: { path },
  }
);
},

previewJobSchedule: async (
  workflow: string,
  workflowFormat = ''
): Promise<JobPreviewResponse> => {
  return await apiService.post<JobPreviewResponse>(
    `/job/preview`,
    { workflow },
    { headers: { 'Workflow-Format': workflowFormat } }
  );
},

submitJob: async (
  request: SubmitJobRequest,
  workflowFormat = ''
): Promise<SubmitJobResponse> => {
  return await apiService.post<SubmitJobResponse, SubmitJobRequest>(
    `/jobs`,
    request,
    { headers: { 'Workflow-Format': workflowFormat } }
  );
},

};
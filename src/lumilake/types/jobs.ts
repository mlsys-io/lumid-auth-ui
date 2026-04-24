
export enum JOB_STATUSES {
  QUEUED = "pending",
  RUNNING = "running",
  FAILED = "failed",
  KILLED = "cancelled",
  SUCCEEDED = "completed",
}

export enum JOB_TYPES {
  SQL = "sql",
  PYTHON = "python",
  MODELING = "modeling",
  LOW_CODE = "low-code",
}

export interface ChatMessage {
  role: string;
  content: string;
}

export type ChatHistory = ChatMessage[][];

export interface JobOutputs {
  [nodeName: string]: {
    [outputKey: string]: string[];
  };
}

export interface JobChatHistories {
  [nodeName: string]: {
    [outputKey: string]: ChatHistory;
  };
}

export interface JobResultData {
  job_id: string;
  result: {
    outputs: JobOutputs;
    static_prefix_map: Record<string, string> | null;
    dynamic_prefix_map: Record<string, string> | null;
    error_info: string | null;
    chat_histories: JobChatHistories;
  };
}

export interface JobResultResponse {
  ok: boolean;
  data: JobResultData;
}



export interface RunningJob {
  id: string;
  description: string;
  status: JOB_STATUSES;
  submitted_at?: Date;
  started_at?: Date;
  finished_at?: Date;
  error: string;
  user_id: string;
}

export type RunningJobListResponse = {
  total: number;
  page: number;
  page_size: number;
  total_page: number;
  items: RunningJob[];
};

export interface OverallProgress {
  total_nodes: number;
  completed_nodes: number;
  failed: number;
  dispatched: number;
  pending: number;
  percentage: number;
}

export type RunningJobKillResponse = {
  ok: boolean;
  jobs: {
    status: JOB_STATUSES;
  };
};


export interface BatchProgressNodes {
  succeeded: number;
  failed: number;
  pending: number;
  dispatched: number;
  total: number;
}


export interface BatchProgress {
  batch_id: string,
  status: string,
  nodes: BatchProgressNodes,
  elapsed_time: number;
}

export interface JobProgressOutputDetails {
  total: number,
  succeeded: number | null,
  failed: number | null,
  pending: number | null,
  dispatched: number | null
}

export interface JobProgressBatchProgressDetails {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  dispatched: number;
  overall_progress: OverallProgress;
  batches: BatchProgress[];
}
export interface JobProgress {
  job_id: string;
  progress: {
    batch_progress: JobProgressBatchProgressDetails;
    outputs: {
      details: JobProgressOutputDetails;
    }
  };
}

export interface JobProgressResponse {
  ok: boolean;
  data: JobProgress;
}

export interface JobPreviewData {
  request_id: string;
  selected_workers: string[];
  worker_assignment: Record<string, string[]>;
  runtime_graph_node_counts: Record<string, number>;
  merged_runtime_node_count: number;
}

export interface JobPreviewResponse {
  ok: boolean;
  data: JobPreviewData;
}

export interface SubmitJobItem {
  workflow: string;
  inputs: Record<string, unknown[]>;
  output_location: {
    type: string;
    table?: string;
    column?: string;
    prefix?: string;
  };
  input_batch_size: number;
  name: string;
}

export interface SubmitJobRequest {
  data: SubmitJobItem[];
  priority: 'low' | 'medium' | 'high';
}

export interface SubmitJobResponse {
  ok: boolean;
  data: {
    job_id: string;
    status: string;
  };
}
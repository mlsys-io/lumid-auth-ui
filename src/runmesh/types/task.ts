/**
 * 单任务详情（面向“单任务结果弹窗”）
 * 注意：后端接口仍在对接中，本文件以可扩展/兼容为主。
 */

export type TaskStatus =
  | 'COMPLETED'
  | 'ERROR'
  | 'FAILED'
  | 'RUNNING'
  | 'DISPATCHED'
  | 'PENDING'
  | 'QUEUED'
  | 'CANCELLED'
  | (string & {});

export interface ITaskConfig {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    owner?: string;
    [key: string]: any;
  };
  spec?: ITaskSpec;
  [key: string]: any;
}

export interface ITaskSpec {
  taskType?: string;

  data?: {
    dataset_name?: string;
    config_name?: string;
    split?: string;
    prompt_column?: string;
    response_column?: string;
    max_samples?: number;
    [key: string]: any;
  };

  training?: {
    num_train_epochs?: number;
    batch_size?: number;
    learning_rate?: number;
    max_seq_length?: number;
    gradient_accumulation_steps?: number;
    save_steps?: number;
    [key: string]: any;
  };

  inference?: {
    max_tokens?: number;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    system_prompt?: string;
    [key: string]: any;
  };

  model?: {
    source?: {
      type?: string;
      identifier?: string;
    };
    vllm?: {
      gpu_memory_utilization?: number;
    };
    [key: string]: any;
  };

  resources?: {
    replicas?: number;
    hardware?: {
      cpu?: string;
      memory?: string;
      gpu?: {
        type?: string;
        count?: number;
      };
    };
  };

  output?: {
    destination?: {
      type?: string;
      timeoutSec?: number;
    };
    artifacts?: string[];
  };

  [key: string]: any;
}

export interface ITaskDetail {
  taskId: string;
  taskNo?: string;
  taskName?: string;
  taskType: 'sft' | 'inference' | (string & {});
  status: TaskStatus;
  submitTime?: string;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  totalRuntimeSec?: number;
  totalCost?: number;
  externalTaskId?: string;
  graphNodeName?: string;
  parsed?: string; // JSON 字符串
  parsedConfig?: ITaskConfig; // 解析后的配置（可选）
  error?: string | null;
  completed?: boolean;
  failed?: boolean;

  // 扩展字段（可选）
  appName?: string;
  assignedWorker?: string;
  costAmount?: string | number;
  costCurrency?: string;
}

export interface ISFTResult {
  final_model_path?: string;
  final_model_archive_url?: string;
  training_loss?: number;
  training_steps?: number;
  [key: string]: any;
}

export interface IInferenceResult {
  responses?: Array<{
    question: string;
    answer: string;
    [key: string]: any;
  }>;
  total_count?: number;
  success_count?: number;
  [key: string]: any;
}

export interface ITaskResult {
  task_id: string;
  result: ISFTResult | IInferenceResult | Record<string, any>;
}

export interface ITaskWithResult {
  task: ITaskDetail;
  result?: ITaskResult;
}

/**
 * n8n / NebulaFlow 节点执行数据（runData）类型
 * 用于“n8n 风格执行日志弹窗”渲染。
 */
export interface ISourceNode {
  previousNode: string;
  previousNodeRun: number;
}

export interface IRunmeshMetadata {
  task_id: string;
  workflow_id: string;
  status: string;
  task_type: string;
  parsed: any;
  result_file?: {
    detail?: string;
    url?: string;
  };
  [key: string]: any;
}

export interface INodeOutputItem {
  json: Record<string, any>;
  binary?: Record<string, any>;
  pairedItem?: any;
  [key: string]: any;
}

export interface INodeData {
  main: Array<Array<INodeOutputItem>>;
  [key: string]: any;
}

export interface INodeExecutionData {
  startTime: number; // unix ms
  executionTime: number; // ms
  executionStatus: 'success' | 'error' | 'running' | (string & {});
  source?: ISourceNode[];
  metadata?: {
    runmesh?: IRunmeshMetadata;
    [key: string]: any;
  };
  data?: INodeData;
  error?: {
    message?: string;
    description?: string;
    context?: Record<string, any>;
    [key: string]: any;
  };
  [key: string]: any;
}

export type RunDataMap = Record<string, INodeExecutionData[]>;

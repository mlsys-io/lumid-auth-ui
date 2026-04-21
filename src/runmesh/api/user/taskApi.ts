import { httpUser as http } from '../../utils/axios';
import { NebulaTaskVo, NebulaWorkflowSummary } from '@/runmesh/types';

interface PageQuery {
  pageNum: number;
  pageSize: number;
}

interface TableDataInfo<T> {
  rows: T[];
  total: number;
  code: number;
  msg: string;
}

// 获取任务列表
export const getTaskList = async (
  params: {
    taskName?: string;
    appName?: string;
    status?: string;
    workflowId?: string;
    startTime?: string;
    endTime?: string;
  } = {},
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<NebulaTaskVo>> => {
  const query: Record<string, string | number> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  if (params.taskName) query.taskName = params.taskName;
  if (params.appName) query.appName = params.appName;
  if (params.status) query.status = params.status;
  if (params.workflowId) query.workflowId = params.workflowId;
  if (params.startTime) query.startTime = params.startTime;
  if (params.endTime) query.endTime = params.endTime;

  return http.get<TableDataInfo<NebulaTaskVo>>('/runmesh/task/list', { params: query });
};

// 获取工作流列表（工作流视角）
export const getWorkflowSummaryList = async (
  workflowId: string | undefined,
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<NebulaWorkflowSummary>> => {
  const query: Record<string, string | number> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  if (workflowId) query.workflowId = workflowId;

  return http.get<TableDataInfo<NebulaWorkflowSummary>>('/runmesh/task/list', { params: query });
};

// 获取某个工作流下的所有任务（axios 拦截器会自动把 {code,data} 解包成 data）
export const getWorkflowTaskList = async (workflowId: string): Promise<NebulaTaskVo[]> => {
  return http.get<NebulaTaskVo[]>(`/runmesh/task/workflow-list/${workflowId}`);
};

// 算力消耗明细：获取当前用户任务列表；可选 startDate/endDate（yyyy-MM-dd）按 startTime 过滤，用于仪表盘按「近七天/近七周/近三月」统计
export const getUserUsageTaskList = async (
  pageQuery: PageQuery & { startDate?: string; endDate?: string } = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<NebulaTaskVo>> => {
  const query: Record<string, string | number | undefined> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
    startDate: pageQuery.startDate,
    endDate: pageQuery.endDate,
  };
  return http.get<TableDataInfo<NebulaTaskVo>>(`/runmesh/task/usage-list`, { params: query });
};

// 获取任务详情（含工作流下所有任务）
export const getTaskWithWorkflowTasks = async (taskId: string): Promise<NebulaTaskVo[]> => {
  return http.get<NebulaTaskVo[]>(`/runmesh/task/with-workflow-tasks/${taskId}`);
};

// 获取单个任务详情
// 注意：该接口在不同场景下可能返回：
// - 单任务（NebulaTaskVo）
// - 工作流运行详情（含 tasks[] + data.resultData.runData）
// 因此这里返回 unknown，具体结构在调用侧做兼容解析。
export const getTaskDetail = async (id: string | number): Promise<unknown> => {
  return http.get<unknown>(`/runmesh/task/${id}`);
};

// 获取指定工作流日志（/runmesh/n8n/workflows/{workflow_id}/logs）
export const getWorkflowLogs = async (workflowId: string): Promise<unknown[]> => {
  const response = await http.post<unknown>(`/runmesh/n8n/workflows/${workflowId}/logs`);

  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];

  const payload = response as Record<string, unknown>;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.data)) return payload.data;

  const nestedData = payload.data as Record<string, unknown> | undefined;
  if (nestedData && Array.isArray(nestedData.entries)) return nestedData.entries;

  return [];
};

// 获取指定任务日志（/runmesh/n8n/tasks/{task_id}/logs）
export const getTaskLogs = async (taskId: string): Promise<unknown[]> => {
  const response = await http.post<unknown>(`/runmesh/n8n/tasks/${taskId}/logs`);

  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];

  const payload = response as Record<string, unknown>;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.data)) return payload.data;

  const nestedData = payload.data as Record<string, unknown> | undefined;
  if (nestedData && Array.isArray(nestedData.entries)) return nestedData.entries;

  return [];
};

// 根据taskId查询任务，使用tasksId接口获取单个任务对象，然后构建一二级列表格式返回
// 与getWorkflowSummaryList返回格式一致，用于前端展示
export const getTaskByTaskIdWithWorkflowList = async (
  taskId: string,
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<NebulaWorkflowSummary>> => {
  const query: Record<string, string | number> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };
  return http.get<TableDataInfo<NebulaWorkflowSummary>>(`/runmesh/task/by-task-id/${taskId}`, {
    params: query,
  });
};

// 添加任务
export const addTask = async (data: Partial<NebulaTaskVo>): Promise<number> => {
  return http.post<number>('/runmesh/task', data);
};

// 更新任务
export const updateTask = async (data: Partial<NebulaTaskVo>): Promise<void> => {
  await http.put<void>('/runmesh/task', data);
};

// 删除任务
export const deleteTask = async (ids: number[]): Promise<void> => {
  await http.delete<void>(`/runmesh/task/${ids.join(',')}`);
};

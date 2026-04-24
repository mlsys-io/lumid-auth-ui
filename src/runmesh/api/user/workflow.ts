import { httpUser as http } from '../../utils/axios';

/**
 * 工作流/应用 相关接口
 */

export interface WorkflowItem {
  id?: string;
  workflowId?: number | string;
  name?: string;
  description?: string;
  definitionJson?: string;
  version?: number;
  publishStatus?: string;
  status: string;
  remark: string;
  appType: string;
  icon: string;
  tags: string;
  isTemplate: string;
  downloads: number;
  favoriteCount?: number;
  useCount?: number;
  creator?: string;
  createBy: number;
  createTime: string;
  updateTime: string;
  auditStatus?: string; // 审核状态：0-待审核, 1-审核通过, 2-审核拒绝
  auditName?: string; // 审核人姓名
}

export interface WorkflowType {
  typeId: number;
  typeCode: string;
  typeName: string;
  typeDesc?: string;
  sortOrder?: number;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}

export interface WorkflowListParams {
  name?: string;
  appType?: string;
  keyword?: string;
  onlyMine?: boolean;
  status?: string;
  publishStatus?: string;
  isTemplate?: string;
  // 逗号分隔标签字符串，兼容标签筛选
  tags?: string;
  pageNum?: number;
  pageSize?: number;
}

/**
 * 获取应用/工作流列表
 */
export const getWorkflowList = (params: WorkflowListParams) =>
  http.get<PageResult<WorkflowItem>>('/runmesh/workflows/list', { params });

/**
 * 获取工作流类型（应用类型）列表
 */
export const getWorkflowTypes = () => http.get<WorkflowType[]>('/runmesh/workflow-types/list');

/**
 * 获取应用/工作流详情
 */
export const getWorkflowDetail = (workflowId: number | string) =>
  http.get<WorkflowItem>(`/runmesh/workflows/${workflowId}`);

/**
 * 创建应用/工作流
 */
export const createWorkflow = (data: Partial<WorkflowItem>) =>
  http.post<number>('/runmesh/workflows', data);

/**
 * 更新应用/工作流
 */
export const updateWorkflow = (data: Partial<WorkflowItem>) =>
  http.put<void>('/runmesh/workflows', data);

/**
 * 删除应用/工作流
 */
export const deleteWorkflow = (workflowIds: Array<number | string>) =>
  http.delete<void>(`/runmesh/workflows/${workflowIds.join(',')}`);

/**
 * 发布工作流
 */
export const publishWorkflow = (workflowId: number) =>
  http.put<void>(`/runmesh/workflows/${workflowId}/publish`);

/**
 * 提交应用审核
 */
export const submitWorkflowReview = (workflowId: string | number) =>
  http.post<number>('/runmesh/workflow/review/submit', { workflowId });

/**
 * 取消发布申请（仅限处理中状态，将应用恢复为草稿）
 */
export const cancelPublishReview = (workflowId: string | number) =>
  http.post<void>('/runmesh/workflow/review/cancel', { workflowId: String(workflowId) });

/**
 * 修改工作流状态
 */
export const changeWorkflowStatus = (workflowId: number | string, status: string) =>
  http.put<void>(`/runmesh/workflows`, {
    workflowId: workflowId.toString(),
    status,
  });

/**
 * 收藏工作流
 */
export const favoriteWorkflow = (workflowId: number | string) =>
  http.post<void>(`/runmesh/workflows/favorite/${workflowId}`);

/**
 * 取消收藏工作流
 */
export const unfavoriteWorkflow = (workflowId: number | string) =>
  http.delete<void>(`/runmesh/workflows/favorite/${workflowId}`);

/**
 * 获取收藏状态
 */
export const getFavoriteStatus = (workflowId: number | string) =>
  http.get<boolean>(`/runmesh/workflows/favorite/${workflowId}/status`);

/**
 * 获取收藏次数
 */
export const getFavoriteCount = (workflowId: number | string) =>
  http.get<number>(`/runmesh/workflows/favorite/${workflowId}/count`);

/**
 * 增加工作流使用次数（播放/运行一次）
 */
export const incrementWorkflowUse = (workflowId: number | string) =>
  http.post<void>(`/runmesh/workflows/${workflowId}/use`);

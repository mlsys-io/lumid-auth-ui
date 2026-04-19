import { http } from '../utils/axios';

/**
 * 应用审核相关接口
 */

export interface WorkflowReviewItem {
  reviewId: number;
  workflowId: number;
  name: string;
  description: string;
  appType: string;
  version: number;
  auditStatus: string; // 0-待审核, 1-审核通过, 2-审核拒绝
  auditReason?: string;
  submitterId: number;
  submitterName: string;
  submitTime?: string;
  auditUserId?: number;
  auditUserName?: string;
  auditTime?: string;
  remark?: string;
  createTime?: string;
  updateTime?: string;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}

export interface WorkflowReviewListParams {
  name?: string;
  appType?: string;
  auditStatus?: string;
  submitterName?: string;
  pageNum?: number;
  pageSize?: number;
}

/**
 * 获取应用审核列表
 */
export const getWorkflowReviewList = (params: WorkflowReviewListParams) =>
  http.get<PageResult<WorkflowReviewItem>>('/runmesh/workflow/review/list', { params });

/**
 * 获取应用审核详情
 */
export const getWorkflowReviewDetail = (reviewId: number) =>
  http.get<WorkflowReviewItem>(`/runmesh/workflow/review/${reviewId}`);

/**
 * 管理员审核（通过/拒绝）
 */
export const auditWorkflow = (data: {
  reviewId: number;
  auditStatus: string; // '1' 审核通过, '2' 审核拒绝
  auditReason?: string; // 拒绝时的备注
}) => http.put<void>('/runmesh/workflow/review/audit', data);

/**
 * 获取我的审核记录列表
 */
export const getMyWorkflowReviewList = (params: Partial<WorkflowReviewItem>) =>
  http.get<WorkflowReviewItem[]>('/runmesh/workflow/review/myList', { params });

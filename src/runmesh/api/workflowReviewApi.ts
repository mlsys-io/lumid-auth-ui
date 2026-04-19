import { http } from '@/runmesh/utils/axios';
import {
  WorkflowReviewItem,
  WorkflowReviewBo,
  WorkflowReviewQuery,
  TableDataInfo,
} from '@/runmesh/types/workflowReview';

// 应用审核API服务
export const workflowReviewApi = {
  // 分页查询审核列表
  getReviewList(params: WorkflowReviewQuery) {
    return http.get<TableDataInfo<WorkflowReviewItem>>('/runmesh/workflow/review/list', {
      params,
    });
  },

  // 获取单条审核记录
  getReviewDetail(reviewId: number) {
    return http.get<WorkflowReviewItem>(`/runmesh/workflow/review/${reviewId}`);
  },

  // 提交应用审核
  submitReview(data: WorkflowReviewBo) {
    return http.post<number>('/runmesh/workflow/review/submit', data);
  },

  // 管理员审核（通过/拒绝）
  auditReview(data: WorkflowReviewBo) {
    return http.put<void>('/runmesh/workflow/review/audit', data);
  },

  // 用户查询自己的审核记录列表
  getMyReviewList(params: Partial<WorkflowReviewBo>) {
    return http.get<WorkflowReviewItem[]>('/runmesh/workflow/review/myList', {
      params,
    });
  },

  // 删除审核记录
  deleteReview(reviewId: number) {
    return http.delete<void>(`/runmesh/workflow/review/${reviewId}`);
  },
};

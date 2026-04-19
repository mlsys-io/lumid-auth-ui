// 应用审核数据类型定义
export interface WorkflowReviewItem {
  reviewId?: number;
  workflowId?: number;
  name?: string;
  description?: string;
  appType?: string;
  version?: number;
  auditStatus?: string; // '0'-待审核, '1'-通过, '2'-拒绝
  auditReason?: string;
  submitterId?: number;
  submitterName?: string;
  submitTime?: string;
  auditUserId?: number;
  auditUserName?: string;
  auditTime?: string;
  remark?: string;
  createTime?: string;
  updateTime?: string;
  createBy?: number; // 创建人 ID
}

// 审核状态枚举
export enum AuditStatus {
  PENDING = '0', // 待审核
  APPROVED = '1', // 通过
  REJECTED = '2', // 拒绝
}

// 审核Bo类型
export interface WorkflowReviewBo {
  reviewId?: number;
  workflowId: number;
  auditStatus?: string;
  auditReason?: string;
  submitterId?: number;
  submitterName?: string;
  remark?: string;
}

// 分页查询参数
export interface WorkflowReviewQuery {
  auditStatus?: string;
  submitterName?: string;
  name?: string;
  appType?: string;
  pageNum: number;
  pageSize: number;
}

// API响应类型
export interface TableDataInfo<T> {
  rows: T[];
  total: number;
  pageNum: number;
  pageSize: number;
}

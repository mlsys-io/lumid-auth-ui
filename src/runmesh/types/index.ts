export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum NodeStatus {
  IDLE = 'IDLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  amount: number;
}

export interface GpuNode {
  id: string;
  supplier: 'Vast.ai' | 'AutoDL' | 'AWS' | 'FlowMesh Native';
  gpuModel: string;
  vram: string;
  region: string;
  pricePerHour: number;
  status: NodeStatus;
  load: number; // 0-100
}

export interface Task {
  id: string;
  name: string;
  workflowType: 'Dify' | 'Custom' | 'API';
  submittedAt: string;
  duration: string;
  cost: number;
  status: TaskStatus;
  gpuNodeId?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: number;
}

export interface WorkflowMarketItem {
  workflowMarketId: number;
  workflowId?: number;
  name: string;
  description: string;
  definitionJson?: string;
  version?: number;
  publishStatus: string;
  status: string;
  remark?: string;
  appType?: string;
  icon?: string;
  tags?: string;
  isTemplate?: string;
  downloads?: number;
  useCount?: number;
  favoriteCount?: number;
  creator?: string;
  createBy?: number;
  createTime?: string;
  updateTime?: string;
}

export interface NebulaTaskVo {
  taskId: number | string;
  userId?: number | string;
  workflowId?: number | string;
  taskNo?: string;
  taskName?: string;
  appName?: string;
  status?: string;
  submitTime?: string;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  // 从 n8n usages 汇总得到的总耗时（秒）
  totalRuntimeSec?: number;
  // 从 n8n usages 汇总得到的总费用
  totalCost?: number;
  usages?: Array<Record<string, any>>;
  costAmount?: number | string;
  costCurrency?: string;
  externalTaskId?: string;
  graphNodeName?: string;
  remark?: string;
  createTime?: string;
}

export interface NebulaWorkflowSummary {
  workflowId: string;
  name: string;
  lastTaskExecuteTime?: string;
  totalCostAmount?: string | number;
  costCurrency?: string;
  taskCount?: number;
  tasks?: NebulaTaskVo[] | null;
  // 二级列表分页信息
  taskTotal?: number;
  taskPageNum?: number;
  taskPageSize?: number;
  // n8n 兼容的执行数据格式（用于任务详情弹窗）
  data?: {
    resultData?: {
      runData?: Record<string, any[]>;
    };
  };
  // 执行状态
  status?: string;
  // 是否完成
  finished?: boolean;
}

// 添加一个映射函数来处理字段名不匹配的情况
export const mapBackendToWorkflowMarketItem = (backendData: any): WorkflowMarketItem => {
  return {
    workflowMarketId: backendData.workflowMarketId || backendData.workflow_market_id,
    workflowId: backendData.workflowId || backendData.workflow_id,
    name: backendData.name,
    description: backendData.description,
    definitionJson: backendData.definitionJson || backendData.definition_json,
    version: backendData.version,
    publishStatus: backendData.publishStatus || backendData.publish_status,
    status: backendData.status,
    remark: backendData.remark,
    appType: backendData.appType || backendData.app_type,
    icon: backendData.icon,
    tags: backendData.tags,
    isTemplate: backendData.isTemplate || backendData.is_template,
    downloads: backendData.downloads,
    useCount: backendData.useCount || backendData.use_count,
    favoriteCount: backendData.favoriteCount || backendData.favorite_count,
    creator: backendData.creator,
    createBy: backendData.createBy || backendData.create_by,
    createTime: backendData.createTime || backendData.create_time,
    updateTime: backendData.updateTime || backendData.update_time,
  };
};

// 用户交易记录视图对象
export interface NebulaUserTransactionVo {
  transactionId: number;
  tenantId?: string;
  userId?: number;
  transactionNo?: string;
  bizType?: string;
  bizSubtype?: string;
  description?: string;
  amount?: number;
  currency?: string;
  status?: string;
  transactionTime?: string;
  relatedId?: number;
  relatedType?: string;
  invoiceUrl?: string;
  remark?: string;
  createTime?: string;
}

// 用户消费账单视图对象
export interface SysUserBillVo {
  id: number;
  tenantId?: string;
  userId?: number;
  billNo?: string;
  bizType?: string;
  billType?: string;
  amount?: number;
  balanceAfter?: number;
  payChannel?: string;
  payStatus?: string;
  billTime?: string;
  status?: string;
  remark?: string;
  createTime?: string;
  currency?: string;
}

// GPU服务器节点视图对象
export interface SysGpuNodeVo {
  id: number;
  tenantId?: string;
  nodeName?: string;
  nodeCode?: string;
  vendorId?: number;
  hostName?: string;
  hostIp?: string;
  gpuModel?: string;
  gpuCount?: number;
  cpuCores?: number;
  memoryGb?: number;
  status?: string;
  remark?: string;
  createTime?: string;
}

// 支付请求参数
export interface NebulaPayRequestBo {
  orderNo: string; // 订单号
  userId: number; // 用户ID
  amount: number; // 支付金额
  subject: string; // 订单标题
  countryCode?: string; // 国家/地区代码
  returnUrl?: string; // 支付成功后前端回跳地址
  notifyUrl?: string; // 支付结果通知回调地址
  body?: string; // 订单描述
}

// 支付响应数据
export interface NebulaPayResponseVo {
  success: boolean; // 发起支付是否成功
  errorCode?: string; // 错误码
  errorMsg?: string; // 错误信息
  payData?: string; // 支付数据（支付宝返回HTML form字符串）
  rawResponse?: string; // 三方原始返回
  currency?: string; // 实际使用的币种
  payChannel?: string; // 支付渠道编码
}

// 用户余额信息
export interface UserBalanceVo {
  userId: number;
  amount: number; // 可用金额（美元）
  frozenBalance?: number; // 冻结余额
  totalBalance?: number; // 总余额
  quota?: number; // 配额（如果使用quota系统）
  currency?: string; // 币种
}

import { httpUser as http } from '../../utils/axios';
import { SysUserBillVo } from '@/runmesh/types';

// 分页查询参数
export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
}

// 分页响应结构
export interface TableDataInfo<T> {
  rows: T[];
  total: number;
}

// 用户消费账单查询参数 - 对应后端SysUserBillBo
export interface SysUserBillBo extends PageQuery {
  userId?: number;
  billNo?: string;
  bizType?: string;
  billType?: string;
  payStatus?: string;
  timeRange?: string; // 后端接收为字符串类型，对应day/week/month
}

// 用户账单列表请求体 - POST /list，日期格式 YYYY-MM-DD
export interface UserBillListQuery {
  from_date: string;
  to_date: string;
}

// 用户账单列表项 - queryPageList 返回的 billing_info 元素（单条展示行也复用，含 external_id 等）
export interface UserBillBillingInfo {
  owner_id?: string;
  supplier_id?: string;
  from_date?: string;
  to_date?: string;
  total_cost?: number | string;
  /** 新结构：展平后的用户标识 */
  external_id?: string;
  principal_id?: string;
}

// 新接口：每个用户的账单项（data 数组元素）
export interface UserBillListItem {
  total_cost?: number | string;
  billing_info?: Array<{ owner_id?: string; supplier_id?: string; total_cost?: number | string }>;
  principal_id?: string;
  org_id?: string;
  external_id?: string;
}

// 用户账单列表接口返回的 data 结构（兼容旧：单对象含 billing_info；新：data 直接为 UserBillListItem[]）
export interface UserBillListData {
  from_date?: string;
  to_date?: string;
  total_cost?: number;
  billing_info?: UserBillBillingInfo[];
}

// 用户账单详情接口返回的 data 结构 - queryById
export interface UserBillDetailData {
  owner_id?: string;
  supplier_id?: string;
  from_date?: string;
  to_date?: string;
  total_cost?: number;
}

// 供应商结算查询参数 - 统一使用 from_date/to_date 格式 YYYY-MM-DD
export interface SysSupplierSettlementBo extends PageQuery {
  vendorId?: number;
  settlementNo?: string;
  status?: string;
  timeRange?: string;
  from_date: string; // 开始日期 YYYY-MM-DD
  to_date: string; // 结束日期 YYYY-MM-DD
}

// 平台对账查询参数 - 统一使用 from_date/to_date 格式 YYYY-MM-DD
export interface SysPlatformReconciliationBo {
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  from_date: string; // 开始日期 YYYY-MM-DD
  to_date: string; // 结束日期 YYYY-MM-DD
  userIncome?: number;
  supplierCost?: number;
  grossProfit?: number;
  status?: string;
  timeRange?: string;
  remark?: string;
}

// 供应商结算视图对象
export interface SysSupplierSettlementVo {
  id?: number;
  settlementNo?: string;
  vendorId?: number;
  vendorName?: string;
  periodStart?: string;
  periodEnd?: string;
  amount?: number;
  status?: string;
  settlementTime?: string;
  remark?: string;
  createTime?: string;
  supplier_id?: string | number;
  from_date?: string | object;
  to_date?: string | object;
  total_cost?: number | string;
}

// 平台对账视图对象
export interface SysPlatformReconciliationVo {
  id?: number;
  tenantId?: string;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  userIncome?: number;
  supplierCost?: number;
  grossProfit?: number;
  status?: string;
  remark?: string;
  createDept?: number;
  createBy?: number;
  createTime?: string;
  updateBy?: number;
  updateTime?: string;
  delFlag?: string;
}

// 用户消费账单表单对象 - 对应后端SysUserBillBo用于新增/修改
export interface SysUserBillForm {
  id?: number;
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
  timeRange?: string;
}

// 供应商结算表单对象 - 对应后端SysSupplierSettlementBo用于新增/修改
export interface SysSupplierSettlementForm {
  id?: number;
  vendorId?: number;
  settlementNo?: string;
  periodStart?: string;
  periodEnd?: string;
  amount?: number;
  status?: string;
  payTime?: string;
  remark?: string;
  timeRange?: string;
}

// 平台对账表单对象 - 对应后端SysPlatformReconciliationBo用于新增/修改
export interface SysPlatformReconciliationForm {
  id?: number;
  tenantId?: string;
  periodType?: string; // 对账周期类型: day/week/month
  periodStart: string; // 对账周期开始日期 - 必填
  periodEnd: string; // 对账周期结束日期 - 必填
  userIncome: number; // 用户侧总收入 - 必填
  supplierCost: number; // 供应商侧总成本 - 必填
  grossProfit: number; // 平台毛利 - 必填
  status: string; // 对账状态: normal/warning/error - 必填
  remark?: string;
  timeRange?: string;
}

// 获取用户消费账单列表（管理员权限）- POST /list，请求体 from_date/to_date 格式 YYYY-MM-DD
export const getUserBillList = (params: UserBillListQuery) => {
  return http.post<UserBillListData>('/runmesh/finance/userBill/list', params);
};

// 获取用户消费账单详情 - POST /{id}，id 为 supplier_id，请求体 from_date/to_date 格式 YYYY-MM-DD
export const getUserBillDetailById = (id: string, query: UserBillListQuery) => {
  return http.post<UserBillDetailData>(
    `/runmesh/finance/userBill/${encodeURIComponent(id)}`,
    query,
  );
};

// 查看详情（合并接口）：type 为 platformReconciliation、userBill 或 supplierSettlement，请求体含 from_date、to_date（YYYY-MM-DD）
export const getFinanceDetailById = (
  type: 'platformReconciliation' | 'userBill' | 'supplierSettlement',
  id: string,
  query: { from_date: string; to_date: string; timeRange?: string },
) => {
  return http.post<
    PlatformReconciliationDetailMerged | UserBillDetailData | SysSupplierSettlementVo
  >(`/runmesh/finance/detail/${type}/${encodeURIComponent(id)}`, query);
};

// 平台对账详情对象（后端 type=platformReconciliation 时返回，仅汇总字段）
export interface PlatformReconciliationDetailMerged {
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  userIncome?: number;
  supplierCost?: number;
  grossProfit?: number;
  status?: string;
}

// 获取用户消费账单详情（旧接口，保留兼容）
export const getUserBillDetail = (id: number) => {
  return http.get<SysUserBillVo>(`/runmesh/finance/userBill/${id}`);
};

// 新增用户消费账单
export const addUserBill = (data: SysUserBillForm) => {
  return http.post('/runmesh/finance/userBill', data);
};

// 更新用户消费账单
export const updateUserBill = (data: SysUserBillForm) => {
  return http.put('/runmesh/finance/userBill', data);
};

// 删除用户消费账单
export const deleteUserBill = (id: number) => {
  return http.delete(`/runmesh/finance/userBill/${id}`);
};

// 获取当前用户账单列表
export const getCurrentUserBillList = (params: SysUserBillBo) => {
  return http.post<TableDataInfo<SysUserBillVo>>('/runmesh/finance/userBill/user-list', params);
};

// 供应商结算列表请求体 - POST /list，与后端 @RequestBody Object query 一致，含 from_date/to_date（YYYY-MM-DD）
export interface SupplierSettlementListQuery {
  from_date: string;
  to_date: string;
  pageNum?: number;
  pageSize?: number;
  vendorId?: number;
  settlementNo?: string;
  status?: string;
  timeRange?: string;
}

// 获取供应商结算单列表 - POST /list，请求体含 from_date、to_date（YYYY-MM-DD）
export const getSupplierSettlementList = (params: SupplierSettlementListQuery) => {
  return http.post<TableDataInfo<SysSupplierSettlementVo>>(
    '/runmesh/finance/supplierSettlement/list',
    params,
  );
};

// 供应商结算详情请求体 - POST /{id} 的 body，含 from_date/to_date（YYYY-MM-DD）
export interface SupplierSettlementDetailQuery {
  from_date: string;
  to_date: string;
}

// 获取供应商结算单详情 - POST /{id}，id 为路径参数，请求体含 from_date、to_date（YYYY-MM-DD）
export const getSupplierSettlementDetailById = (
  id: string,
  query: SupplierSettlementDetailQuery,
) => {
  return http.post<SysSupplierSettlementVo>(
    `/runmesh/finance/supplierSettlement/${encodeURIComponent(id)}`,
    query,
  );
};

// 获取供应商结算单详情（旧 GET 接口，保留兼容）
export const getSupplierSettlementDetail = (id: number) => {
  return http.get<SysSupplierSettlementVo>(`/runmesh/finance/supplierSettlement/${id}`);
};

// 新增供应商结算单
export const addSupplierSettlement = (data: SysSupplierSettlementForm) => {
  return http.post('/runmesh/finance/supplierSettlement', data);
};

// 更新供应商结算单
export const updateSupplierSettlement = (data: SysSupplierSettlementForm) => {
  return http.put('/runmesh/finance/supplierSettlement', data);
};

// 删除供应商结算单
export const deleteSupplierSettlement = (id: number) => {
  return http.delete(`/runmesh/finance/supplierSettlement/${id}`);
};

// 获取平台对账列表（合并接口：用户账单 + 供应商结算，后端汇总为一条对账记录，用于对账页）
// 请求体含 from_date、to_date（YYYY-MM-DD）、timeRange
export const getPlatformReconciliationList = (params: SysPlatformReconciliationBo) => {
  const body = {
    ...params,
    from_date: params.from_date,
    to_date: params.to_date,
    timeRange: params.timeRange,
    periodStart: params.periodStart ?? params.from_date,
    periodEnd: params.periodEnd ?? params.to_date,
  };
  return http.post<SysPlatformReconciliationVo[]>(
    '/runmesh/finance/platformReconciliation/list',
    body,
  );
};

// 获取平台对账按日明细（用于仪表盘财务图表：返回范围内每日收入/成本，随 timeRange 变化）
// 请求体与上一致，调用 POST /runmesh/finance/list，后端按日汇总返回多条
export const getPlatformReconciliationDailyList = (params: SysPlatformReconciliationBo) => {
  const body = {
    ...params,
    from_date: params.from_date,
    to_date: params.to_date,
    timeRange: params.timeRange,
    periodStart: params.periodStart ?? params.from_date,
    periodEnd: params.periodEnd ?? params.to_date,
  };
  return http.post<SysPlatformReconciliationVo[]>('/runmesh/finance/list', body);
};

// 获取平台对账详情
export const getPlatformReconciliationDetail = (id: number) => {
  return http.get<SysPlatformReconciliationVo>(`/runmesh/finance/platformReconciliation/${id}`);
};

// 新增平台对账
export const addPlatformReconciliation = (data: SysPlatformReconciliationForm) => {
  return http.post('/runmesh/finance/platformReconciliation', data);
};

// 更新平台对账
export const updatePlatformReconciliation = (data: SysPlatformReconciliationForm) => {
  return http.put('/runmesh/finance/platformReconciliation', data);
};

// 删除平台对账
export const deletePlatformReconciliation = (id: number) => {
  return http.delete(`/runmesh/finance/platformReconciliation/${id}`);
};

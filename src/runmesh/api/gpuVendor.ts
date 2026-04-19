import { http } from '../utils/axios';

export interface SysGpuVendorVo {
  id?: string | number;
  /** API 侧 guardian_id（如 gdn-1），列表括号内回显用 */
  apiGuardianId?: string;
  tenantId?: string;
  vendorName: string;
  vendorType: string; // 从vendorCode改为vendorType
  shortName?: string;
  brand?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  country?: string;
  address?: string;
  website?: string;
  supportLevel?: string;
  status: string;
  remark?: string;
  createTime?: string | Date;
  apiKey: string; // 新增API-KEY字段
  namespace?: string;
  cluster?: string;
  /** Guardian 别名（guardians API alias） */
  guardianAlias?: string;
  /** 启动时间（guardians API started_at，ISO 格式） */
  startedAt?: string;
  /** 标签（guardians API tags） */
  tags?: string;
  /** 最后可见时间（guardians API last_seen，ISO 格式） */
  lastSeen?: string;
}

export interface SysGpuVendorBo {
  id?: string | number;
  tenantId?: string;
  vendorName: string;
  vendorType: string; // 从vendorCode改为vendorType
  shortName?: string;
  brand?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  country?: string;
  address?: string;
  website?: string;
  supportLevel?: string;
  status: string;
  remark?: string;
  apiKey: string; // 新增API-KEY字段
}

export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
  clusterPageNum?: number; // 保留用于兼容
  clusterPageSize?: number; // 保留用于兼容
  vendorPageNum?: number; // 现在用于guardian分页
  vendorPageSize?: number; // 现在用于guardian分页
}

export interface TableDataInfo<T> {
  rows?: T[];
  total?: number;
  code?: number;
  msg?: string;
}

// 集群分组视图对象（二级列表，保留用于兼容）
export interface SysGpuVendorClusterGroupVo {
  cluster: string;
  vendors: SysGpuVendorVo[];
  vendorTotal?: number; // 供应商总数（用于分页）
}

// 命名空间分组视图对象（一级列表）
export interface SysGpuVendorNamespaceGroupVo {
  namespace: string;
  guardians: SysGpuVendorVo[]; // 守护进程列表（二级列表，直接是guardian/vendor）
  guardianTotal?: number; // 守护进程总数（用于分页）
  enabledGuardianCount?: number; // 启用的守护进程数量（用于统计显示）
  disabledGuardianCount?: number; // 停用的守护进程数量（用于统计显示）
  clusters?: SysGpuVendorClusterGroupVo[]; // 保留用于兼容
  clusterTotal?: number; // 保留用于兼容
}

/** 供应商列表为二级结构：rows 为 namespace 分组数组；查询列表与刷新均调用此 list 接口（后端对 guardiansWorkers 数据已做统一格式处理） */
export const getVendorList = (params: any) => {
  const { pageNum, pageSize, ...bodyParams } = params || {};
  const queryParams: any = {};
  if (pageNum !== undefined) queryParams.pageNum = pageNum;
  if (pageSize !== undefined) queryParams.pageSize = pageSize;
  return http.post<TableDataInfo<SysGpuVendorNamespaceGroupVo>>(
    '/runmesh/system/gpuVendor/list',
    bodyParams,
    {
      params: queryParams,
    },
  );
};

export const getVendorById = (id: string | number) =>
  http.get<SysGpuVendorVo>(`/runmesh/system/gpuVendor/${id}`);

export const addVendor = (data: SysGpuVendorBo) =>
  http.post<void>('/runmesh/system/gpuVendor', data);

export const updateVendor = (data: SysGpuVendorBo) =>
  http.put<void>('/runmesh/system/gpuVendor', data);

export const changeVendorStatus = (id: string | number, status: string) =>
  http.put<void>('/runmesh/system/gpuVendor/changeStatus', { id: String(id), status });

export const deleteVendor = (ids: (string | number)[]) =>
  http.delete<void>(`/runmesh/system/gpuVendor/${ids.map((id) => String(id)).join(',')}`);

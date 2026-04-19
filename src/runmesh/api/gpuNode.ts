import { http } from '../utils/axios';

export interface SysGpuNodeVo {
  id?: string | number;
  /** API 侧 worker id，列表节点ID列回显用 */
  apiWorkerId?: string;
  tenantId?: string;
  nodeName: string;
  nodeCode: string;
  vendorId?: string | number;
  /** 供应商类型（列表返回时后端填充） */
  vendorType?: string;
  /** 供应商名称（列表返回时后端填充） */
  vendorName?: string;
  /** Guardian 别名（从供应商表关联获取） */
  guardianAlias?: string;
  hostName?: string;
  hostIp?: string;
  gpuModel?: string;
  gpuCount?: number;
  cpuCores?: number;
  memoryGb?: number;
  status: string;
  remark?: string;
  namespace?: string;
  cluster?: string;
  provider?: string;
  createTime?: string | Date;
}

export interface SysGpuNodeBo {
  id?: string | number;
  tenantId?: string;
  nodeName: string;
  nodeCode: string;
  vendorId?: string | number;
  hostName?: string;
  hostIp?: string;
  gpuModel?: string;
  gpuCount?: number;
  cpuCores?: number;
  memoryGb?: number;
  status: string;
  remark?: string;
  namespace?: string;
  cluster?: string;
  provider?: string;
}

export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
  clusterPageNum?: number;
  clusterPageSize?: number;
  nodePageNum?: number;
  nodePageSize?: number;
}

export interface TableDataInfo<T> {
  rows?: T[];
  total?: number;
  code?: number;
  msg?: string;
}

// 集群分组视图对象（二级列表）
export interface SysGpuNodeClusterGroupVo {
  cluster: string;
  nodes: SysGpuNodeVo[];
  nodeTotal?: number; // 节点总数（用于分页）
}

// 命名空间分组视图对象（一级列表）
export interface SysGpuNodeNamespaceGroupVo {
  namespace: string;
  clusters: SysGpuNodeClusterGroupVo[];
  clusterTotal?: number; // 集群总数（用于分页）
  nodeTotal?: number; // 节点总数（用于统计显示）
  idleNodeCount?: number; // 空闲节点数量（用于统计显示）
  busyNodeCount?: number; // 忙碌节点数量（用于统计显示）
}

/** 节点列表：查询与刷新均调用此 list 接口，后端对 guardiansWorkers 已做统一格式处理 */
export const getNodeList = (params: any) => {
  const { pageNum, pageSize, ...bodyParams } = params || {};
  const queryParams: any = {};
  if (pageNum !== undefined) queryParams.pageNum = pageNum;
  if (pageSize !== undefined) queryParams.pageSize = pageSize;
  return http.post<TableDataInfo<SysGpuNodeNamespaceGroupVo>>(
    '/runmesh/system/gpuNode/list',
    bodyParams,
    {
      params: queryParams,
    },
  );
};

export const getNodeById = (id: string | number) =>
  http.get<SysGpuNodeVo>(`/runmesh/system/gpuNode/${id}`);

export const addNode = (data: SysGpuNodeBo) => http.post<void>('/runmesh/system/gpuNode', data);

export const updateNode = (data: SysGpuNodeBo) => http.put<void>('/runmesh/system/gpuNode', data);

export const changeNodeStatus = (id: string | number, status: string) =>
  http.put<void>('/runmesh/system/gpuNode/changeStatus', { id: String(id), status });

export const deleteNode = (ids: (string | number)[]) =>
  http.delete<void>(`/runmesh/system/gpuNode/${ids.map((id) => String(id)).join(',')}`);

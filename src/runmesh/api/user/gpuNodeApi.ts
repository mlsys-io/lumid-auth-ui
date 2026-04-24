import { httpUser as http } from '../../utils/axios';
import { SysGpuNodeVo } from '@/runmesh/types';

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

// 获取GPU节点列表 — read-only query of sys_gpu_node. Does NOT pull
// fresh data from FlowMesh cloud. Use refreshGpuNodes() for that.
export const getGpuNodeList = async (
  params: { nodeName?: string; gpuModel?: string; status?: string; vendorId?: number } = {},
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<SysGpuNodeVo>> => {
  const queryParams: Record<string, string | number> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  return http.post<TableDataInfo<SysGpuNodeVo>>('/runmesh/system/gpuNode/list', params, {
    params: queryParams,
  });
};

// 刷新GPU节点列表 — pulls live worker state from FlowMesh cloud
// (kv.run:8000/flowmesh/api/v1/workers) and upserts into sys_gpu_node.
// Returns the freshly-synced set as a pageable list. Use this when
// the UI "Refresh" button is clicked; getGpuNodeList alone only
// re-queries the local DB.
export const refreshGpuNodes = async (
  params: { nodeName?: string; gpuModel?: string; status?: string; vendorId?: number } = {},
  pageQuery: PageQuery = { pageNum: 1, pageSize: 100 },
): Promise<TableDataInfo<SysGpuNodeVo>> => {
  const queryParams: Record<string, string | number> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  return http.post<TableDataInfo<SysGpuNodeVo>>('/runmesh/system/gpuNode/refresh', params, {
    params: queryParams,
  });
};

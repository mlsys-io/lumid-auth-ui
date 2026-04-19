import { http } from '../utils/axios';
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

// 获取GPU节点列表
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

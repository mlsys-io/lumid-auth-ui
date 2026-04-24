import { httpUser as http } from '../../utils/axios';
import { WorkflowMarketItem } from '@/runmesh/types';

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

// 获取工作流市场列表
export const getWorkflowMarketList = async (
  params: { name?: string; appType?: string; status?: string; publishStatus?: string } = {},
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<WorkflowMarketItem>> => {
  const query: Record<string, string | number> = {
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  if (params.name) query.name = params.name;
  if (params.appType) query.appType = params.appType;
  if (params.status) query.status = params.status;
  if (params.publishStatus) query.publishStatus = params.publishStatus;

  return http.get<TableDataInfo<WorkflowMarketItem>>('/runmesh/workflow/market/list', {
    params: query,
  });
};

// 获取单个工作流市场项
export const getWorkflowMarketItem = async (id: number): Promise<WorkflowMarketItem> => {
  return http.get<WorkflowMarketItem>(`/runmesh/workflow/market/${id}`);
};

// 添加工作流到市场
export const addWorkflowToMarket = async (data: Partial<WorkflowMarketItem>): Promise<number> => {
  return http.post<number>('/runmesh/workflow/market', data);
};

// 更新工作流市场项
export const updateWorkflowMarketItem = async (
  data: Partial<WorkflowMarketItem>,
): Promise<void> => {
  await http.put<void>('/runmesh/workflow/market', data);
};

// 删除工作流市场项
export const deleteWorkflowMarketItems = async (ids: number[]): Promise<void> => {
  await http.delete<void>(`/runmesh/workflow/market/${ids.join(',')}`);
};

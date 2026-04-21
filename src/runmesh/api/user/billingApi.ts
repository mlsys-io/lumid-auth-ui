import { httpUser as http } from '../../utils/axios';
import { NebulaUserTransactionVo, SysUserBillVo } from '@/runmesh/types';

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

// 获取用户交易记录列表
export const getUserTransactionList = async (
  params: { bizType?: string; status?: string } = {},
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<NebulaUserTransactionVo>> => {
  const requestBody = {
    ...params,
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  return http.post<TableDataInfo<NebulaUserTransactionVo>>(
    '/runmesh/billing/transaction/list',
    requestBody,
  );
};

// 获取用户消费账单列表
export const getUserBillList = async (
  params: { bizType?: string; billType?: string; status?: string } = {},
  pageQuery: PageQuery = { pageNum: 1, pageSize: 10 },
): Promise<TableDataInfo<SysUserBillVo>> => {
  const requestBody = {
    ...params,
    pageNum: pageQuery.pageNum,
    pageSize: pageQuery.pageSize,
  };

  return http.post<TableDataInfo<SysUserBillVo>>(
    '/runmesh/finance/userBill/user-list',
    requestBody,
  );
};

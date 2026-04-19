import { http } from '../utils/axios';
import { NebulaPayRequestBo, NebulaPayResponseVo, UserBalanceVo } from '@/runmesh/types';

interface R<T> {
  code: number;
  msg: string;
  data: T;
}

export interface RefundRequest {
  orderNo: string;
  refundAmount: number;
  refundReason?: string;
}

/**
 * 发起支付宝支付（在线支付 - 人民币）
 * @param data 支付请求参数
 * @returns 支付响应数据
 */
export const createAlipayPayment = async (
  data: NebulaPayRequestBo,
): Promise<NebulaPayResponseVo> => {
  try {
    // 调用支付宝支付控制器
    const response = await http.post<NebulaPayResponseVo>('/runmesh/pay/alipay/create', data);
    return response;
  } catch (error: any) {
    console.error('支付宝支付API错误:', error);
    throw error;
  }
};

/**
 * 发起Stripe支付（企业转账 - 美元）
 * @param data 支付请求参数
 * @returns 支付响应数据
 */
export const createStripePayment = async (
  data: NebulaPayRequestBo,
): Promise<NebulaPayResponseVo> => {
  try {
    // 调用Stripe支付控制器
    const response = await http.post<NebulaPayResponseVo>('/runmesh/pay/stripe/create', data);
    return response;
  } catch (error: any) {
    console.error('Stripe支付API错误:', error);
    throw error;
  }
};

/**
 * 发起支付（兼容旧代码）
 * @deprecated 请使用 createAlipayPayment 或 createStripePayment
 * @param data 支付请求参数
 * @returns 支付响应数据
 */
export const createPayment = async (data: NebulaPayRequestBo): Promise<NebulaPayResponseVo> => {
  // 根据国家代码自动路由到对应的支付方式
  if (data.countryCode === 'CN') {
    return createAlipayPayment(data);
  } else {
    return createStripePayment(data);
  }
};

/**
 * 获取用户余额信息
 * 注意：后端可能需要新增此接口，如果不存在则需要通过用户信息接口获取
 * @returns 用户余额信息
 */
export const getUserBalance = async (): Promise<R<UserBalanceVo>> => {
  // 先尝试调用专门的余额查询接口（如果后端提供）
  // 如果后端没有提供，可以通过查询最新账单记录获取 balanceAfter
  return http.get<R<UserBalanceVo>>('/runmesh/finance/userBill/balance');
};

/**
 * 通过查询最新账单获取用户余额
 * 这是一个备选方案，当专门的余额接口不可用时使用
 * @returns 用户余额信息
 */
export const getUserBalanceFromBill = async (): Promise<number> => {
  try {
    const response = await http.post<any>('/runmesh/finance/userBill/user-list', {
      pageNum: 1,
      pageSize: 1,
    });

    if (response.rows && response.rows.length > 0) {
      // 从最新的账单记录中获取余额
      return response.rows[0].balanceAfter || 0;
    }
    return 0;
  } catch (error) {
    console.error('获取用户余额失败:', error);
    return 0;
  }
};

/**
 * 申请退款（已废弃，直接退款由管理员操作）
 * @deprecated 请使用 submitRefundRequest 提交退款申请
 */
export const refundPayment = async (
  orderNo: string,
  refundAmount: number,
  refundReason: string,
): Promise<R<NebulaPayResponseVo>> => {
  return http.post<R<NebulaPayResponseVo>>('/runmesh/finance/userBill/refund', null, {
    params: {
      orderNo,
      refundAmount,
      refundReason,
    },
  });
};

/**
 * 支付宝退款（管理员操作）
 */
export const refundAlipayPayment = async (data: RefundRequest): Promise<R<NebulaPayResponseVo>> => {
  return http.post('/runmesh/pay/alipay/refund', null, {
    params: {
      orderNo: data.orderNo,
      refundAmount: data.refundAmount,
      refundReason: data.refundReason || '用户申请退款',
    },
  });
};

/**
 * Stripe退款（管理员操作）
 */
export const refundStripePayment = async (data: RefundRequest): Promise<R<NebulaPayResponseVo>> => {
  return http.post<R<NebulaPayResponseVo>>('/runmesh/pay/stripe/refund', null, {
    params: {
      orderNo: data.orderNo,
      refundAmount: data.refundAmount,
      refundReason: data.refundReason || '用户申请退款',
    },
  });
};

// ========== 退款申请流程 API ==========

export interface RefundRequestSubmit {
  orderNo: string;
  refundAmount: number;
  reason?: string;
}

export interface RefundRequestAudit {
  refundId: number;
  auditStatus: '1' | '2'; // 1=approve, 2=reject
  auditReason?: string;
}

export interface RefundRequestVo {
  refundId: number;
  orderNo: string;
  userId: number;
  userName: string;
  refundAmount: number;
  orderAmount: number;
  payChannel: string;
  currency: string;
  reason: string;
  auditStatus: string; // 0=pending, 1=approved, 2=rejected
  auditUserId: number;
  auditUserName: string;
  auditTime: string;
  auditReason: string;
  refundStatus: string; // PENDING, SUCCESS, FAILED
  requestTime: string;
  remark: string;
}

/**
 * 用户提交退款申请
 */
export const submitRefundRequest = async (data: RefundRequestSubmit): Promise<R<number>> => {
  return http.post<R<number>>('/runmesh/pay/refund/submit', data);
};

/**
 * 用户取消退款申请
 */
export const cancelRefundRequest = async (refundId: number): Promise<R<void>> => {
  return http.post<R<void>>(`/runmesh/pay/refund/cancel/${refundId}`);
};

/**
 * 用户查看自己的退款申请
 */
export const getMyRefundRequests = async (
  params: { pageNum?: number; pageSize?: number; auditStatus?: string } = {},
): Promise<{ rows: RefundRequestVo[]; total: number }> => {
  return http.get('/runmesh/pay/refund/myList', { params });
};

/**
 * 管理员查看所有退款申请
 */
export const getRefundRequests = async (
  params: { pageNum?: number; pageSize?: number; auditStatus?: string } = {},
): Promise<{ rows: RefundRequestVo[]; total: number }> => {
  return http.get('/runmesh/pay/refund/list', { params });
};

/**
 * 管理员审核退款申请
 */
export const auditRefundRequest = async (data: RefundRequestAudit): Promise<R<void>> => {
  return http.put<R<void>>('/runmesh/pay/refund/audit', data);
};

/**
 * 查看退款申请详情
 */
export const getRefundRequestDetail = async (refundId: number): Promise<R<RefundRequestVo>> => {
  return http.get<R<RefundRequestVo>>(`/runmesh/pay/refund/${refundId}`);
};

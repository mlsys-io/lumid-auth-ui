import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import {
  getUserBillList,
  getSupplierSettlementList,
  getPlatformReconciliationList,
  getFinanceDetailById,
  getUserBillDetailById,
  getSupplierSettlementDetailById,
  addUserBill,
  updateUserBill,
  deleteUserBill,
  addSupplierSettlement,
  updateSupplierSettlement,
  deleteSupplierSettlement,
  deletePlatformReconciliation,
  SysPlatformReconciliationForm,
  SysPlatformReconciliationBo,
  SupplierSettlementListQuery,
  SysSupplierSettlementVo,
  UserBillBillingInfo,
  UserBillDetailData,
  PlatformReconciliationDetailMerged,
} from '@/runmesh/api/finance';
import {
  refundAlipayPayment,
  refundStripePayment,
  getRefundRequests,
  auditRefundRequest,
  type RefundRequestVo,
} from '@/runmesh/api/paymentApi';
import { useLanguage } from '@/runmesh/i18n';

// 简单的确认对话框组件
const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, type = 'warning', onConfirm, onCancel }) => {
  const { t } = useLanguage();
  const getButtonColor = () => {
    switch (type) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700';
      case 'warning':
        return 'bg-yellow-600 hover:bg-yellow-700';
      default:
        return 'bg-brand-600 hover:bg-brand-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <p className="text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {t('billingAdmin.action.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${getButtonColor()}`}
          >
            {t('billingAdmin.action.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

// 定义表单类型
interface UserBillForm {
  id?: number;
  userId?: number;
  billNo?: string;
  bizType?: string;
  billType?: string;
  amount?: number;
  // 支付相关字段
  payChannel?: string;
  payStatus?: string;
  billTime?: string;
  remark?: string;
  transactionId?: string;
}

interface SupplierSettlementForm {
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
}

export const BillingManagement: React.FC = () => {
  const location = useLocation();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'user' | 'supplier' | 'reconciliation' | 'refunds'>(
    'user',
  );
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('month');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 数据状态
  const [userBills, setUserBills] = useState<any[]>([]);
  const [supplierSettlements, setSupplierSettlements] = useState<any[]>([]);
  const [reconciliationData, setReconciliationData] = useState<any[]>([]);
  const [allReconciliationData, setAllReconciliationData] = useState<any[]>([]); // 存储所有对账数据用于前端分页
  const [refundRequests, setRefundRequests] = useState<RefundRequestVo[]>([]);
  const [refundPagination, setRefundPagination] = useState({ pageNum: 1, pageSize: 10, total: 0 });
  const [refundAuditModal, setRefundAuditModal] = useState<{
    show: boolean;
    request?: RefundRequestVo;
    action?: 'approve' | 'reject';
    reason: string;
    submitting: boolean;
  }>({ show: false, request: undefined, action: undefined, reason: '', submitting: false });

  // 分页状态
  const [userBillPagination, setUserBillPagination] = useState({
    pageNum: 1,
    pageSize: 10,
    total: 0,
  });
  const [supplierPagination, setSupplierPagination] = useState({
    pageNum: 1,
    pageSize: 10,
    total: 0,
  });
  const [reconciliationPagination, setReconciliationPagination] = useState({
    pageNum: 1,
    pageSize: 10,
    total: 0,
  });

  // 统计数据
  const [stats, setStats] = useState({
    totalRevenue: 0,
    supplierCost: 0,
    grossProfit: 0,
  });

  // 模态框状态
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [currentForm, setCurrentForm] = useState<
    UserBillForm | SupplierSettlementForm | SysPlatformReconciliationForm
  >({});

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // 退款弹窗状态
  const [refundModal, setRefundModal] = useState<{
    show: boolean;
    bill?: any;
    amount: number;
    reason: string;
    submitting: boolean;
  }>({
    show: false,
    bill: undefined,
    amount: 0,
    reason: '',
    submitting: false,
  });

  // 账单详情弹窗状态（用户账单：POST /{id}，id 为 supplier_id）
  const [detailModal, setDetailModal] = useState<{
    show: boolean;
    data: UserBillDetailData | null;
    loading: boolean;
  }>({ show: false, data: null, loading: false });

  // 供应商结算详情弹窗状态（POST /{id}，请求体 from_date/to_date）
  const [supplierDetailModal, setSupplierDetailModal] = useState<{
    show: boolean;
    data: SysSupplierSettlementVo | null;
    loading: boolean;
  }>({ show: false, data: null, loading: false });

  // 平台对账详情弹窗状态（调用合并详情接口返回的大对象）
  const [reconciliationDetailModal, setReconciliationDetailModal] = useState<{
    show: boolean;
    data: PlatformReconciliationDetailMerged | null;
    loading: boolean;
  }>({ show: false, data: null, loading: false });

  // 加载数据
  const loadData = async () => {
    setLoading(true);
    setError(null);
    const period = calculatePeriod(timeRange);
    const reconciliationParams: SysPlatformReconciliationBo = {
      timeRange,
      periodType: timeRange,
      periodStart: period.start,
      periodEnd: period.end,
      from_date: period.start,
      to_date: period.end,
    };

    try {
      // 三个汇总卡片统一使用平台对账列表接口数据，无数据或接口失败时默认为 0
      let reconciliationList: Awaited<ReturnType<typeof getPlatformReconciliationList>> = [];
      try {
        reconciliationList = (await getPlatformReconciliationList(reconciliationParams)) || [];
      } catch {
        reconciliationList = [];
      }
      const firstReconciliation = reconciliationList[0];
      setStats({
        totalRevenue: firstReconciliation?.userIncome ?? 0,
        supplierCost: firstReconciliation?.supplierCost ?? 0,
        grossProfit: firstReconciliation?.grossProfit ?? 0,
      });

      if (activeTab === 'user') {
        // 用户账单：POST /list 返回 R{ code, msg, data }；新结构 data 为用户数组，每项含 billing_info
        const response = (await getUserBillList({
          from_date: period.start,
          to_date: period.end,
        })) as { code?: number; msg?: string; data?: unknown };
        const payload = response?.data !== undefined ? response.data : response;
        let list: UserBillBillingInfo[] = [];
        if (Array.isArray(payload)) {
          // 新结构：data = [{ total_cost, billing_info: [{ supplier_id, total_cost }], external_id, principal_id }, ...]
          for (const userItem of payload as Array<{
            external_id?: string;
            principal_id?: string;
            billing_info?: Array<{
              owner_id?: string;
              supplier_id?: string;
              total_cost?: number | string;
            }>;
          }>) {
            const infos = userItem.billing_info || [];
            for (const bi of infos) {
              list.push({
                external_id: userItem.external_id,
                principal_id: userItem.principal_id,
                owner_id: bi.owner_id,
                supplier_id: bi.supplier_id,
                total_cost: bi.total_cost,
                from_date: period.start,
                to_date: period.end,
              });
            }
          }
        } else if (
          payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { billing_info?: unknown }).billing_info)
        ) {
          const old = payload as {
            billing_info: Array<{ from_date?: string; to_date?: string; [k: string]: unknown }>;
            from_date?: string;
            to_date?: string;
          };
          list = old.billing_info.map((item) => ({
            ...item,
            from_date: item.from_date ?? old.from_date ?? period.start,
            to_date: item.to_date ?? old.to_date ?? period.end,
          })) as UserBillBillingInfo[];
        }
        setUserBills(list);
        setUserBillPagination((prev) => ({
          ...prev,
          total: list.length,
        }));
      } else if (activeTab === 'supplier') {
        // 供应商结算：POST /list，请求体含 from_date、to_date（YYYY-MM-DD）
        // 接口可能返回 rows/total（分页格式）或 billing_info（与用户账单一致），需兼容两种结构
        const params: SupplierSettlementListQuery = {
          from_date: period.start,
          to_date: period.end,
          pageNum: supplierPagination.pageNum,
          pageSize: supplierPagination.pageSize,
          timeRange,
        };
        const result = (await getSupplierSettlementList(params)) as any;
        const list = Array.isArray(result?.billing_info)
          ? (
              result.billing_info as Array<{
                owner_id?: string;
                supplier_id?: string;
                from_date?: string;
                to_date?: string;
                total_cost?: string | number;
              }>
            ).map((item, idx) => ({
              id: item.supplier_id ? `supplier-${item.supplier_id}-${idx}` : undefined,
              settlementNo: item.supplier_id ?? '-',
              vendorName: item.supplier_id,
              vendorId: item.supplier_id,
              supplier_id: item.supplier_id,
              from_date: item.from_date ?? period.start,
              to_date: item.to_date ?? period.end,
              amount:
                typeof item.total_cost === 'string'
                  ? parseFloat(item.total_cost) || 0
                  : (item.total_cost ?? 0),
              total_cost: item.total_cost,
              status: 'pending',
            }))
          : result?.rows || [];
        const total = Array.isArray(result?.billing_info)
          ? result.billing_info.length
          : (result?.total ?? 0);
        setSupplierSettlements(list);
        setSupplierPagination((prev) => ({
          ...prev,
          total,
        }));
      } else if (activeTab === 'reconciliation') {
        // 平台对账：直接使用上面已请求的 reconciliationList，不再重复请求
        setAllReconciliationData(reconciliationList);
        setReconciliationPagination((prev) => ({
          ...prev,
          total: reconciliationList.length,
        }));
      } else if (activeTab === 'refunds') {
        const result = await getRefundRequests({
          pageNum: refundPagination.pageNum,
          pageSize: refundPagination.pageSize,
        });
        setRefundRequests(result?.rows || []);
        setRefundPagination((prev) => ({ ...prev, total: result?.total || 0 }));
      }
    } catch (err: any) {
      console.error('Failed to load data:', err);
      setError(err.message || t('billingAdmin.error.loadFailed'));
      setStats({ totalRevenue: 0, supplierCost: 0, grossProfit: 0 });
      if (activeTab === 'user') {
        setUserBills([]);
        setUserBillPagination((prev) => ({ ...prev, total: 0 }));
      } else if (activeTab === 'supplier') {
        setSupplierSettlements([]);
        setSupplierPagination((prev) => ({ ...prev, total: 0 }));
      } else if (activeTab === 'reconciliation') {
        setReconciliationData([]);
        setAllReconciliationData([]);
        setReconciliationPagination((prev) => ({ ...prev, total: 0 }));
      }
    } finally {
      setLoading(false);
    }
  };

  // 切换 tab 时重置分页
  useEffect(() => {
    setUserBillPagination({ pageNum: 1, pageSize: 10, total: 0 });
    setSupplierPagination({ pageNum: 1, pageSize: 10, total: 0 });
    setReconciliationPagination({ pageNum: 1, pageSize: 10, total: 0 });
    setRefundPagination({ pageNum: 1, pageSize: 10, total: 0 });
  }, [activeTab]);

  // 前端分页：根据分页状态对平台对账数据进行切片
  useEffect(() => {
    if (activeTab === 'reconciliation') {
      const { pageNum, pageSize } = reconciliationPagination;
      const start = (pageNum - 1) * pageSize;
      const end = start + pageSize;
      const paginatedData = allReconciliationData.slice(start, end);
      setReconciliationData(paginatedData);
    }
  }, [allReconciliationData, reconciliationPagination, activeTab]);

  // 加载数据（用户账单按时间范围一次拉取，前端分页，不随 pageNum/pageSize 重新请求）
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, timeRange, supplierPagination.pageNum, supplierPagination.pageSize]);

  // 监听URL参数变化，当URL包含时间戳参数时重新加载数据
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('t')) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getBillTypeLabel = (billType?: string) => {
    if (billType === '1') return t('billingAdmin.billType.recharge');
    if (billType === '2') return t('billingAdmin.billType.consume');
    return billType || t('billingAdmin.common.na');
  };

  const getPayChannelLabel = (channel?: string) => {
    if (!channel) return t('billingAdmin.common.na');
    const value = channel.toLowerCase();
    if (value === 'alipay') return t('billingAdmin.payChannel.alipay');
    if (value === 'stripe') return 'Stripe';
    return channel;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getStatusLabel = (status?: string) => {
    if (status === '0') return t('billingAdmin.payStatus.success');
    if (status === '1') return t('billingAdmin.payStatus.failed');
    if (status === '2') return t('billingAdmin.payStatus.processing');
    return status || t('billingAdmin.common.na');
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getSettlementStatusLabel = (status?: string) => {
    if (status === 'paid') return t('billingAdmin.settlementStatus.paid');
    if (status === 'pending') return t('billingAdmin.settlementStatus.pending');
    if (status === 'processing') return t('billingAdmin.settlementStatus.processing');
    return status || t('billingAdmin.common.na');
  };

  const getReconciliationStatusLabel = (status?: string) => {
    if (status === 'normal') return t('billingAdmin.reconciliationStatus.normal');
    if (status === 'warning') return t('billingAdmin.reconciliationStatus.warning');
    if (status === 'error') return t('billingAdmin.reconciliationStatus.error');
    return status || t('billingAdmin.common.na');
  };

  // 按本地日期格式化为 YYYY-MM-DD，避免 toISOString 的时区偏差
  const toLocalDateString = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // 计算时间范围：日=今日起止，周=上周同 weekday 到今日（如上周三到本周二），月=上月同日到今日（如 1 月 10 日到 2 月 10 日）
  const calculatePeriod = (range: 'day' | 'week' | 'month'): { start: string; end: string } => {
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 今日 00:00 本地
    const end = toLocalDateString(endDate);

    let startDate: Date;

    if (range === 'day') {
      // 日：起止均为今日当天
      startDate = new Date(endDate);
    } else if (range === 'week') {
      // 周：上周同 weekday 到这周今天，共 7 天（如上周三到本周二）
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
    } else {
      // 月：上月同日 +1 天到今日（如 1 月 11 日到今天 2 月 10 日）
      startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setDate(startDate.getDate() + 1);
    }

    const start = toLocalDateString(startDate);
    return { start, end };
  };

  // 格式化时间范围显示
  const formatPeriod = (range: 'day' | 'week' | 'month') => {
    const { start, end } = calculatePeriod(range);
    const startDisplay = new Date(start).toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
    });
    const endDisplay = new Date(end).toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
    });

    if (range === 'day') {
      return t('billingAdmin.period.day', { start: startDisplay });
    } else if (range === 'week') {
      return t('billingAdmin.period.week', { start: startDisplay, end: endDisplay });
    }
    return t('billingAdmin.period.month', { start: startDisplay, end: endDisplay });
  };

  // 安全的数字格式化函数
  const formatNumber = (value: any, decimals: number = 2): string => {
    if (value === null || value === undefined || value === '') {
      return '0.00';
    }

    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? '0.00' : parsed.toFixed(decimals);
    }

    if (typeof value === 'number') {
      return value.toFixed(decimals);
    }

    return '0.00';
  };

  // 安全显示单元格值，避免将对象渲染为 React 子节点导致报错
  const safeCellText = (value: unknown): string => {
    if (value == null || value === '') return '-';
    if (typeof value === 'object' && !Array.isArray(value)) return '-';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return '-';
  };

  // 安全格式化日期，用于 from_date / to_date 回显，避免 Invalid Date
  const formatDateSafe = (value: string | undefined): string => {
    if (value == null || String(value).trim() === '') return '-';
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  // 终止日期 to_date 显示：不超过今日当天，避免因时区等显示为未来一天
  const formatDateSafeEnd = (value: string | undefined): string => {
    if (value == null || String(value).trim() === '') return '-';
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return '-';
    const today = new Date();
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const toShow = dOnly > todayOnly ? todayOnly : d;
    return toShow.toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getExportLabel = () => {
    switch (timeRange) {
      case 'day':
        return t('billingAdmin.export.day');
      case 'week':
        return t('billingAdmin.export.week');
      case 'month':
        return t('billingAdmin.export.month');
      default:
        return t('billingAdmin.export.default');
    }
  };

  // 图一：用户账单 - 查看详情，调用 userBillService.queryById 接口 POST /userBill/{id}
  const handleViewDetail = async (record: UserBillBillingInfo) => {
    const period = calculatePeriod(timeRange);
    const id = record?.supplier_id ?? '';
    if (!id) {
      setDetailModal({ show: true, data: null, loading: false });
      return;
    }
    setDetailModal({ show: true, data: null, loading: true });
    try {
      const res = await getUserBillDetailById(id, { from_date: period.start, to_date: period.end });
      setDetailModal({ show: true, data: (res as UserBillDetailData) ?? null, loading: false });
    } catch {
      setDetailModal({ show: true, data: null, loading: false });
    }
  };

  // 图二：供应商结算 - 查看详情，调用 supplierSettlementService.queryById 接口 POST /supplierSettlement/{id}
  const handleViewDetailSupplier = async (record: any) => {
    const period = calculatePeriod(timeRange);
    const id = record?.supplier_id ?? record?.vendorName ?? record?.vendorId ?? '';
    if (!id) {
      setSupplierDetailModal({ show: true, data: null, loading: false });
      return;
    }
    setSupplierDetailModal({ show: true, data: null, loading: true });
    try {
      const res = await getSupplierSettlementDetailById(String(id), {
        from_date: period.start,
        to_date: period.end,
      });
      setSupplierDetailModal({
        show: true,
        data: (res as SysSupplierSettlementVo) ?? null,
        loading: false,
      });
    } catch {
      setSupplierDetailModal({ show: true, data: null, loading: false });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleEdit = (item: any) => {
    setModalMode('edit');
    // 为平台对账数据，保留除开始结束日期和毛利率外的其他字段
    if (activeTab === 'reconciliation') {
      const {
        periodStart: _periodStart,
        periodEnd: _periodEnd,
        grossProfit: _grossProfit,
        ...rest
      } = item;
      setCurrentForm({ ...rest });
    } else {
      setCurrentForm({ ...item });
    }
    setShowModal(true);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDelete = (id: number) => {
    const getDeleteMessage = () => {
      if (activeTab === 'user') {
        return t('billingAdmin.confirm.delete.user');
      }
      if (activeTab === 'supplier') {
        return t('billingAdmin.confirm.delete.supplier');
      }
      return t('billingAdmin.confirm.delete.reconciliation');
    };

    setConfirmDialog({
      show: true,
      title: t('billingAdmin.confirm.delete.title'),
      message: getDeleteMessage(),
      type: 'danger',
      onConfirm: async () => {
        try {
          if (activeTab === 'user') {
            await deleteUserBill(id);
          } else if (activeTab === 'supplier') {
            await deleteSupplierSettlement(id);
          } else if (activeTab === 'reconciliation') {
            await deletePlatformReconciliation(id);
          }
          // 重新加载数据
          loadData();
        } catch (err: any) {
          setError(err.message || t('billingAdmin.error.deleteFailed'));
        } finally {
          setConfirmDialog({ ...confirmDialog, show: false });
        }
      },
    });
  };

  const canRefund = (bill: any) => {
    const payChannel = bill?.payChannel;
    const statusOk = bill?.payStatus === 'SUCCESS';
    const orderNo = bill?.billNo || bill?.transactionId;
    const amountValid = Math.abs(Number(bill?.amount) || 0) > 0;
    return Boolean(payChannel && statusOk && orderNo && amountValid);
  };

  const getRefundTooltip = (bill: any) => {
    if (!bill?.payChannel) return t('billingAdmin.refund.tooltip.missingPayChannel');
    if (!(bill?.billNo || bill?.transactionId))
      return t('billingAdmin.refund.tooltip.missingOrder');
    if (bill?.payStatus !== 'SUCCESS') return t('billingAdmin.refund.tooltip.onlySuccess');
    if (!bill?.amount) return t('billingAdmin.refund.tooltip.missingAmount');
    return t('billingAdmin.refund.tooltip.start');
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleRefundClick = (bill: any) => {
    if (!canRefund(bill)) {
      setError(getRefundTooltip(bill));
      return;
    }

    const safeAmount = Math.abs(Number(bill.amount) || 0);
    const orderNo = bill.billNo || bill.transactionId;

    setError(null);
    setRefundModal({
      show: true,
      bill,
      amount: safeAmount,
      reason: orderNo ? t('billingAdmin.refund.defaultReasonWithOrder', { orderNo }) : '',
      submitting: false,
    });
  };

  const closeRefundModal = () => {
    setError(null);
    setRefundModal({
      show: false,
      bill: undefined,
      amount: 0,
      reason: '',
      submitting: false,
    });
  };

  const handleRefundSubmit = async () => {
    if (!refundModal.bill) return;

    const orderNo = refundModal.bill.billNo || refundModal.bill.transactionId;
    const payChannel = refundModal.bill.payChannel || '';
    const refundAmount = Number(refundModal.amount);

    if (!orderNo) {
      setError(t('billingAdmin.refund.error.missingOrder'));
      return;
    }

    if (!refundAmount || refundAmount <= 0) {
      setError(t('billingAdmin.refund.error.amountPositive'));
      return;
    }

    setRefundModal((prev) => ({ ...prev, submitting: true }));
    try {
      const payload = {
        orderNo,
        refundAmount,
        refundReason: refundModal.reason || t('billingAdmin.refund.defaultReason'),
      };

      if (payChannel === 'ALIPAY') {
        await refundAlipayPayment(payload);
      } else if (payChannel === 'STRIPE') {
        await refundStripePayment(payload);
      } else {
        throw new Error(t('billingAdmin.refund.error.unsupportedChannel'));
      }

      closeRefundModal();
      loadData();
    } catch (err: any) {
      setError(err.message || t('billingAdmin.refund.error.failed'));
      setRefundModal((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleRefundAudit = async () => {
    if (!refundAuditModal.request || !refundAuditModal.action) return;
    setRefundAuditModal((prev) => ({ ...prev, submitting: true }));
    try {
      await auditRefundRequest({
        refundId: refundAuditModal.request.refundId,
        auditStatus: refundAuditModal.action === 'approve' ? '1' : '2',
        auditReason: refundAuditModal.reason,
      });
      setRefundAuditModal({
        show: false,
        request: undefined,
        action: undefined,
        reason: '',
        submitting: false,
      });
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.msg || err?.message || 'Audit failed');
      setRefundAuditModal((prev) => ({ ...prev, submitting: false }));
    }
  };

  // 处理表单提交
  const handleSubmit = async () => {
    try {
      if (activeTab === 'user') {
        if (modalMode === 'add') {
          await addUserBill(currentForm as UserBillForm);
        } else {
          await updateUserBill(currentForm as UserBillForm);
        }
      } else if (activeTab === 'supplier') {
        if (modalMode === 'add') {
          await addSupplierSettlement(currentForm as SupplierSettlementForm);
        } else {
          await updateSupplierSettlement(currentForm as SupplierSettlementForm);
        }
      } else if (activeTab === 'reconciliation') {
        // 平台对账数据来自合并接口（只读），无新增/更新 API，仅关闭弹窗并刷新列表
        setShowModal(false);
        loadData();
        return;
      }

      setShowModal(false);
      loadData();
    } catch (err: any) {
      setError(err.message || t('billingAdmin.error.actionFailed'));
    }
  };

  // 用户账单列配置：用户(external_id)、供应商、开始时间、结束时间、金额，只保留查看详情
  const userBillColumns: TableColumn<UserBillBillingInfo>[] = [
    {
      key: 'external_id',
      title: t('billingAdmin.table.user.userName'),
      render: (row) => (
        <span className="text-xs font-medium text-slate-900">
          {safeCellText(row.external_id) || '-'}
        </span>
      ),
    },
    {
      key: 'vendor',
      title: t('billingAdmin.table.supplier.vendor'),
      render: (row) => (
        <span className="text-xs font-medium text-slate-900">
          {safeCellText(row.supplier_id) || '-'}
        </span>
      ),
    },
    {
      key: 'from_date',
      title: t('billingAdmin.table.fromDate'),
      render: (row) => {
        const start =
          row.from_date ?? (row.to_date == null ? calculatePeriod(timeRange).start : undefined);
        return <span className="text-xs text-slate-500">{formatDateSafe(start)}</span>;
      },
    },
    {
      key: 'to_date',
      title: t('billingAdmin.table.toDate'),
      render: (row) => {
        const end =
          row.to_date ?? (row.from_date == null ? calculatePeriod(timeRange).end : undefined);
        return <span className="text-xs text-slate-500">{formatDateSafeEnd(end)}</span>;
      },
    },
    {
      key: 'amount',
      title: t('billingAdmin.table.supplier.amount'),
      render: (row) => (
        <span className="text-xs font-bold text-slate-900">
          {typeof row.total_cost === 'number' ||
          (typeof row.total_cost === 'string' && row.total_cost !== '')
            ? `$${formatNumber(row.total_cost)}`
            : '-'}
        </span>
      ),
    },
  ];

  const userBillActions: TableAction<UserBillBillingInfo>[] = [
    {
      key: 'viewDetail',
      label: t('billingAdmin.action.viewDetail'),
      icon: <Icons.Eye className="w-4 h-4" />,
      onClick: (record) => handleViewDetail(record),
      tooltip: t('billingAdmin.tooltip.viewDetail'),
      type: 'secondary',
    },
  ];

  // 供应商结算列配置：供应商、开始时间(from_date)、结束时间(to_date)、金额，只保留查看详情
  const supplierSettlementColumns: TableColumn<any>[] = [
    {
      key: 'vendor',
      title: t('billingAdmin.table.supplier.vendor'),
      render: (row) => (
        <span className="text-xs font-medium text-slate-900">
          {safeCellText(row.supplier_id ?? row.vendorName ?? row.vendorId) || '-'}
        </span>
      ),
    },
    {
      key: 'from_date',
      title: t('billingAdmin.table.fromDate'),
      render: (row) => {
        const start =
          row.from_date ?? (row.to_date == null ? calculatePeriod(timeRange).start : undefined);
        return <span className="text-xs text-slate-500">{formatDateSafe(start)}</span>;
      },
    },
    {
      key: 'to_date',
      title: t('billingAdmin.table.toDate'),
      render: (row) => {
        const end =
          row.to_date ?? (row.from_date == null ? calculatePeriod(timeRange).end : undefined);
        return <span className="text-xs text-slate-500">{formatDateSafeEnd(end)}</span>;
      },
    },
    {
      key: 'amount',
      title: t('billingAdmin.table.supplier.amount'),
      render: (row) => {
        const value =
          row.amount ??
          (typeof row.total_cost === 'string' ? parseFloat(row.total_cost) : row.total_cost);
        return (
          <span className="text-xs font-bold text-slate-900">
            {value != null && value !== '' ? `$${formatNumber(value)}` : '-'}
          </span>
        );
      },
    },
  ];

  const supplierSettlementActions: TableAction<any>[] = [
    {
      key: 'viewDetail',
      label: t('billingAdmin.action.viewDetail'),
      icon: <Icons.Eye className="w-4 h-4" />,
      onClick: (record) => handleViewDetailSupplier(record),
      tooltip: t('billingAdmin.tooltip.viewDetail'),
      type: 'secondary',
    },
  ];

  // 定义平台对账的列配置：开始时间(periodStart)、结束时间(periodEnd)
  const reconciliationColumns: TableColumn<any>[] = [
    {
      key: 'periodStart',
      title: t('billingAdmin.table.fromDate'),
      render: (row) => {
        const start =
          row.periodStart ?? (row.periodEnd == null ? calculatePeriod(timeRange).start : undefined);
        return <span className="text-xs font-medium text-slate-900">{formatDateSafe(start)}</span>;
      },
    },
    {
      key: 'periodEnd',
      title: t('billingAdmin.table.toDate'),
      render: (row) => {
        const end =
          row.periodEnd ?? (row.periodStart == null ? calculatePeriod(timeRange).end : undefined);
        return <span className="text-xs font-medium text-slate-900">{formatDateSafeEnd(end)}</span>;
      },
    },
    {
      key: 'userIncome',
      title: t('billingAdmin.table.reconciliation.userIncome'),
      render: (item) => (
        <span className="text-xs font-medium text-green-600">
          +${formatNumber(item.userIncome)}
        </span>
      ),
    },
    {
      key: 'supplierCost',
      title: t('billingAdmin.table.reconciliation.supplierCost'),
      render: (item) => (
        <span className="text-xs font-medium text-red-500">
          -${formatNumber(item.supplierCost)}
        </span>
      ),
    },
    {
      key: 'grossProfit',
      title: t('billingAdmin.table.reconciliation.grossProfit'),
      render: (item) => (
        <span className="text-xs font-bold text-slate-900">${formatNumber(item.grossProfit)}</span>
      ),
    },
    {
      key: 'status',
      title: t('billingAdmin.table.reconciliation.status'),
      render: (item) => (
        <span
          className={`inline-flex px-3 py-1.5 text-sm font-medium rounded-full border ${
            item.status === 'normal'
              ? 'bg-green-50 text-green-700 border-green-100'
              : 'bg-red-50 text-red-700 border-red-100'
          }`}
        >
          {getReconciliationStatusLabel(item.status)}
        </span>
      ),
    },
  ];

  // 平台对账：查看详情时调用合并接口，返回该行对应的单个对账详情对象（仅汇总）
  const handleViewDetailReconciliation = async (record: any) => {
    const period = calculatePeriod(timeRange);
    const periodType = (record?.periodType ?? timeRange) as string;
    setReconciliationDetailModal({ show: true, data: null, loading: true });
    try {
      const res = await getFinanceDetailById('platformReconciliation', periodType, {
        from_date: period.start,
        to_date: period.end,
        timeRange,
      });
      // 拦截器已解包，res 即为合并详情大对象
      setReconciliationDetailModal({
        show: true,
        data: (res as PlatformReconciliationDetailMerged) ?? null,
        loading: false,
      });
    } catch {
      setReconciliationDetailModal({ show: true, data: null, loading: false });
    }
  };

  const reconciliationActions: TableAction<any>[] = [
    {
      key: 'viewDetail',
      label: t('billingAdmin.action.viewDetail'),
      icon: <Icons.Eye className="w-4 h-4" />,
      onClick: (record) => handleViewDetailReconciliation(record),
      tooltip: t('billingAdmin.tooltip.viewDetail'),
      type: 'secondary',
    },
  ];

  // 模态框组件
  const renderModal = () => {
    if (!showModal) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-11/12 max-w-2xl max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">
            {modalMode === 'add'
              ? t('billingAdmin.modal.addPrefix')
              : t('billingAdmin.modal.editPrefix')}
            {activeTab === 'user'
              ? t('billingAdmin.tab.userBills')
              : activeTab === 'supplier'
                ? t('billingAdmin.tab.supplierSettlements')
                : t('billingAdmin.tab.reconciliation')}
          </h3>

          <div className="space-y-4">
            {activeTab === 'user' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.userId')}
                  </label>
                  <input
                    type="number"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as UserBillForm).userId || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, userId: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.billNo')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as UserBillForm).billNo || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, billNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.bizType')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as UserBillForm).bizType || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, bizType: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.billType')}
                  </label>
                  <select
                    className="mt-1 block w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                    value={(currentForm as UserBillForm).billType || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, billType: e.target.value })}
                  >
                    <option value="">{t('billingAdmin.form.selectPlaceholder')}</option>
                    <option value="1">{t('billingAdmin.billType.recharge')}</option>
                    <option value="2">{t('billingAdmin.billType.consume')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.payChannel')}
                  </label>
                  <select
                    className="mt-1 block w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                    value={(currentForm as UserBillForm).payChannel || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, payChannel: e.target.value })}
                  >
                    <option value="">{t('billingAdmin.form.selectPlaceholder')}</option>
                    <option value="alipay">{t('billingAdmin.payChannel.alipay')}</option>
                    <option value="stripe">{t('billingAdmin.payChannel.stripe')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.amount')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as UserBillForm).amount || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, amount: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.payStatus')}
                  </label>
                  <select
                    className="mt-1 block w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                    value={(currentForm as UserBillForm).payStatus || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, payStatus: e.target.value })}
                  >
                    <option value="">{t('billingAdmin.form.selectPlaceholder')}</option>
                    <option value="0">{t('billingAdmin.payStatus.success')}</option>
                    <option value="1">{t('billingAdmin.payStatus.failed')}</option>
                    <option value="2">{t('billingAdmin.payStatus.processing')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.billTime')}
                  </label>
                  <input
                    type="datetime-local"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as UserBillForm).billTime || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, billTime: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.remark')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as UserBillForm).remark || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, remark: e.target.value })}
                  />
                </div>
              </>
            )}

            {activeTab === 'supplier' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.settlementNo')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).settlementNo || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, settlementNo: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.vendorId')}
                  </label>
                  <input
                    type="number"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).vendorId || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, vendorId: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.vendorName')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).vendorName || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, vendorName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.periodStart')}
                  </label>
                  <input
                    type="date"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).periodStart || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, periodStart: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.periodEnd')}
                  </label>
                  <input
                    type="date"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).periodEnd || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, periodEnd: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.amount')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).amount || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, amount: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.status')}
                  </label>
                  <select
                    className="mt-1 block w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                    value={(currentForm as SupplierSettlementForm).status || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, status: e.target.value })}
                  >
                    <option value="">{t('billingAdmin.form.selectPlaceholder')}</option>
                    <option value="pending">{t('billingAdmin.settlementStatus.pending')}</option>
                    <option value="paid">{t('billingAdmin.settlementStatus.paid')}</option>
                    <option value="processing">
                      {t('billingAdmin.settlementStatus.processing')}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.settlementTime')}
                  </label>
                  <input
                    type="datetime-local"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).settlementTime || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, settlementTime: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.remark')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SupplierSettlementForm).remark || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, remark: e.target.value })}
                  />
                </div>
              </>
            )}

            {activeTab === 'reconciliation' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.tenantId')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SysPlatformReconciliationForm).tenantId || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, tenantId: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.currentPeriod')}
                  </label>
                  <div className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md bg-slate-50 text-slate-700">
                    {formatPeriod(timeRange)}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.userIncome')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SysPlatformReconciliationForm).userIncome || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, userIncome: Number(e.target.value) })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.supplierCost')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SysPlatformReconciliationForm).supplierCost || ''}
                    onChange={(e) =>
                      setCurrentForm({ ...currentForm, supplierCost: Number(e.target.value) })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.status')}
                  </label>
                  <select
                    className="mt-1 block w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                    value={(currentForm as SysPlatformReconciliationForm).status || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, status: e.target.value })}
                    required
                  >
                    <option value="">{t('billingAdmin.form.selectPlaceholder')}</option>
                    <option value="normal">{t('billingAdmin.reconciliationStatus.normal')}</option>
                    <option value="warning">
                      {t('billingAdmin.reconciliationStatus.warning')}
                    </option>
                    <option value="error">{t('billingAdmin.reconciliationStatus.error')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    {t('billingAdmin.form.remark')}
                  </label>
                  <input
                    type="text"
                    className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                    value={(currentForm as SysPlatformReconciliationForm).remark || ''}
                    onChange={(e) => setCurrentForm({ ...currentForm, remark: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
            >
              {t('billingAdmin.action.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-brand-600 hover:bg-brand-700"
            >
              {modalMode === 'add' ? t('billingAdmin.action.add') : t('billingAdmin.action.save')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 账单详情弹窗（queryById 返回的 data 结构）
  const renderDetailModal = () => {
    if (!detailModal.show) return null;
    const { data, loading } = detailModal;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-11/12 max-w-lg max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">{t('billingAdmin.detail.title')}</h3>
          {loading ? (
            <p className="text-sm text-slate-500">{t('billingAdmin.table.loading')}</p>
          ) : data ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.supplierId')}:
                </span>{' '}
                <span className="text-slate-900 font-mono">{safeCellText(data.supplier_id)}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.fromDate')}:
                </span>{' '}
                <span className="text-slate-900">{safeCellText(data.from_date)}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.toDate')}:
                </span>{' '}
                <span className="text-slate-900">{safeCellText(data.to_date)}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.totalCost')}:
                </span>{' '}
                <span className="text-slate-900 font-bold">
                  $
                  {typeof data.total_cost === 'number' ||
                  (typeof data.total_cost === 'string' && data.total_cost !== '')
                    ? formatNumber(data.total_cost)
                    : '-'}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('billingAdmin.table.empty')}</p>
          )}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setDetailModal({ show: false, data: null, loading: false })}
              className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
            >
              {t('billingAdmin.detail.close')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 供应商结算详情弹窗：仅回显 API 真实字段（供应商、开始/结束日期、金额），其他字段全部去掉
  const renderSupplierDetailModal = () => {
    if (!supplierDetailModal.show) return null;
    const { data, loading } = supplierDetailModal;
    const supplierId = data?.supplier_id ?? data?.vendorName ?? data?.vendorId;
    const fromDate =
      data?.from_date != null && typeof data.from_date === 'object'
        ? '-'
        : safeCellText(data?.from_date);
    const toDate =
      data?.to_date != null && typeof data.to_date === 'object' ? '-' : safeCellText(data?.to_date);
    const cost = data?.total_cost ?? data?.amount;
    const costNum = typeof cost === 'string' ? parseFloat(cost) : cost;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-11/12 max-w-lg max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">{t('billingAdmin.detail.title')}</h3>
          {loading ? (
            <p className="text-sm text-slate-500">{t('billingAdmin.table.loading')}</p>
          ) : data ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.supplierId')}:
                </span>{' '}
                <span className="text-slate-900 font-mono">{safeCellText(supplierId)}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.fromDate')}:
                </span>{' '}
                <span className="text-slate-900">{fromDate}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.toDate')}:
                </span>{' '}
                <span className="text-slate-900">{toDate}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.detail.totalCost')}:
                </span>{' '}
                <span className="text-slate-900 font-bold">
                  {costNum != null && (costNum as any) !== '' && !Number.isNaN(costNum)
                    ? `$${formatNumber(costNum)}`
                    : '-'}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('billingAdmin.table.empty')}</p>
          )}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setSupplierDetailModal({ show: false, data: null, loading: false })}
              className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
            >
              {t('billingAdmin.detail.close')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 平台对账详情弹窗：仅展示汇总（周期、用户收入、供应商成本、平台毛利、状态）
  const renderReconciliationDetailModal = () => {
    if (!reconciliationDetailModal.show) return null;
    const { data, loading } = reconciliationDetailModal;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-11/12 max-w-lg max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">{t('billingAdmin.detail.title')}</h3>
          {loading ? (
            <p className="text-sm text-slate-500">{t('billingAdmin.table.loading')}</p>
          ) : data ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.table.reconciliation.period')}:
                </span>{' '}
                <span className="text-slate-900">
                  {formatPeriod((data.periodType as 'day' | 'week' | 'month') || timeRange)}
                </span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.table.reconciliation.userIncome')}:
                </span>{' '}
                <span className="text-slate-900 font-medium text-green-600">
                  +${formatNumber(data.userIncome)}
                </span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.table.reconciliation.supplierCost')}:
                </span>{' '}
                <span className="text-slate-900 font-medium text-red-500">
                  -${formatNumber(data.supplierCost)}
                </span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.table.reconciliation.grossProfit')}:
                </span>{' '}
                <span className="text-slate-900 font-bold">${formatNumber(data.grossProfit)}</span>
              </p>
              <p>
                <span className="text-slate-500 font-medium">
                  {t('billingAdmin.table.reconciliation.status')}:
                </span>{' '}
                <span className="text-slate-900">{getReconciliationStatusLabel(data.status)}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('billingAdmin.table.empty')}</p>
          )}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() =>
                setReconciliationDetailModal({ show: false, data: null, loading: false })
              }
              className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
            >
              {t('billingAdmin.detail.close')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderRefundModal = () => {
    if (!refundModal.show || !refundModal.bill) return null;

    const orderNo = refundModal.bill.billNo || refundModal.bill.transactionId;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-11/12 max-w-lg max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">{t('billingAdmin.refund.title')}</h3>
          <div className="space-y-4">
            <div className="text-sm text-slate-600 space-y-1">
              <p>
                {t('billingAdmin.refund.orderNo')}：
                <span className="font-mono text-slate-900">{orderNo || '-'}</span>
              </p>
              <p>
                {t('billingAdmin.refund.payChannel')}:{' '}
                {getPayChannelLabel(refundModal.bill.payChannel)}
              </p>
              <p>
                {t('billingAdmin.refund.originalAmount')}: ${formatNumber(refundModal.bill.amount)}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                {t('billingAdmin.refund.amount')}
              </label>
              <input
                type="number"
                step="0.01"
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                value={refundModal.amount}
                onChange={(e) =>
                  setRefundModal((prev) => ({ ...prev, amount: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                {t('billingAdmin.refund.reason')}
              </label>
              <input
                type="text"
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                value={refundModal.reason}
                onChange={(e) => setRefundModal((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder={t('billingAdmin.refund.reasonPlaceholder')}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={closeRefundModal}
              className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
            >
              {t('billingAdmin.action.cancel')}
            </button>
            <button
              onClick={handleRefundSubmit}
              disabled={refundModal.submitting}
              className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60"
            >
              {refundModal.submitting
                ? t('billingAdmin.refund.submitting')
                : t('billingAdmin.refund.confirm')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 根据 activeTab 动态获取表格配置（用户账单为前端分页，使用 billing_info 切片）
  const getTableConfig = () => {
    if (activeTab === 'user') {
      const { pageNum, pageSize, total } = userBillPagination;
      const start = (pageNum - 1) * pageSize;
      const pageData = userBills.slice(start, start + pageSize);
      return {
        columns: userBillColumns,
        data: pageData,
        rowKey: (bill: UserBillBillingInfo, index: number) =>
          `${bill.external_id ?? ''}-${bill.supplier_id ?? ''}-${bill.owner_id ?? ''}-${start + index}`,
        actions: userBillActions,
        pagination: {
          pageNum,
          pageSize,
          total,
          pageSizes: [10, 20, 50, 100],
          compact: true,
          onChange: (page: number) => setUserBillPagination((prev) => ({ ...prev, pageNum: page })),
          onPageSizeChange: (size: number) =>
            setUserBillPagination({
              pageNum: 1,
              pageSize: size,
              total: userBillPagination.total,
            }),
        },
        title: t('billingAdmin.table.user.title'),
        emptyTitle: t('billingAdmin.table.empty'),
      };
    } else if (activeTab === 'supplier') {
      return {
        columns: supplierSettlementColumns,
        data: supplierSettlements,
        rowKey: (settlement: any, index: number) =>
          settlement.id ?? settlement.supplier_id ?? `settlement-${index}`,
        actions: supplierSettlementActions,
        pagination: {
          pageNum: supplierPagination.pageNum,
          pageSize: supplierPagination.pageSize,
          total: supplierPagination.total,
          pageSizes: [10, 20, 50, 100],
          compact: true,
          onChange: (page: number) => setSupplierPagination((prev) => ({ ...prev, pageNum: page })),
          onPageSizeChange: (size: number) =>
            setSupplierPagination({
              pageNum: 1,
              pageSize: size,
              total: supplierPagination.total,
            }),
        },
        title: t('billingAdmin.table.supplier.title'),
        emptyTitle: t('billingAdmin.table.empty'),
      };
    } else if (activeTab === 'refunds') {
      const refundColumns: any[] = [
        { key: 'refundId', label: 'ID', width: '8%' },
        { key: 'userName', label: t('billingAdmin.refund.user') || 'User', width: '12%' },
        { key: 'orderNo', label: t('billingAdmin.refund.orderNo'), width: '15%' },
        {
          key: 'refundAmount',
          label: t('billingAdmin.refund.amount'),
          width: '10%',
          render: (val: number) => `$${(val ?? 0).toFixed(2)}`,
        },
        { key: 'payChannel', label: t('billingAdmin.refund.payChannel'), width: '10%' },
        { key: 'reason', label: t('billingAdmin.refund.reason'), width: '15%' },
        {
          key: 'auditStatus',
          label: t('billingAdmin.refund.status') || 'Status',
          width: '10%',
          render: (val: string) =>
            val === '0' ? 'Pending' : val === '1' ? 'Approved' : 'Rejected',
        },
        {
          key: 'requestTime',
          label: t('billingAdmin.refund.requestTime') || 'Requested',
          width: '12%',
          render: (val: string) => (val ? new Date(val).toLocaleDateString() : '-'),
        },
      ];
      const refundActions: any[] = [
        {
          label: t('billingAdmin.refund.approve') || 'Approve',
          onClick: (row: RefundRequestVo) =>
            setRefundAuditModal({
              show: true,
              request: row,
              action: 'approve',
              reason: '',
              submitting: false,
            }),
          variant: 'primary' as const,
          show: (row: RefundRequestVo) => row.auditStatus === '0',
        },
        {
          label: t('billingAdmin.refund.reject') || 'Reject',
          onClick: (row: RefundRequestVo) =>
            setRefundAuditModal({
              show: true,
              request: row,
              action: 'reject',
              reason: '',
              submitting: false,
            }),
          variant: 'danger' as const,
          show: (row: RefundRequestVo) => row.auditStatus === '0',
        },
      ];
      return {
        columns: refundColumns,
        data: refundRequests,
        rowKey: (item: RefundRequestVo) => String(item.refundId),
        actions: refundActions,
        pagination: {
          pageNum: refundPagination.pageNum,
          pageSize: refundPagination.pageSize,
          total: refundPagination.total,
          pageSizes: [10, 20, 50, 100],
          compact: true,
          onChange: (page: number) => setRefundPagination((prev) => ({ ...prev, pageNum: page })),
          onPageSizeChange: (size: number) =>
            setRefundPagination({ pageNum: 1, pageSize: size, total: refundPagination.total }),
        },
        title: t('billingAdmin.tab.refundRequests') || 'Refund Requests',
        emptyTitle: t('billingAdmin.table.empty'),
      };
    } else {
      return {
        columns: reconciliationColumns,
        data: reconciliationData,
        rowKey: (item: any, index: number) => item.id || `reconciliation-${index}`,
        actions: reconciliationActions,
        pagination: {
          pageNum: reconciliationPagination.pageNum,
          pageSize: reconciliationPagination.pageSize,
          total: reconciliationPagination.total,
          pageSizes: [10, 20, 50, 100],
          compact: true,
          onChange: (page: number) =>
            setReconciliationPagination((prev) => ({ ...prev, pageNum: page })),
          onPageSizeChange: (size: number) =>
            setReconciliationPagination({
              pageNum: 1,
              pageSize: size,
              total: reconciliationPagination.total,
            }),
        },
        title: t('billingAdmin.table.platform.title'),
        emptyTitle: t('billingAdmin.table.empty'),
      };
    }
  };

  const tableConfig = getTableConfig();

  return (
    <div className="flex flex-col h-full max-h-full bg-slate-50 overflow-hidden relative">
      {/* 错误提示 */}
      {error && (
        <div className="px-3 pt-2 flex-shrink-0">
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {t('billingAdmin.error.banner', { message: error })}
          </div>
        </div>
      )}

      <div className="h-full max-h-full p-2 sm:p-4 border border-slate-200 shadow-sm overflow-hidden min-w-0 flex-1 min-h-0">
        <EnterpriseTable
          title={t('billingAdmin.title')}
          description={t('billingAdmin.subtitle')}
          columns={tableConfig.columns}
          data={tableConfig.data as any[]}
          rowKey={tableConfig.rowKey as any}
          loading={loading}
          actions={tableConfig.actions}
          toolbarActions={[
            {
              key: 'refresh',
              label: t('billingAdmin.action.refresh'),
              icon: <Icons.Zap className="w-4 h-4" />,
              onClick: loadData,
              type: 'secondary' as const,
            },
          ]}
          headerExtra={
            <div className="flex items-center space-x-3">
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => setTimeRange('day')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    timeRange === 'day'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t('billingAdmin.range.day')}
                </button>
                <button
                  onClick={() => setTimeRange('week')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    timeRange === 'week'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t('billingAdmin.range.week')}
                </button>
                <button
                  onClick={() => setTimeRange('month')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    timeRange === 'month'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t('billingAdmin.range.month')}
                </button>
              </div>
            </div>
          }
          searchExtra={
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <p className="text-sm text-slate-500 font-medium uppercase">
                  {t('billingAdmin.stats.totalRevenue')}
                </p>
                <div className="flex items-baseline mt-3">
                  <span className="text-3xl font-bold text-slate-900">
                    ${formatNumber(stats.totalRevenue)}
                  </span>
                </div>
                <p className="text-sm text-green-600 mt-2 font-medium">
                  {t('billingAdmin.stats.revenueChange')}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <p className="text-sm text-slate-500 font-medium uppercase">
                  {t('billingAdmin.stats.supplierCost')}
                </p>
                <div className="flex items-baseline mt-3">
                  <span className="text-3xl font-bold text-slate-900">
                    ${formatNumber(stats.supplierCost)}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-2 font-medium">
                  {t('billingAdmin.stats.settlementEta', {
                    date: t('billingAdmin.stats.sampleSettleDate'),
                  })}
                </p>
              </div>
              <div className="bg-gradient-to-br from-brand-500 to-brand-600 p-5 rounded-xl border border-transparent shadow-lg text-white">
                <p className="text-sm text-brand-100 font-medium uppercase">
                  {t('billingAdmin.stats.grossProfit')}
                </p>
                <div className="flex items-baseline mt-3">
                  <span className="text-3xl font-bold">${formatNumber(stats.grossProfit)}</span>
                </div>
                <p className="text-sm text-brand-100 mt-2 font-medium">
                  {t('billingAdmin.stats.margin', {
                    value: formatNumber((stats.grossProfit / (stats.totalRevenue || 1)) * 100, 1),
                  })}
                  %
                </p>
              </div>
            </div>
          }
          filters={
            <div className="flex flex-wrap gap-4 items-center">
              <button
                onClick={() => setActiveTab('user')}
                className={`px-4 py-2.5 text-base font-medium transition-colors rounded-lg ${
                  activeTab === 'user'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t('billingAdmin.tab.userBills')}
              </button>
              <button
                onClick={() => setActiveTab('supplier')}
                className={`px-4 py-2.5 text-base font-medium transition-colors rounded-lg ${
                  activeTab === 'supplier'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t('billingAdmin.tab.supplierSettlements')}
              </button>
              <button
                onClick={() => setActiveTab('reconciliation')}
                className={`px-4 py-2.5 text-base font-medium transition-colors rounded-lg flex items-center ${
                  activeTab === 'reconciliation'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icons.Scale className="w-5 h-5 mr-2.5" />
                {t('billingAdmin.tab.reconciliation')}
              </button>
              <button
                onClick={() => setActiveTab('refunds')}
                className={`px-4 py-2.5 text-base font-medium transition-colors rounded-lg flex items-center ${
                  activeTab === 'refunds'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icons.CreditCard className="w-5 h-5 mr-2.5" />
                {t('billingAdmin.tab.refundRequests') || 'Refund Requests'}
              </button>
            </div>
          }
          pagination={tableConfig.pagination}
          empty={{
            title: tableConfig.emptyTitle,
            description: t('billingAdmin.empty.byRange', {
              range:
                timeRange === 'day'
                  ? t('billingAdmin.range.dayShort')
                  : timeRange === 'week'
                    ? t('billingAdmin.range.weekShort')
                    : t('billingAdmin.range.monthShort'),
            }),
            icon: <Icons.Box className="w-12 h-12 text-slate-300" />,
          }}
          height="100%"
          width="100%"
        />
      </div>

      {/* 模态框组件 */}
      {renderModal()}

      {/* 退款弹窗 */}
      {renderRefundModal()}

      {/* 退款审核弹窗 */}
      {refundAuditModal.show && refundAuditModal.request && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-11/12 max-w-lg">
            <h3 className="text-lg font-bold mb-4">
              {refundAuditModal.action === 'approve'
                ? t('billingAdmin.refund.approveTitle') || 'Approve Refund'
                : t('billingAdmin.refund.rejectTitle') || 'Reject Refund'}
            </h3>
            <div className="space-y-3 text-sm text-slate-700 mb-4">
              <p>
                <strong>{t('billingAdmin.refund.user') || 'User'}:</strong>{' '}
                {refundAuditModal.request.userName}
              </p>
              <p>
                <strong>{t('billingAdmin.refund.orderNo')}:</strong>{' '}
                <span className="font-mono">{refundAuditModal.request.orderNo}</span>
              </p>
              <p>
                <strong>{t('billingAdmin.refund.amount')}:</strong> $
                {refundAuditModal.request.refundAmount?.toFixed(2)} (
                {refundAuditModal.request.payChannel})
              </p>
              <p>
                <strong>{t('billingAdmin.refund.reason')}:</strong>{' '}
                {refundAuditModal.request.reason || '-'}
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('billingAdmin.refund.auditReason') || 'Audit note'}
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  value={refundAuditModal.reason}
                  onChange={(e) =>
                    setRefundAuditModal((prev) => ({ ...prev, reason: e.target.value }))
                  }
                  placeholder={
                    refundAuditModal.action === 'reject' ? 'Reason for rejection' : 'Optional note'
                  }
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() =>
                  setRefundAuditModal({
                    show: false,
                    request: undefined,
                    action: undefined,
                    reason: '',
                    submitting: false,
                  })
                }
                className="px-4 py-2 border border-slate-300 text-sm rounded-md text-slate-700 bg-white hover:bg-slate-50"
              >
                {t('dialog.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleRefundAudit}
                disabled={refundAuditModal.submitting}
                className={`px-4 py-2 text-sm rounded-md text-white disabled:opacity-60 ${
                  refundAuditModal.action === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {refundAuditModal.submitting
                  ? '...'
                  : refundAuditModal.action === 'approve'
                    ? t('billingAdmin.refund.approve') || 'Approve'
                    : t('billingAdmin.refund.reject') || 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 账单详情弹窗 */}
      {renderDetailModal()}

      {/* 供应商结算详情弹窗 */}
      {renderSupplierDetailModal()}

      {/* 平台对账详情弹窗 */}
      {renderReconciliationDetailModal()}

      {/* 确认对话框 */}
      {confirmDialog.show && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          type={confirmDialog.type}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog({ ...confirmDialog, show: false })}
        />
      )}
    </div>
  );
};

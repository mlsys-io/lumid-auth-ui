import React, { useState, useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { getUserBillList } from '@/runmesh/api/user/billingApi';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import { getUserUsageTaskList } from '@/runmesh/api/user/taskApi';
import { createAlipayPayment, createStripePayment, submitRefundRequest } from '@/runmesh/api/user/paymentApi';
import { NebulaPayRequestBo } from '@/runmesh/types';
import { allowRefresh } from '@/runmesh/utils/apiRateLimiter';
import { useAuthStore } from '@/runmesh/stores/useAuthStore';
import { useEnterpriseTip } from '@/runmesh/components/EnterpriseTip';
import { useLanguage } from '@/runmesh/i18n';
import type { NebulaTaskVo } from '@/runmesh/types';
interface UsageLog {
  id: string;
  taskName: string;
  computeType: string;
  startTime: string;
  duration: string;
  rate: string;
  cost: string;
  payChannel?: string;
  payStatus?: string;
  billNo?: string;
  billType?: string | number; // 账单类型: 1=收入(充值)、2=支出(消费)
  transactionId?: string;
  amountValue?: number;
  orderNo?: string;
  invoiceUrl?: string; // 发票URL
}

type UsageDetailRow = {
  id: string;
  taskId: string;
  taskName: string;
  computeType: string;
  startedAt?: string;
  runtimeSec?: number;
  totalCost?: number;
  costCurrency?: string;
  costPerHour?: number | string;
};

const formatCostFull = (
  value: number | string | undefined | null,
  currency: string | undefined,
) => {
  if (value === undefined || value === null || value === '') {
    const cur = currency || 'USD';
    return cur === 'USD' ? '$0.0000' : `0.0000 ${cur}`;
  }
  const cur = currency || 'USD';
  // 统一格式化为四位小数
  let numValue: number;
  if (typeof value === 'string') {
    numValue = parseFloat(value);
    if (Number.isNaN(numValue)) {
      return cur === 'USD' ? '$0.0000' : `0.0000 ${cur}`;
    }
  } else {
    numValue = value;
  }
  const formatted = numValue.toFixed(4);
  return cur === 'USD' ? `$${formatted}` : `${formatted} ${cur}`;
};

const formatSecondsToMinSec = (
  seconds: number | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) => {
  if (seconds == null) return '-';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return t('billing.duration.secondsOnly', { total });
  const m = Math.floor(total / 60);
  const s = total % 60;
  return t('billing.duration.minSec', { m, s });
};

const formatDateTimeYmdHms = (value?: string) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
};

const getComputeTypeFromUsage = (usage: any) => {
  const gpus = usage?.hardware?.gpu?.gpus;
  if (Array.isArray(gpus) && gpus.length > 0) {
    const name = gpus[0]?.name || 'GPU';
    const count = gpus.length;
    return `${name} x ${count}`;
  }
  return '-';
};

const RechargeModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) => {
  const { user, setUser } = useAuthStore();
  const { warning, error } = useEnterpriseTip();
  const { t } = useLanguage();

  // Fetch Runmesh profile on mount if the auth-store isn't populated yet
  // (race with AppLayout's bridge when user lands directly on /app/billing).
  useEffect(() => {
    if (user?.id) return;
    (async () => {
      try {
        const { httpUser } = await import('@/runmesh/utils/axios');
        const profile = await httpUser.get<any>('/runmesh/system/user/profile');
        const u = profile?.user ?? profile;
        if (u?.userId != null) {
          setUser({
            id: u.userId,
            username: u.userName || '',
            nickname: u.nickName || '',
            email: u.email || '',
            role: 'user' as any,
          } as any);
        }
      } catch {
        // ignore — user will see the "Invalid user info" error on click,
        // same as before. This is best-effort backfill.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [amount, setAmount] = useState<number | string>('');
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'transfer'>('online');
  const [isProcessing, setIsProcessing] = useState(false);
  const [amountError, setAmountError] = useState<string>(''); // 金额错误提示

  const packages = [
    { id: 'pkg_1', name: t('billing.recharge.package.starter'), amount: 10, bonus: 0 },
    { id: 'pkg_2', name: t('billing.recharge.package.pro'), amount: 50, bonus: 5 },
    { id: 'pkg_3', name: t('billing.recharge.package.enterprise'), amount: 200, bonus: 30 },
  ];

  // 支付方式对应的最小金额限制（统一使用美元）
  const MIN_AMOUNT = {
    online: 0.01, // 支付宝最小0.01美元
    transfer: 4, // Stripe最小4美元（400美分）
  };

  // 统一使用美元符号
  const getCurrencySymbol = () => '$';
  const getCurrencyName = () => t('billing.currency.usdName');
  const getMinAmount = () => MIN_AMOUNT[paymentMethod];

  // 切换支付方式时重置金额和选择的套餐
  const handlePaymentMethodChange = (method: 'online' | 'transfer') => {
    setPaymentMethod(method);
    setAmount(''); // 清空金额
    setSelectedPackage(null); // 取消套餐选择
    setAmountError(''); // 清空错误提示
  };

  // 处理充值提交
  const handleSubmit = async () => {
    // 验证金额不能为空、零或负数
    if (!amount || Number(amount) <= 0) {
      warning(t('billing.recharge.error.invalidAmount'));
      return;
    }

    // 验证最小金额
    const minAmount = getMinAmount();
    if (Number(amount) < minAmount) {
      const currencySymbol = getCurrencySymbol();
      const currencyName = getCurrencyName();
      warning(
        t('billing.recharge.error.minAmount', {
          method:
            paymentMethod === 'online'
              ? t('billing.recharge.method.online')
              : t('billing.recharge.method.transfer'),
          symbol: currencySymbol,
          amount: minAmount,
          currency: currencyName,
        }),
      );
      return;
    }

    // Soft-fallback: the Runmesh backend overrides payload userId with
    // LoginHelper.getUserId() from Sa-Token anyway, so we don't need a
    // real effectiveUserId client-side. Only used to seed the orderNo for the
    // user's own record-keeping. Fall back to a timestamp-derived ID.
    const effectiveUserId: number | string = user?.id ?? `lm-${Date.now()}`;

    if (paymentMethod === 'online') {
      // 在线支付 - 调用支付宝支付接口
      try {
        setIsProcessing(true);

        // 生成订单号
        const orderNo = `ORDER_${Date.now()}_${effectiveUserId}`;

        // 构建支付宝支付请求
        const payRequest: NebulaPayRequestBo = {
          orderNo,
          userId: Number(effectiveUserId),
          amount: Number(amount),
          subject: `Computing Power Recharge`, // 统一使用英文
          body: `Recharge amount: $${amount} USD`,
          countryCode: 'CN',
          // returnUrl 和 notifyUrl 由后端统一设置，前端不传值
        };

        const response = await createAlipayPayment(payRequest);

        // axios拦截器已经解包,response直接是NebulaPayResponseVo类型
        if (response && response.success) {
          // 支付宝返回的是HTML form字符串,需要在新窗口打开
          const payData = response.payData;
          if (payData) {
            // 创建一个临时div来渲染支付宝返回的form
            const div = document.createElement('div');
            div.innerHTML = payData;
            document.body.appendChild(div);

            // 提交表单跳转到支付宝支付页面
            const form = div.querySelector('form');
            if (form) {
              form.submit();
              // 关闭充值弹窗
              onClose();
              if (onSuccess) {
                onSuccess();
              }
            } else {
              error(t('billing.recharge.error.payRedirectFailed'));
            }

            // 清理临时元素
            setTimeout(() => {
              document.body.removeChild(div);
            }, 1000);
          } else {
            error(t('billing.recharge.error.payDataMissing'));
          }
        } else {
          // 处理支付发起失败的情况
          const errorMsg = response?.errorMsg || t('billing.recharge.error.payInitFailed');
          error(t('billing.recharge.error.payInitFailedWithReason', { reason: errorMsg }));
        }
      } catch (error: any) {
        console.error('Alipay payment error:', error.message);

        // 提取详细的错误信息
        let errorMessage = t('billing.recharge.error.tryLater');

        if (error.response) {
          // 服务器返回了错误响应
          const { status, data } = error.response;

          if (data?.msg) {
            errorMessage = data.msg;
          } else if (data?.message) {
            errorMessage = data.message;
          } else if (status === 401) {
            errorMessage = t('billing.recharge.error.unauthorized');
          } else if (status === 403) {
            errorMessage = t('billing.recharge.error.forbidden');
          } else if (status === 404) {
            errorMessage = t('billing.recharge.error.apiNotFound');
          } else if (status === 500) {
            errorMessage = t('billing.recharge.error.serverError');
          } else {
            errorMessage = t('billing.recharge.error.requestFailed', { status });
          }
        } else if (error.request) {
          errorMessage = t('billing.recharge.error.network');
        } else {
          // 其他错误
          errorMessage = error.message || t('billing.recharge.error.unknown');
        }

        error(t('billing.recharge.error.payRequestFailed', { reason: errorMessage }));
      } finally {
        setIsProcessing(false);
      }
    } else {
      // 企业转账 - Stripe支付(美元)
      try {
        setIsProcessing(true);

        // 生成订单号
        const orderNo = `ORDER_${Date.now()}_${effectiveUserId}`;

        // 构建Stripe支付请求
        const payRequest: NebulaPayRequestBo = {
          orderNo,
          userId: Number(effectiveUserId),
          amount: Number(amount),
          subject: `Computing Power Recharge`, // Stripe使用英文标题
          body: `Recharge amount: $${amount} USD`, // 美元单位
          countryCode: 'US', // 海外支付
          // returnUrl 和 notifyUrl 由后端统一设置，前端不传值
        };

        const response = await createStripePayment(payRequest);

        // Stripe返回的是Checkout Session URL,直接跳转
        if (response && response.success) {
          const checkoutUrl = response.payData;
          if (checkoutUrl) {
            // 直接在当前窗口跳转到Stripe Checkout页面
            window.location.href = checkoutUrl;

            // 关闭充值弹窗
            onClose();
            if (onSuccess) {
              onSuccess();
            }
          } else {
            error(t('billing.recharge.error.payLinkMissing'));
          }
        } else {
          // 处理支付发起失败的情况
          const errorMsg = response?.errorMsg || t('billing.recharge.error.stripeInitFailed');
          error(t('billing.recharge.error.payInitFailedWithReason', { reason: errorMsg }));
        }
      } catch (error: any) {
        console.error('Stripe payment error:', error.message);

        // 提取详细的错误信息
        let errorMessage = t('billing.recharge.error.tryLater');

        if (error.response) {
          const { status, data } = error.response;

          if (data?.msg) {
            errorMessage = data.msg;
          } else if (data?.message) {
            errorMessage = data.message;
          } else if (status === 401) {
            errorMessage = t('billing.recharge.error.unauthorized');
          } else if (status === 403) {
            errorMessage = t('billing.recharge.error.forbidden');
          } else if (status === 404) {
            errorMessage = t('billing.recharge.error.apiNotFound');
          } else if (status === 500) {
            errorMessage = t('billing.recharge.error.serverError');
          } else {
            errorMessage = t('billing.recharge.error.requestFailed', { status });
          }
        } else if (error.request) {
          errorMessage = t('billing.recharge.error.network');
        } else {
          errorMessage = error.message || t('billing.recharge.error.unknown');
        }

        error(t('billing.recharge.error.stripeRequestFailed', { reason: errorMessage }));
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center">
            <Icons.CreditCard className="w-5 h-5 mr-2 text-brand-600" />
            {t('billing.recharge.title')}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Fixed Packages */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              {t('billing.recharge.packages')}
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => {
                    setSelectedPackage(pkg.id);
                    setAmount(pkg.amount);
                    setAmountError(''); // 选择套餐时清空错误提示
                  }}
                  className={`relative border rounded-lg p-4 cursor-pointer transition-all flex justify-between items-center ${
                    selectedPackage === pkg.id
                      ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                      : 'border-slate-200 hover:border-brand-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-800">{pkg.name}</div>
                    {pkg.bonus > 0 && (
                      <div className="text-xs text-green-600 font-medium">
                        {t('billing.recharge.bonus', {
                          symbol: getCurrencySymbol(),
                          amount: pkg.bonus,
                        })}
                      </div>
                    )}
                  </div>
                  <div className="text-lg font-bold text-brand-700">
                    {getCurrencySymbol()}
                    {pkg.amount}
                  </div>
                  {selectedPackage === pkg.id && (
                    <div className="absolute top-1/2 -left-2 transform -translate-y-1/2 w-4 h-4 bg-brand-500 rounded-full border-2 border-white"></div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Custom Amount */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              {t('billing.recharge.customAmount')}
            </h3>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
                {getCurrencySymbol()}
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder={t('billing.recharge.amountPlaceholder')}
                value={amount}
                onChange={(e) => {
                  const value = e.target.value;
                  setAmount(value);
                  setSelectedPackage(null);

                  // 实时验证并显示错误提示
                  if (value !== '' && Number(value) <= 0) {
                    setAmountError(t('billing.recharge.error.amountPositive'));
                  } else {
                    setAmountError('');
                  }
                }}
                onKeyDown={(e) => {
                  // 阻止输入负号和字母e（科学计数法）
                  if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                    e.preventDefault();
                  }
                }}
                className={`w-full pl-8 pr-4 py-3 border rounded-lg focus:ring-2 outline-none font-bold text-slate-800 ${
                  amountError
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-slate-300 focus:ring-brand-500'
                }`}
              />
            </div>
            {amountError && (
              <p className="mt-2 text-xs text-red-600 font-medium flex items-center">
                <Icons.AlertCircle className="w-3 h-3 mr-1" />
                {amountError}
              </p>
            )}
            {!amountError && (
              <p className="mt-2 text-xs text-slate-500">
                {t('billing.recharge.minAmountHint', {
                  symbol: getCurrencySymbol(),
                  amount: getMinAmount(),
                  currency: getCurrencyName(),
                })}
              </p>
            )}
          </div>

          {/* Payment Method */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              {t('billing.recharge.paymentMethod')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div
                onClick={() => handlePaymentMethodChange('online')}
                className={`border rounded-lg p-3 cursor-pointer flex items-center space-x-3 transition-colors ${
                  paymentMethod === 'online'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icons.CreditCard className="w-5 h-5 text-slate-600" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-800">
                    {t('billing.recharge.method.online')}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {t('billing.recharge.method.alipay')}
                  </span>
                </div>
              </div>
              <div
                onClick={() => handlePaymentMethodChange('transfer')}
                className={`border rounded-lg p-3 cursor-pointer flex items-center space-x-3 transition-colors ${
                  paymentMethod === 'transfer'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icons.Landmark className="w-5 h-5 text-slate-600" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-800">
                    {t('billing.recharge.method.transfer')}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {t('billing.recharge.method.stripe')}
                  </span>
                </div>
              </div>
              {paymentMethod === 'transfer' && (
                <div className="col-span-2 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start space-x-3">
                  <Icons.Briefcase className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-800">
                    <p className="font-semibold mb-1">{t('billing.recharge.stripe.title')}</p>
                    <p className="mb-1">{t('billing.recharge.stripe.desc')}</p>
                    <p className="font-medium text-amber-700">
                      {t('billing.recharge.stripe.notice')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('dialog.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isProcessing}
            className="px-6 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 shadow-sm flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <Icons.Zap className="w-4 h-4 mr-2 animate-spin" />
                {t('billing.recharge.processing')}
              </>
            ) : (
              <>
                <Icons.Check className="w-4 h-4 mr-2" />
                {paymentMethod === 'online'
                  ? t('billing.recharge.confirmPay')
                  : t('billing.recharge.payNow')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// 统一的分页组件
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSize: number;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  startItem,
  endItem,
  onPageChange,
  onPageSizeChange,
  pageSize,
}) => {
  const { t } = useLanguage();
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push(-1); // 表示省略号
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push(-1); // 表示省略号
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push(-1); // 表示省略号
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push(-1); // 表示省略号
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <span className="text-xs text-slate-500">
          {t('billing.pagination.summary', {
            start: startItem,
            end: endItem,
            total: totalItems,
          })}
        </span>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-500">{t('billing.pagination.perPage')}</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="border border-slate-200 rounded text-xs py-1 px-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>
      <div className="flex items-center space-x-1">
        <button
          className={`px-3 py-1 border rounded text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 ${currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage <= 1}
        >
          <Icons.ChevronRight className="w-4 h-4 rotate-180" />
        </button>

        {getPageNumbers().map((page, index) =>
          page === -1 ? (
            <span key={`ellipsis-${index}`} className="px-2 py-1 text-xs text-slate-400">
              ...
            </span>
          ) : (
            <button
              key={page}
              className={`px-3 py-1 border rounded text-xs font-medium ${
                currentPage === page
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          ),
        )}

        <button
          className={`px-3 py-1 border rounded text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 ${currentPage >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          disabled={currentPage >= totalPages || totalPages === 0}
        >
          <Icons.ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const Billing: React.FC = () => {
  const { user } = useAuthStore();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'transactions' | 'usage'>('usage');
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [usageTasks, setUsageTasks] = useState<NebulaTaskVo[]>([]);
  const [expandedUsageTaskIds, setExpandedUsageTaskIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [userBalance, setUserBalance] = useState<number>(0); // 用户金额
  const [totalItems, setTotalItems] = useState<number>(0); // 后端返回的总数
  const [pagination, setPagination] = useState({
    pageNum: 1,
    pageSize: 10,
  });
  const [detailModal, setDetailModal] = useState<{
    show: boolean;
    record?: UsageLog;
  }>({
    show: false,
    record: undefined,
  });
  const [usageDetailModal, setUsageDetailModal] = useState<{
    show: boolean;
    record?: UsageDetailRow;
  }>({ show: false, record: undefined });
  const [refundModal, setRefundModal] = useState<{
    show: boolean;
    record?: UsageLog;
    amount: number;
    reason: string;
    submitting: boolean;
  }>({
    show: false,
    record: undefined,
    amount: 0,
    reason: '',
    submitting: false,
  });
  const { warning, error, success } = useEnterpriseTip();

  const canRequestRefund = (record: UsageLog) => {
    const payChannel = record.payChannel;
    const statusOk = record.payStatus === 'SUCCESS';
    const orderNo = record.orderNo || record.billNo || record.transactionId || record.id;
    const amountValid = Math.abs(record.amountValue ?? 0) > 0;
    return Boolean(payChannel && statusOk && orderNo && amountValid);
  };

  const handleRefundClick = (record: UsageLog) => {
    if (!canRequestRefund(record)) {
      warning(t('billing.refund.onlySuccess'));
      return;
    }
    setRefundModal({
      show: true,
      record,
      amount: Math.abs(record.amountValue ?? 0),
      reason: '',
      submitting: false,
    });
  };

  const closeRefundModal = () => {
    setRefundModal({ show: false, record: undefined, amount: 0, reason: '', submitting: false });
  };

  const handleRefundSubmit = async () => {
    if (!refundModal.record) return;
    const record = refundModal.record;
    const orderNo = record.orderNo || record.billNo || record.transactionId || record.id;
    if (!orderNo) {
      error(t('billing.refund.error.missingOrder'));
      return;
    }
    const refundAmount = Number(refundModal.amount);
    if (!refundAmount || refundAmount <= 0) {
      error(t('billing.refund.error.amountPositive'));
      return;
    }
    setRefundModal((prev) => ({ ...prev, submitting: true }));
    try {
      await submitRefundRequest({
        orderNo: String(orderNo),
        refundAmount,
        reason: refundModal.reason || t('billing.refund.defaultReason'),
      });
      success(t('billing.refund.requestSubmitted') || 'Refund request submitted for review');
      closeRefundModal();
    } catch (err: any) {
      error(err?.response?.data?.msg || err?.message || t('billing.refund.error.failed'));
      setRefundModal((prev) => ({ ...prev, submitting: false }));
    }
  };

  // 获取交易记录和账单数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        if (activeTab === 'usage') {
          // 算力消耗明细：不传入参，直接获取当前用户所有任务（每个任务带 usages 二级列表）
          const resp = await getUserUsageTaskList({
            pageNum: pagination.pageNum,
            pageSize: pagination.pageSize,
          });
          setUsageTasks(resp.rows ?? []);
          setTotalItems(resp.total ?? 0);
          setExpandedUsageTaskIds([]);
        } else {
          // 交易记录调用 getUserBillList 接口
          const billResponse = await getUserBillList(
            {},
            { pageNum: pagination.pageNum, pageSize: pagination.pageSize },
          );
          const formattedUsageLogs = billResponse.rows.map((bill) => {
            const amountValue = Number(bill.amount) || 0;
            const orderNo = bill.billNo || bill.id?.toString();
            // billType: 1=收入(充值)、2=支出(消费)
            const isIncome = String(bill.billType) === '1';
            return {
              id: bill.id?.toString() || 'N/A',
              taskName: bill.bizType || t('billing.description.computeUsage'),
              computeType: 'RTX 4090 x 1', // 这里需要根据实际数据调整
              startTime: bill.billTime
                ? new Date(bill.billTime).toISOString().split('T')[0]
                : t('billing.common.na'),
              duration: '0h 45m 12s', // 这里需要根据实际数据调整
              rate: '$0.45/h', // 美元单位
              cost: formatCostFull(bill.amount ? Math.abs(bill.amount) : 0, bill.currency),
              payChannel: bill.payChannel,
              payStatus: bill.payStatus,
              billNo: bill.billNo,
              billType: bill.billType, // 保存billType用于判断收入/支出
              transactionId: bill.id?.toString(),
              amountValue: isIncome ? Math.abs(amountValue) : -Math.abs(amountValue), // 收入为正，支出为负
              orderNo,
              invoiceUrl: undefined, // 发票URL，如果有的话
            } as UsageLog;
          });
          setUsageLogs(formattedUsageLogs);
          setTotalItems(billResponse.total || 0); // 设置总数

          // 从最新账单获取用户余额
          if (billResponse.rows && billResponse.rows.length > 0) {
            const latestBalance = billResponse.rows[0].balanceAfter || 0;
            setUserBalance(latestBalance);
          }
        }
      } catch (error: any) {
        console.error('获取数据失败:', error);
        // 检查是否是权限错误
        if (error?.response?.status === 403) {
          // 权限不足，显示提示信息
          if (activeTab === 'usage') {
            setUsageLogs([]);
          } else {
            setUsageLogs([]);
          }
        } else {
          // 其他错误，保持假数据作为后备
          if (activeTab === 'usage') {
            setUsageTasks([]);
          } else {
            setUsageLogs([]);
          }
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTab, pagination.pageNum, pagination.pageSize, t]);

  // 组件加载时获取余额
  useEffect(() => {
    if (user && user.amount !== undefined) {
      setUserBalance(user.amount);
    }
  }, [user]);

  // 刷新数据
  const refreshData = async () => {
    try {
      // 允许绕过API频率限制
      allowRefresh('/bill/list');
      allowRefresh('/transaction/list');

      setLoading(true);

      if (activeTab === 'usage') {
        const resp = await getUserUsageTaskList({
          pageNum: pagination.pageNum,
          pageSize: pagination.pageSize,
        });
        setUsageTasks(resp.rows ?? []);
        setTotalItems(resp.total ?? 0);
        setExpandedUsageTaskIds((prev) => {
          const validIds = new Set((resp.rows ?? []).map((task) => String(task?.taskId ?? '')));
          return prev.filter((id) => validIds.has(id));
        });
      } else {
        // 交易记录调用 getUserBillList 接口
        const billResponse = await getUserBillList(
          {},
          { pageNum: pagination.pageNum, pageSize: pagination.pageSize },
        );
        const formattedUsageLogs = billResponse.rows.map((bill) => {
          const amountValue = Number(bill.amount) || 0;
          const orderNo = bill.billNo || bill.id?.toString();
          // billType: 1=收入(充值)、2=支出(消费)
          const isIncome = String(bill.billType) === '1';
          return {
            id: bill.id?.toString() || t('billing.common.na'),
            taskName: bill.bizType || t('billing.description.computeUsage'),
            computeType: 'RTX 4090 x 1', // 这里需要根据实际数据调整
            startTime: bill.billTime
              ? new Date(bill.billTime).toISOString().split('T')[0]
              : t('billing.common.na'),
            duration: '0h 45m 12s', // 这里需要根据实际数据调整
            rate: '$0.45/h', // 美元单位
            cost: formatCostFull(bill.amount ? Math.abs(bill.amount) : 0, bill.currency),
            payChannel: bill.payChannel,
            payStatus: bill.payStatus,
            billNo: bill.billNo,
            billType: bill.billType, // 保存billType用于判断收入/支出
            transactionId: bill.id?.toString(),
            amountValue: isIncome ? Math.abs(amountValue) : -Math.abs(amountValue), // 收入为正，支出为负
            orderNo,
            invoiceUrl: undefined, // 发票URL，如果有的话
          } as UsageLog;
        });
        setUsageLogs(formattedUsageLogs);
        setTotalItems(billResponse.total || 0); // 设置总数

        // 从最新账单获取用户余额
        if (billResponse.rows && billResponse.rows.length > 0) {
          const latestBalance = billResponse.rows[0].balanceAfter || 0;
          setUserBalance(latestBalance);
        }
      }
    } catch (error: any) {
      console.error('刷新数据失败:', error);
      // 检查是否是权限错误
      if (error?.response?.status === 403) {
        // 权限不足，显示提示信息
        if (activeTab === 'usage') {
          setUsageTasks([]);
        } else {
          setUsageLogs([]);
        }
      } else {
        // 其他错误，保持假数据作为后备
        if (activeTab === 'usage') {
          setUsageTasks([]);
        } else {
          setUsageLogs([]);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // 计算分页信息
  const totalPages =
    activeTab === 'usage'
      ? Math.ceil(totalItems / pagination.pageSize)
      : Math.ceil(totalItems / pagination.pageSize);
  const startItem =
    activeTab === 'usage'
      ? (pagination.pageNum - 1) * pagination.pageSize + 1
      : (pagination.pageNum - 1) * pagination.pageSize + 1;
  const endItem =
    activeTab === 'usage'
      ? Math.min(pagination.pageNum * pagination.pageSize, totalItems)
      : Math.min(pagination.pageNum * pagination.pageSize, totalItems);
  const paginatedData = activeTab === 'usage' ? (usageTasks as any) : usageLogs; // usage 使用后端分页；交易记录直接使用后端返回的数据（已分页）

  const toggleUsageTaskExpand = (task: NebulaTaskVo) => {
    const id = String(task.taskId);
    setExpandedUsageTaskIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const usageTaskColumns: TableColumn<NebulaTaskVo>[] = [
    {
      key: 'task',
      title: t('billing.table.usage.task'),
      render: (task) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-slate-900">
            {task.graphNodeName || task.taskName || task.taskNo || t('taskList.task.unnamed')}
          </span>
          <span className="text-xs text-slate-400 font-mono mt-0.5">
            {task.taskId || (task as any).externalTaskId || '-'}
          </span>
        </div>
      ),
    },
    {
      key: 'compute',
      title: t('billing.table.usage.compute'),
      render: (task) => {
        const firstUsage = Array.isArray(task.usages) ? task.usages[0] : undefined;
        return (
          <span className="text-sm text-slate-600 font-medium">
            {firstUsage ? getComputeTypeFromUsage(firstUsage) : '-'}
          </span>
        );
      },
    },
    {
      key: 'start',
      title: t('billing.table.usage.startTime'),
      render: (task) => (
        <span className="text-sm text-slate-500">
          {String((task as any).startTimeStr ?? task.startTime ?? '-')}
        </span>
      ),
    },
    {
      key: 'duration',
      title: t('billing.table.usage.duration'),
      render: (task) => {
        const sec =
          typeof task.totalRuntimeSec === 'number'
            ? task.totalRuntimeSec
            : typeof task.durationSeconds === 'number'
              ? task.durationSeconds
              : undefined;
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700">
            {formatSecondsToMinSec(sec, t as any)}
          </span>
        );
      },
    },
    {
      key: 'cost',
      title: t('billing.table.usage.cost'),
      align: 'right',
      render: (task) => {
        const cost = (task as any).totalCost ?? (task as any).costAmount ?? undefined;
        return (
          <span className="text-sm font-bold text-slate-900">
            {formatCostFull(cost as any, task.costCurrency)}
          </span>
        );
      },
    },
  ];

  const renderUsageDetails = (task: NebulaTaskVo) => {
    const usages = Array.isArray(task.usages) ? task.usages : [];
    const rows: UsageDetailRow[] = usages.map((u, idx) => {
      const taskId = String(task.taskId ?? '');
      const taskName = String(task.graphNodeName ?? task.taskName ?? task.taskNo ?? '').trim();
      return {
        id: `${taskId}-${idx}`,
        taskId,
        taskName,
        computeType: getComputeTypeFromUsage(u),
        startedAt: formatDateTimeYmdHms(String(u?.started_at ?? u?.startedAt ?? '')),
        runtimeSec: typeof u?.runtime_sec === 'number' ? u.runtime_sec : Number(u?.runtime_sec),
        totalCost:
          typeof u?.total_cost === 'number'
            ? u.total_cost
            : u?.total_cost === undefined || u?.total_cost === null || u?.total_cost === ''
              ? undefined
              : Number(u?.total_cost),
        costCurrency: task.costCurrency,
        costPerHour:
          typeof u?.cost_per_hour === 'number'
            ? u.cost_per_hour
            : typeof u?.cost_per_hour === 'string'
              ? u.cost_per_hour
              : undefined,
      };
    });

    const columns: TableColumn<UsageDetailRow>[] = [
      {
        key: 'task',
        title: t('billing.table.usage.task'),
        render: (r) => {
          const hasName = Boolean(r.taskName && r.taskName.trim());
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-900">
                {hasName ? r.taskName : r.taskId || '-'}
              </span>
              {hasName ? (
                <span className="text-xs text-slate-400 font-mono mt-0.5">{r.taskId || '-'}</span>
              ) : null}
            </div>
          );
        },
      },
      { key: 'compute', title: t('billing.table.usage.compute'), render: (r) => r.computeType },
      {
        key: 'startedAt',
        title: t('billing.table.usage.startTime'),
        render: (r) => r.startedAt || '-',
      },
      {
        key: 'runtime',
        title: t('billing.table.usage.duration'),
        render: (r) => (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700">
            {formatSecondsToMinSec(r.runtimeSec, t as any)}
          </span>
        ),
      },
      {
        key: 'cost',
        title: t('billing.table.usage.cost'),
        align: 'right',
        render: (r) => (
          <span className="text-sm font-bold text-slate-900">
            {formatCostFull((r.totalCost as any) ?? 0, r.costCurrency)}
          </span>
        ),
      },
    ];

    const actions: TableAction<UsageDetailRow>[] = [
      {
        key: 'preview',
        label: t('billing.table.detail'),
        icon: <Icons.FileText className="w-4 h-4" />,
        type: 'secondary',
        onClick: (r) => {
          setUsageDetailModal({ show: true, record: r });
        },
        tooltip: t('billing.table.detailTooltip'),
      },
    ];

    return (
      <EnterpriseTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        actions={actions}
        loading={false}
        stickyHeader={false}
        height="auto"
        width="100%"
        empty={{
          title: t('billing.empty.noUsageTitle'),
          description: t('billing.empty.noUsageDesc'),
        }}
      />
    );
  };

  const getPayChannelLabel = (channel?: string) => {
    if (!channel) return t('billing.payChannel.unknown');
    const value = channel.toLowerCase();
    if (value === 'alipay') return t('billing.payChannel.alipay');
    if (value === 'stripe') return t('billing.payChannel.stripe');
    return channel;
  };

  const closeDetailModal = () => {
    setDetailModal({
      show: false,
      record: undefined,
    });
  };

  return (
    <div className="flex flex-col h-full max-h-full bg-slate-50 overflow-hidden min-w-0">
      <header className="px-4 sm:px-8 py-4 sm:py-6 bg-white border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sticky top-0 z-10 flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">{t('billing.title')}</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">{t('billing.subtitle')}</p>
        </div>
        <div className="flex space-x-3 flex-shrink-0">
          <button
            onClick={refreshData}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center"
          >
            <Icons.Clock className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">{t('billing.action.refreshList')}</span>
            <span className="sm:hidden">{t('billing.action.refresh')}</span>
          </button>
          <button
            onClick={() => setIsRechargeOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium shadow-sm flex items-center"
          >
            <Icons.Plus className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">{t('billing.action.rechargeNow')}</span>
            <span className="sm:hidden">{t('billing.action.recharge')}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-2 sm:p-4 mx-auto w-full space-y-6 sm:space-y-8 min-w-0">
          {/* Top Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Balance Card - Visual style */}
            <div className="md:col-span-2 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 text-white shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/4 group-hover:scale-110 transition-transform duration-700"></div>
              <div className="relative z-10 flex justify-between items-start h-full flex-col">
                <div className="w-full flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 bg-white/10 rounded-lg backdrop-blur-sm">
                      <Icons.Cpu className="w-5 h-5 text-brand-300" />
                    </div>
                    <span className="font-medium text-slate-300">{t('billing.balance.title')}</span>
                  </div>
                  <span className="flex items-center bg-green-500/20 text-green-300 text-xs px-2 py-1 rounded border border-green-500/30 font-medium">
                    <Icons.Zap className="w-3 h-3 mr-1" />
                    {t('billing.balance.billingMode')}
                  </span>
                </div>

                <div className="mt-6 mb-2">
                  <h2 className="text-4xl font-bold tracking-tight flex items-baseline">
                    ${(user && user.amount !== undefined ? user.amount : userBalance).toFixed(2)}
                    <span className="text-sm font-normal text-slate-400 ml-2">USD</span>
                  </h2>
                  <p className="text-slate-400 text-sm mt-2">
                    {t('billing.balance.available', {
                      hours: Math.floor(
                        (user && user.amount !== undefined ? user.amount : userBalance) / 0.45,
                      ),
                      gpu: 'RTX 4090',
                    })}
                  </p>
                </div>

                <div className="w-full mt-6 flex space-x-3">
                  <button
                    onClick={() => setIsRechargeOpen(true)}
                    className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-brand-500/20"
                  >
                    {t('billing.action.recharge')}
                  </button>
                </div>
              </div>
            </div>

            {/* Current Plan */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
                  {t('billing.plan.current')}
                </h3>
                <div className="flex items-baseline mb-2">
                  <span className="text-3xl font-bold text-slate-900">
                    {t('billing.plan.name.pro')}
                  </span>
                  <span className="text-slate-500 ml-2">{t('billing.plan.perMonth')}</span>
                </div>
                <ul className="space-y-3 mt-4">
                  <li className="flex items-center text-sm text-slate-600">
                    <Icons.CheckCircle className="w-4 h-4 text-brand-500 mr-2" />
                    {t('billing.plan.feature.priorityNodes')}
                  </li>
                  <li className="flex items-center text-sm text-slate-600">
                    <Icons.CheckCircle className="w-4 h-4 text-brand-500 mr-2" />
                    {t('billing.plan.feature.unlimitedWorkflows')}
                  </li>
                  <li className="flex items-center text-sm text-slate-600">
                    <Icons.CheckCircle className="w-4 h-4 text-brand-500 mr-2" />
                    {t('billing.plan.feature.apiAccess')}
                  </li>
                </ul>
              </div>
              <button className="w-full mt-4 py-2 border border-slate-200 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors text-sm">
                {t('billing.plan.change')}
              </button>
            </div>
          </div>

          {/* Tabs & Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Filters */}
            <div className="p-4 border-b border-slate-100 flex flex-wrap gap-4 bg-slate-50/50">
              <div className="flex-1 min-w-[300px]">
                <div className="relative">
                  <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t('billing.filter.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPagination({ ...pagination, pageNum: 1 });
                    }}
                    className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 border-l border-slate-200 pl-4 min-w-[180px]">
                <span className="text-xs font-medium text-slate-500 uppercase">
                  {t('billing.filter.statusLabel')}
                </span>
                <select
                  className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer"
                  value=""
                  onChange={() => {}}
                >
                  <option value="">{t('billing.filter.statusAll')}</option>
                  <option value="completed">{t('billing.filter.statusCompleted')}</option>
                  <option value="failed">{t('billing.filter.statusFailed')}</option>
                </select>
              </div>
            </div>

            <div className="border-b border-slate-100 flex">
              <button
                onClick={() => {
                  setActiveTab('usage');
                  setPagination({ pageNum: 1, pageSize: pagination.pageSize });
                  setSearchQuery('');
                }}
                className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === 'usage' ? 'border-brand-600 text-brand-600 bg-brand-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                <Icons.List className="w-4 h-4 mr-2" />
                {t('billing.tab.usage')}
              </button>
              <button
                onClick={() => {
                  setActiveTab('transactions');
                  setPagination({ pageNum: 1, pageSize: pagination.pageSize });
                  setSearchQuery('');
                }}
                className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === 'transactions' ? 'border-brand-600 text-brand-600 bg-brand-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                <Icons.FileText className="w-4 h-4 mr-2" />
                {t('billing.tab.transactions')}
              </button>
            </div>

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-center items-center h-32">
                <Icons.Zap className="w-6 h-6 animate-spin text-brand-600" />
                <span className="ml-2 text-slate-600">{t('billing.loading')}</span>
              </div>
            )}

            {/* Table Content */}
            {!loading && (
              <>
                {activeTab === 'usage' ? (
                  <div className="px-4 py-4">
                    <EnterpriseTable
                      columns={usageTaskColumns}
                      data={paginatedData as NebulaTaskVo[]}
                      rowKey={(record) => String(record.taskId)}
                      actions={[
                        {
                          key: 'expand',
                          label: t('taskList.action.expand'),
                          icon: <Icons.ChevronDown className="w-4 h-4" />,
                          type: 'secondary',
                          onClick: (record) => toggleUsageTaskExpand(record),
                          tooltip: (record) =>
                            expandedUsageTaskIds.includes(String(record.taskId))
                              ? t('taskList.action.collapseTasks')
                              : t('taskList.action.expandTasks'),
                        },
                      ]}
                      loading={loading}
                      expandedRowKeys={expandedUsageTaskIds}
                      expandedRowRender={(record) => renderUsageDetails(record)}
                      rowExpandable={(record) =>
                        Array.isArray(record.usages) && record.usages.length > 0
                      }
                      pagination={{
                        pageNum: pagination.pageNum,
                        pageSize: pagination.pageSize,
                        total: totalItems,
                        pageSizes: [5, 10, 20, 50],
                        onChange: (page) => setPagination((prev) => ({ ...prev, pageNum: page })),
                        onPageSizeChange: (size) => setPagination({ pageNum: 1, pageSize: size }),
                      }}
                      empty={{
                        title: t('billing.empty.noUsageTitle'),
                        description: t('billing.empty.noUsageDesc'),
                        icon: <Icons.Box className="w-12 h-12 text-slate-300" />,
                      }}
                      stickyHeader={false}
                      height="auto"
                      width="100%"
                    />
                  </div>
                ) : (
                  <div>
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <table className="min-w-full w-full table-fixed divide-y divide-slate-100">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="w-[20%] px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {t('billing.table.transactions.date')}
                            </th>
                            <th className="w-[20%] px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {t('billing.table.transactions.description')}
                            </th>
                            <th className="w-[20%] px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {t('billing.table.transactions.amount')}
                            </th>
                            <th className="w-[20%] px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {t('billing.table.transactions.status')}
                            </th>
                            {/* 操作列（退款）- 需要时取消注释恢复，并恢复下方 tbody 中对应的 td，且将 colSpan 改为 6、表头/列宽按 6 列调整 */}
                            {/* <th className="w-[20%] px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {t('billing.table.transactions.actions')}
                            </th> */}
                            <th className="w-[20%] px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {t('billing.table.transactions.invoice')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-100">
                          {paginatedData.length > 0 ? (
                            (paginatedData as UsageLog[]).map((log) => {
                              // 格式化日期
                              const formatDate = (dateStr: string) => {
                                try {
                                  const date = new Date(dateStr);
                                  const locale = language === 'en-US' ? 'en-US' : 'zh-CN';
                                  return date.toLocaleDateString(locale, {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                  });
                                } catch {
                                  return dateStr;
                                }
                              };

                              // 格式化金额 - 根据billType判断是收入还是支出
                              const amountValue = Math.abs(log.amountValue ?? 0);
                              // billType: 1=收入(充值)、2=支出(消费)
                              const isIncome = log.billType === '1' || log.billType === 1;
                              const formatted = amountValue.toFixed(4);
                              const formattedAmount = isIncome
                                ? `+$${formatted}`
                                : `-$${formatted}`;

                              // 格式化状态
                              const formatStatus = (status?: string) => {
                                if (!status) return t('billing.status.unknown');
                                if (status === 'SUCCESS') return t('billing.status.success');
                                if (status === 'COMPLETED') return t('billing.status.completed');
                                return status;
                              };

                              // 格式化描述
                              const formatDescription = (taskName: string, bizType?: string) => {
                                if (taskName === 'recharge' || bizType === 'recharge') {
                                  return t('billing.description.recharge');
                                }
                                return taskName || bizType || t('billing.description.transaction');
                              };

                              return (
                                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="w-[20%] px-6 py-4 text-sm text-slate-500">
                                    {formatDate(log.startTime)}
                                  </td>
                                  <td className="w-[20%] px-6 py-4 text-sm font-medium text-slate-800">
                                    {formatDescription(log.taskName, log.billNo)}
                                  </td>
                                  <td
                                    className={`w-[20%] px-6 py-4 text-sm font-medium ${
                                      isIncome ? 'text-green-600' : 'text-slate-900'
                                    }`}
                                  >
                                    {formattedAmount}
                                  </td>
                                  <td className="w-[20%] px-6 py-4">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                                      {formatStatus(log.payStatus)}
                                    </span>
                                  </td>
                                  <td className="w-[15%] px-6 py-4 whitespace-nowrap text-right">
                                    {log.payStatus === 'SUCCESS' && log.payChannel && (
                                      <button
                                        onClick={() => handleRefundClick(log)}
                                        disabled={!canRequestRefund(log)}
                                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100 hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        <Icons.CreditCard className="w-4 h-4 mr-1" />
                                        {t('billing.refund.button')}
                                      </button>
                                    )}
                                  </td>
                                  <td className="w-[20%] px-6 py-4 text-right">
                                    {log.invoiceUrl ? (
                                      <a
                                        href={log.invoiceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-brand-600 hover:text-brand-700 transition-colors"
                                        title={t('billing.invoice.download')}
                                      >
                                        <Icons.FileText className="w-4 h-4" />
                                      </a>
                                    ) : (
                                      <button
                                        className="text-slate-400 hover:text-brand-600 transition-colors"
                                        title={t('billing.invoice.unavailable')}
                                        disabled
                                      >
                                        <Icons.FileText className="w-4 h-4" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center">
                                <Icons.Box className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                <h3 className="text-sm font-medium text-slate-500 mb-1">
                                  {t('billing.empty.noTransactionsTitle')}
                                </h3>
                                <p className="text-slate-400 text-sm">
                                  {t('billing.empty.noTransactionsDesc')}
                                </p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    <Pagination
                      currentPage={pagination.pageNum}
                      totalPages={totalPages}
                      totalItems={totalItems}
                      startItem={startItem}
                      endItem={endItem}
                      onPageChange={(page) => setPagination({ ...pagination, pageNum: page })}
                      onPageSizeChange={(size) => setPagination({ pageNum: 1, pageSize: size })}
                      pageSize={pagination.pageSize}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {refundModal.show && refundModal.record && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-11/12 max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">{t('billing.refund.title')}</h3>
            <div className="space-y-4 text-sm text-slate-700">
              <p>
                {t('billing.refund.orderNo')}:
                <span className="font-mono text-slate-900 ml-2">
                  {refundModal.record.orderNo || refundModal.record.billNo || refundModal.record.id}
                </span>
              </p>
              <p>
                {t('billing.refund.payChannel')}:
                <span className="ml-2">{refundModal.record.payChannel}</span>
              </p>
              <p>
                {t('billing.refund.amount')}: $
                {Math.abs(refundModal.record.amountValue ?? 0).toFixed(2)}
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  {t('billing.refund.reason')}
                </label>
                <input
                  type="text"
                  className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-brand-500 focus:border-brand-500"
                  value={refundModal.reason}
                  onChange={(e) => setRefundModal((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder={t('billing.refund.reasonPlaceholder')}
                />
              </div>
              <p className="text-xs text-slate-400">
                {t('billing.refund.reviewNote') ||
                  'Your request will be reviewed by an administrator.'}
              </p>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={closeRefundModal}
                className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
              >
                {t('dialog.cancel')}
              </button>
              <button
                onClick={handleRefundSubmit}
                disabled={refundModal.submitting}
                className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60"
              >
                {refundModal.submitting
                  ? t('billing.refund.submitting')
                  : t('billing.refund.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailModal.show && detailModal.record && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-11/12 max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">{t('billing.detail.title')}</h3>
              <button
                onClick={closeDetailModal}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                    {t('billing.detail.task')}
                  </label>
                  <p className="text-sm font-medium text-slate-900">
                    {detailModal.record.taskName}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-1">{detailModal.record.id}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                    {t('billing.detail.compute')}
                  </label>
                  <p className="text-sm font-medium text-slate-900">
                    {detailModal.record.computeType}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                    {t('billing.detail.startTime')}
                  </label>
                  <p className="text-sm font-medium text-slate-900">
                    {detailModal.record.startTime}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                    {t('billing.detail.duration')}
                  </label>
                  <p className="text-sm font-medium text-slate-900">
                    {detailModal.record.duration}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                    {t('billing.detail.unitPrice')}
                  </label>
                  <p className="text-sm font-medium text-slate-900">{detailModal.record.rate}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                    {t('billing.detail.cost')}
                  </label>
                  <p className="text-sm font-bold text-slate-900">{detailModal.record.cost}</p>
                </div>
              </div>
              {(detailModal.record.orderNo ||
                detailModal.record.billNo ||
                detailModal.record.transactionId) && (
                <div className="border-t border-slate-200 pt-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">
                    {t('billing.detail.orderInfo')}
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    {detailModal.record.orderNo && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">
                          {t('billing.detail.orderNo')}
                        </label>
                        <p className="text-sm text-slate-900 font-mono">
                          {detailModal.record.orderNo}
                        </p>
                      </div>
                    )}
                    {detailModal.record.billNo && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">
                          {t('billing.detail.billNo')}
                        </label>
                        <p className="text-sm text-slate-900 font-mono">
                          {detailModal.record.billNo}
                        </p>
                      </div>
                    )}
                    {detailModal.record.transactionId && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">
                          {t('billing.detail.transactionId')}
                        </label>
                        <p className="text-sm text-slate-900 font-mono">
                          {detailModal.record.transactionId}
                        </p>
                      </div>
                    )}
                    {detailModal.record.payChannel && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">
                          {t('billing.detail.payChannel')}
                        </label>
                        <p className="text-sm text-slate-900">
                          {getPayChannelLabel(detailModal.record.payChannel)}
                        </p>
                      </div>
                    )}
                    {detailModal.record.payStatus && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">
                          {t('billing.detail.payStatus')}
                        </label>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            detailModal.record.payStatus === 'SUCCESS'
                              ? 'bg-green-50 text-green-700 border border-green-100'
                              : 'bg-slate-50 text-slate-700 border border-slate-100'
                          }`}
                        >
                          {detailModal.record.payStatus === 'SUCCESS'
                            ? t('billing.status.success')
                            : detailModal.record.payStatus}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={closeDetailModal}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t('billing.detail.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isRechargeOpen && (
        <RechargeModal
          onClose={() => setIsRechargeOpen(false)}
          onSuccess={() => {
            // 充值成功后刷新余额
            // 余额会自动从用户信息更新，无需单独获取
            refreshData();
          }}
        />
      )}

      {/* 算力消耗明细二级列表详情弹窗 */}
      {usageDetailModal.show && usageDetailModal.record && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setUsageDetailModal({ show: false, record: undefined })}
          role="presentation"
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {usageDetailModal.record.taskName || t('billing.table.detail')}
                </h3>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  {usageDetailModal.record.taskId}
                </p>
              </div>
              <button
                onClick={() => setUsageDetailModal({ show: false, record: undefined })}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">{t('billing.table.usage.task')}</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {usageDetailModal.record.taskName || usageDetailModal.record.taskId || '-'}
                  </div>
                  {usageDetailModal.record.taskName && (
                    <div className="text-[11px] text-slate-400 font-mono mt-1">
                      {usageDetailModal.record.taskId}
                    </div>
                  )}
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">{t('billing.table.usage.compute')}</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {usageDetailModal.record.computeType || '-'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">{t('billing.table.usage.startTime')}</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {usageDetailModal.record.startedAt || '-'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">{t('billing.table.usage.duration')}</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {formatSecondsToMinSec(usageDetailModal.record.runtimeSec, t as any)}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">{t('billing.table.usage.unitPrice')}</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {usageDetailModal.record.costPerHour != null
                      ? `${formatCostFull(usageDetailModal.record.costPerHour as any, usageDetailModal.record.costCurrency)}/h`
                      : '-'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">{t('billing.table.usage.cost')}</div>
                  <div className="text-sm font-bold text-slate-900">
                    {formatCostFull(
                      (usageDetailModal.record.totalCost as any) ?? 0,
                      usageDetailModal.record.costCurrency,
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

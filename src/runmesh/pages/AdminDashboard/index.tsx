import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import { Icons } from '@/runmesh/components/Icons';
import { gpuNodeApi, gpuVendorApi } from '@/runmesh/api';
import type { SysGpuNodeVo, SysGpuNodeNamespaceGroupVo } from '@/runmesh/api/gpuNode';
import type { SysGpuVendorVo } from '@/runmesh/api/gpuVendor';
import {
  getPlatformReconciliationDailyList,
  SysPlatformReconciliationBo,
  SysPlatformReconciliationVo,
} from '@/runmesh/api/finance';
import { getUserUsageTaskList } from '@/runmesh/api/taskApi';
import { useToast } from '@/runmesh/components/Toast';
import { isActiveNode } from '@/runmesh/utils';
import { useLanguage } from '@/runmesh/i18n';

/** 将日期格式化为 X 轴短标签（月/日），用于「最近7天」日维度 */
function formatChartDateLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 将某日所在周格式化为「几月第几周」，用于 7 周 / 3 月 的周维度 */
function formatWeekLabel(d: Date): string {
  const month = d.getMonth() + 1;
  const weekOfMonth = Math.ceil(d.getDate() / 7);
  return `${month}月第${weekOfMonth}周`;
}

/** 解析 yyyy-MM-dd 为本地 0 点，避免 UTC 导致跨月少一周（如缺 2月第1周） */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 格式化为 yyyy-MM-dd（按本地日期），便于与后端日期 key 一致 */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 根据起止日期生成时间范围内的日期列表（按真实日期倒推），最多 maxPoints 个点 */
function getDateRangeInPeriod(
  startStr: string,
  endStr: string,
  maxPoints: number,
): Array<{ dateKey: string; label: string }> {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const list: Array<{ dateKey: string; label: string }> = [];
  const cursor = new Date(end);
  let n = 0;
  while (cursor >= start && n < maxPoints) {
    const dateKey = cursor.toISOString().split('T')[0];
    list.unshift({ dateKey, label: formatChartDateLabel(cursor) });
    cursor.setDate(cursor.getDate() - 1);
    n++;
  }
  return list;
}

/** 根据起止日期生成「周」维度列表：每 7 天为一周，标签为「几月第几周」，最多 maxWeeks 个点；用本地日期避免 UTC 导致缺 2月第1周 */
function getWeekRangesInPeriod(
  startStr: string,
  endStr: string,
  maxWeeks: number,
): Array<{ weekStart: string; weekEnd: string; label: string }> {
  const start = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  const list: Array<{ weekStart: string; weekEnd: string; label: string }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let count = 0;
  while (cursor.getTime() <= end.getTime() && count < maxWeeks) {
    const weekStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    list.push({
      weekStart: toLocalDateKey(weekStart),
      weekEnd: toLocalDateKey(weekEnd),
      label: formatWeekLabel(weekStart),
    });
    cursor.setDate(cursor.getDate() + 7);
    count++;
  }
  return list;
}

/** 无数据时的默认图表（日维度）：按真实日期范围显示 0 */
function getDefaultRevenueDataForPeriod(
  startStr: string,
  endStr: string,
  maxPoints: number,
): Array<{ name: string; revenue: number; cost: number }> {
  return getDateRangeInPeriod(startStr, endStr, maxPoints).map(({ label }) => ({
    name: label,
    revenue: 0,
    cost: 0,
  }));
}

/** 无数据时的默认图表（周维度）：按「几月第几周」显示 0 */
function getDefaultRevenueDataForPeriodWeek(
  startStr: string,
  endStr: string,
  maxWeeks: number,
): Array<{ name: string; revenue: number; cost: number }> {
  return getWeekRangesInPeriod(startStr, endStr, maxWeeks).map(({ label }) => ({
    name: label,
    revenue: 0,
    cost: 0,
  }));
}

/** 从 list 接口的分组结构（namespace -> clusters -> nodes）中展平出所有节点 */
function flattenNodesFromGroupResponse(rows: SysGpuNodeNamespaceGroupVo[]): SysGpuNodeVo[] {
  const list: SysGpuNodeVo[] = [];
  if (!rows?.length) return list;
  for (const ns of rows) {
    const clusters = ns.clusters || [];
    for (const c of clusters) {
      const nodes = c.nodes || [];
      list.push(...nodes);
    }
  }
  return list;
}

export const AdminDashboard: React.FC = () => {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [_loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('week');

  // 统计数据
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [revenueGrowth, setRevenueGrowth] = useState(0);
  const [activeNodes, setActiveNodes] = useState(0);
  const [totalNodes, setTotalNodes] = useState(0);
  const [newNodesToday, setNewNodesToday] = useState(0);
  const [successRate, setSuccessRate] = useState(0);
  const [systemLoad, setSystemLoad] = useState(0);
  const [totalGpu, setTotalGpu] = useState(0);

  // 图表数据（初始为最近 7 天的真实日期占位，加载后由接口数据填充）
  const [revenueData, setRevenueData] = useState<
    Array<{ name: string; revenue: number; cost: number }>
  >(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return getDefaultRevenueDataForPeriod(
      start.toISOString().split('T')[0],
      end.toISOString().split('T')[0],
      7,
    );
  });
  const [supplierStats, setSupplierStats] = useState<
    Array<{ name: string; active: number; total: number; efficiency: number }>
  >([]);

  // 计算时间范围
  const calculatePeriod = (range: 'day' | 'week' | 'month') => {
    const end = new Date();
    const start = new Date();

    if (range === 'day') {
      start.setDate(start.getDate() - 7);
    } else if (range === 'week') {
      start.setDate(start.getDate() - 7 * 7);
    } else if (range === 'month') {
      start.setMonth(start.getMonth() - 3);
    }

    // 用本地日期 yyyy-MM-dd，与 getWeekRangesInPeriod 一致，避免 toISOString() 时区导致「近三月」少一周（如缺 2月第1周）
    return {
      start: toLocalDateKey(start),
      end: toLocalDateKey(end),
    };
  };

  // 获取节点数据
  const fetchNodeData = async () => {
    try {
      const result = await gpuNodeApi.getNodeList({ pageNum: 1, pageSize: 1000 });
      // list 接口返回的是按 namespace -> cluster 分组的 rows，需展平为节点数组再统计
      const nodes = flattenNodesFromGroupResponse(
        (result.rows || []) as SysGpuNodeNamespaceGroupVo[],
      );

      // 统计活跃节点（排除 STOPPING 和 STOPPED 状态，其他状态均算活跃）
      const active = nodes.filter((n) => isActiveNode(n.status)).length;
      const total = nodes.length;

      // 计算今日新增节点（简化处理，实际应该根据创建时间）
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newToday = nodes.filter((n) => {
        if (!n.createTime) return false;
        const createDate = new Date(n.createTime);
        createDate.setHours(0, 0, 0, 0);
        return createDate.getTime() === today.getTime();
      }).length;

      setActiveNodes(active);
      setTotalNodes(total);
      setNewNodesToday(newToday);
      setSystemLoad(total > 0 ? Math.round((active / total) * 100) : 0);

      const gpuTotal = nodes.reduce((sum, n) => sum + (n.gpuCount ?? 0), 0);
      setTotalGpu(gpuTotal);

      // 供应商列表用于回显：当节点未带 vendorType/vendorName 时做兜底（rows 为 namespace 分组，展平 guardians 与 clusters[].vendors）
      const vendorResult = await gpuVendorApi.getVendorList({ pageNum: 1, pageSize: 1000 });
      const namespaceRows = vendorResult.rows || [];
      const flatVendors = namespaceRows.flatMap(
        (ns: { guardians?: SysGpuVendorVo[]; clusters?: { vendors?: SysGpuVendorVo[] }[] }) => [
          ...(ns.guardians || []),
          ...(ns.clusters || []).flatMap((c) => c.vendors || []),
        ],
      );
      const vendorIdToType = new Map<string, string>();
      const vendorIdToName = new Map<string, string>();
      flatVendors.forEach((v) => {
        if (v.id != null) {
          const idStr = String(v.id);
          vendorIdToType.set(idStr, (v.vendorType ?? '')?.trim() || idStr);
          vendorIdToName.set(idStr, (v.vendorName ?? '')?.trim() || idStr);
        }
      });

      // 按 vendorType 分组：优先使用节点列表返回的 vendorType/vendorName，再兜底供应商列表
      const typeMap = new Map<string, { active: number; total: number }>();
      nodes.forEach((node) => {
        const fromNode = (node.vendorType ?? node.vendorName)?.trim();
        const vendorId = node.vendorId?.toString();
        const fromVendor = vendorId
          ? vendorIdToType.get(vendorId) || vendorIdToName.get(vendorId) || vendorId
          : '';
        const groupKey = fromNode || fromVendor || 'unknown';
        if (!typeMap.has(groupKey)) {
          typeMap.set(groupKey, { active: 0, total: 0 });
        }
        const stats = typeMap.get(groupKey)!;
        stats.total++;
        if (isActiveNode(node.status)) {
          stats.active++;
        }
      });

      // 回显到节点分配：使用与分组一致的显示名（列表返回的 vendorType 优先）
      const supplierData = Array.from(typeMap.entries()).map(([name, stats]) => {
        const efficiency = stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0;
        return {
          name,
          active: stats.active,
          total: stats.total,
          efficiency,
        };
      });
      setSupplierStats(supplierData);
    } catch (error: any) {
      console.error('Failed to fetch node data:', error);
    }
  };

  // 从任务列表计算成功率：按当前选择的时间范围（近七天/近七周/近三月）过滤任务，再统计成功率
  const fetchTaskData = async () => {
    try {
      const period = calculatePeriod(timeRange);
      const result = await getUserUsageTaskList({
        pageNum: 1,
        pageSize: 1000,
        startDate: period.start,
        endDate: period.end,
      });
      const rows = result?.rows || [];
      const completed = rows.filter(
        (t) => t.status === 'COMPLETED' || t.status === 'SUCCESS' || t.status === 'DONE',
      ).length;
      const failed = rows.filter(
        (t) =>
          t.status === 'FAILED' ||
          t.status === 'ERROR' ||
          t.status === 'CANCELLED' ||
          t.status === 'CANCELED',
      ).length;
      const total = completed + failed;
      if (total > 0) {
        setSuccessRate(Math.round((completed / total) * 1000) / 10);
      } else {
        setSuccessRate(0);
      }
    } catch (error: any) {
      console.error('Failed to fetch task data:', error);
      setSuccessRate(0);
    }
  };

  // 财务表现：7 天按日、7 周/3 月按周维度展示，X 轴 7 天为「月/日」，7 周/3 月为「几月第几周」
  const fetchFinanceData = async () => {
    const period = calculatePeriod(timeRange);
    const isDay = timeRange === 'day';
    const maxPoints = isDay ? 7 : 31;
    const maxWeeks = timeRange === 'week' ? 7 : 14; // 7 周取 7 点，3 月取约 14 周

    const applyFallback = () => {
      setTotalRevenue(0);
      setRevenueGrowth(0);
      if (isDay) {
        setRevenueData(getDefaultRevenueDataForPeriod(period.start, period.end, maxPoints));
      } else {
        setRevenueData(getDefaultRevenueDataForPeriodWeek(period.start, period.end, maxWeeks));
      }
    };

    try {
      const params: SysPlatformReconciliationBo = {
        timeRange: timeRange,
        periodType: timeRange,
        periodStart: period.start,
        periodEnd: period.end,
        from_date: period.start,
        to_date: period.end,
      };

      const result = await getPlatformReconciliationDailyList(params);
      const rawList = Array.isArray(result)
        ? result
        : (result as { data?: SysPlatformReconciliationVo[] })?.data;
      const data: SysPlatformReconciliationVo[] = Array.isArray(rawList) ? rawList : [];

      if (data.length > 0) {
        const total = data.reduce((sum, item) => sum + (Number(item.userIncome) || 0), 0);
        setTotalRevenue(total);

        if (data.length > 1) {
          const prevTotal = data
            .slice(1)
            .reduce((sum, item) => sum + (Number(item.userIncome) || 0), 0);
          const growth = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
          setRevenueGrowth(growth);
        } else {
          setRevenueGrowth(0);
        }

        const byDate = new Map<string, { revenue: number; cost: number }>();
        for (const item of data) {
          const raw = item.periodStart ?? '';
          const dateKey =
            typeof raw === 'string' ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10);
          byDate.set(dateKey, {
            revenue: Number(item.userIncome) || 0,
            cost: Number(item.supplierCost) || 0,
          });
        }

        let chartData: Array<{ name: string; revenue: number; cost: number }>;

        if (isDay) {
          const dateRange = getDateRangeInPeriod(period.start, period.end, maxPoints);
          chartData = dateRange.map(({ dateKey, label }) => {
            const row = byDate.get(dateKey);
            return { name: label, revenue: row?.revenue ?? 0, cost: row?.cost ?? 0 };
          });
        } else {
          // 7 周 / 3 月：按周聚合，X 轴「几月第几周」
          const weekRanges = getWeekRangesInPeriod(period.start, period.end, maxWeeks);
          chartData = weekRanges.map(({ weekStart, weekEnd, label }) => {
            let revenue = 0;
            let cost = 0;
            const d = new Date(weekStart);
            const endTs = new Date(weekEnd).getTime();
            while (d.getTime() <= endTs) {
              const dateKey = d.toISOString().split('T')[0];
              const row = byDate.get(dateKey);
              if (row) {
                revenue += row.revenue;
                cost += row.cost;
              }
              d.setDate(d.getDate() + 1);
            }
            return { name: label, revenue, cost };
          });
        }
        setRevenueData(chartData);
      } else {
        applyFallback();
      }
    } catch (error: any) {
      console.error('Failed to fetch finance data:', error);
      showToast({ type: 'error', message: t('adminDashboard.error.financeFetchFailed') });
      applyFallback();
    }
  };

  // 加载所有数据
  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchNodeData(), fetchFinanceData(), fetchTaskData()]);
    } catch (error: any) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, t]);
  return (
    <div className="flex flex-col h-full max-h-full bg-slate-50 overflow-auto min-w-0">
      {/* Page Header */}
      <header className="px-4 sm:px-8 py-4 sm:py-6 bg-white border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sticky top-0 z-10 flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
            {t('adminDashboard.title')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">{t('adminDashboard.subtitle')}</p>
        </div>
        <div className="flex items-center space-x-3 flex-shrink-0">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as 'day' | 'week' | 'month')}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="day">{t('adminDashboard.range.day')}</option>
            <option value="week">{t('adminDashboard.range.week')}</option>
            <option value="month">{t('adminDashboard.range.month')}</option>
          </select>
          <button className="p-2 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg bg-white">
            <Icons.Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col p-2 sm:p-4 mx-auto w-full gap-6 sm:gap-8 min-w-0 min-h-0">
        {/* Top Level Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 flex-shrink-0">
          {/* Metric Card 1 */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[10rem] sm:min-h-[11rem]">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminDashboard.metric.totalRevenue')}
                </p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {!totalRevenue || totalRevenue === 0
                    ? '$0'
                    : `$${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </h3>
              </div>
              <div className="p-2 bg-green-50 rounded-lg text-green-600">
                <Icons.DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center text-xs">
              {revenueGrowth !== 0 && (
                <>
                  <span
                    className={`font-medium flex items-center ${revenueGrowth > 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    <Icons.Activity className="w-3 h-3 mr-1" />
                    {revenueGrowth > 0 ? '+' : ''}
                    {revenueGrowth.toFixed(1)}%
                  </span>
                  <span className="text-slate-400 ml-2">
                    {t('adminDashboard.metric.changeVsPrevious')}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Metric Card 2 - 活跃节点（当前状态，不随时间范围变化） */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[10rem] sm:min-h-[11rem]">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminDashboard.metric.activeNodes')}
                </p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {activeNodes}{' '}
                  <span className="text-lg text-slate-400 font-normal">/ {totalNodes}</span>
                </h3>
              </div>
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <Icons.Server className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center text-xs">
              {newNodesToday > 0 ? (
                <>
                  <span className="text-blue-600 font-medium">
                    {t('adminDashboard.metric.newNodes', { count: newNodesToday })}
                  </span>
                  <span className="text-slate-400 ml-2">
                    {t('adminDashboard.metric.newNodesLabel')}
                  </span>
                </>
              ) : (
                <span className="text-slate-400">{t('adminDashboard.metric.currentSnapshot')}</span>
              )}
            </div>
          </div>

          {/* Metric Card 3 */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[10rem] sm:min-h-[11rem]">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminDashboard.metric.successRate')}
                </p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{successRate}%</h3>
              </div>
              <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
                <Icons.CheckCircle className="w-4 h-4" />
              </div>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2">
              <div
                className="bg-purple-500 h-1.5 rounded-full"
                style={{ width: `${Math.min(100, successRate)}%` }}
              />
            </div>
          </div>

          {/* Metric Card 4 - 系统负载（当前状态，不随时间范围变化） */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[10rem] sm:min-h-[11rem]">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminDashboard.metric.systemLoad')}
                </p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{systemLoad}%</h3>
              </div>
              <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
                <Icons.Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center text-xs">
              {systemLoad >= 70 ? (
                <>
                  <span className="text-orange-600 font-medium">
                    {t('adminDashboard.metric.highLoad')}
                  </span>
                  <span className="text-slate-400 ml-2">
                    {t('adminDashboard.metric.scalingSoon')}
                  </span>
                </>
              ) : (
                <span className="text-slate-500">{systemLoad}%</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 flex-1 min-h-0">
          {/* Revenue Chart */}
          <div className="lg:col-span-2 bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm min-w-0 flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-4 sm:mb-6 flex-shrink-0">
              <h3 className="font-bold text-slate-800">{t('adminDashboard.finance.title')}</h3>
              <div className="flex items-center space-x-4 text-sm">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-brand-500 rounded-full mr-2"></div>{' '}
                  {t('adminDashboard.finance.revenue')}
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-red-400 rounded-full mr-2"></div>{' '}
                  {t('adminDashboard.finance.cost')}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-[18rem] sm:min-h-[22rem] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    dy={10}
                    interval={0}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                    cursor={{ stroke: '#cbd5e1' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#0ea5e9"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="#f87171"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 节点分配（当前状态，不随时间范围变化） */}
          <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col min-w-0 min-h-[18rem] sm:min-h-[22rem]">
            <h3 className="font-bold text-slate-800 mb-4 sm:mb-6 flex-shrink-0">
              {t('adminDashboard.nodes.distribution')}{' '}
              <span className="text-slate-400 font-normal text-sm">
                ({t('adminDashboard.nodes.currentSnapshot')})
              </span>
            </h3>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={supplierStats} layout="vertical" barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={80}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#475569', fontSize: 13, fontWeight: 500 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Bar
                    dataKey="active"
                    name={t('adminDashboard.nodes.active')}
                    stackId="a"
                    fill="#0ea5e9"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="total"
                    name={t('adminDashboard.nodes.idle')}
                    stackId="b"
                    fill="#e2e8f0"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">{t('adminDashboard.nodes.capacity')}</span>
                <span className="font-semibold text-slate-900">{totalGpu} GPU</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

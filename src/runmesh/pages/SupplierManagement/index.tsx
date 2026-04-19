import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import { EnterpriseModal } from '@/runmesh/components/EnterpriseTable/Modal';
import { useToast } from '@/runmesh/components/Toast';
import NodeList from '@/runmesh/components/Admin/Supplier/NodeList';
import * as gpuVendorApi from '@/runmesh/api/gpuVendor';
import type {
  PageQuery,
  SysGpuVendorBo,
  SysGpuVendorVo,
  SysGpuVendorNamespaceGroupVo,
} from '@/runmesh/api/gpuVendor';
import { useLanguage } from '@/runmesh/i18n';

/** 与后端 GpuNodeAPITypeEnum 一致，用于供应商列表状态展示 */
const GPU_NODE_API_STATUS_KEYS: Record<string, string> = {
  STARTING: 'adminSupplier.status.starting',
  BUSY: 'adminSupplier.status.busy',
  STOPPING: 'adminSupplier.status.stopping',
  STOPPED: 'adminSupplier.status.stopped',
  IDLE: 'adminSupplier.status.idle',
};

export const SupplierManagement: React.FC = () => {
  const location = useLocation();
  const { showToast, toastContainer } = useToast();
  const { t } = useLanguage();
  const [namespaceGroups, setNamespaceGroups] = useState<SysGpuVendorNamespaceGroupVo[]>([]);
  // 存储完整的未分页数据，用于客户端分页
  const [allNamespaceGroupsCache, setAllNamespaceGroupsCache] = useState<
    SysGpuVendorNamespaceGroupVo[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedNamespaceKeys, setExpandedNamespaceKeys] = useState<string[]>([]);
  const [pagination, setPagination] = useState<PageQuery>({
    pageNum: 1,
    pageSize: 10,
    clusterPageNum: 1,
    clusterPageSize: 10,
    vendorPageNum: 1,
    vendorPageSize: 10,
  });

  // 存储每个namespace的guardian分页信息
  const [guardianPaginationMap, setGuardianPaginationMap] = useState<
    Map<string, { pageNum: number; pageSize: number; total: number }>
  >(new Map());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [_viewOnly, setViewOnly] = useState(false);
  const [editingVendor, setEditingVendor] = useState<SysGpuVendorVo | null>(null);
  const [formData, setFormData] = useState<SysGpuVendorBo>({
    vendorName: '',
    vendorType: 'vast.ai',
    shortName: '',
    brand: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    address: '',
    website: '',
    supportLevel: '',
    status: '0',
    remark: '',
    apiKey: '',
  });

  // 从缓存数据应用客户端分页
  const applyClientPagination = (
    cache: SysGpuVendorNamespaceGroupVo[],
    guardianMap: Map<string, { pageNum: number; pageSize: number; total: number }>,
  ) => {
    const newGuardianPaginationMap = new Map(guardianMap);
    const pagedNamespaceGroups: SysGpuVendorNamespaceGroupVo[] = [];

    cache.forEach((ns) => {
      const namespaceKey = ns.namespace || '';
      const allGuardians = ns.guardians || [];
      const guardianTotal = ns.guardianTotal || allGuardians.length;

      // 获取或初始化该namespace的guardian分页信息
      let guardianPagination = newGuardianPaginationMap.get(namespaceKey);
      if (!guardianPagination) {
        guardianPagination = {
          pageNum: 1,
          pageSize: pagination.vendorPageSize || 10,
          total: guardianTotal,
        };
        newGuardianPaginationMap.set(namespaceKey, guardianPagination);
      } else {
        // 更新总数（创建新对象以保持不可变性）
        newGuardianPaginationMap.set(namespaceKey, {
          ...guardianPagination,
          total: guardianTotal,
        });
        guardianPagination = newGuardianPaginationMap.get(namespaceKey)!;
      }

      // 对guardian进行客户端分页
      const guardianPageSize = guardianPagination.pageSize;
      const guardianPageNum = guardianPagination.pageNum;
      const guardianStartIndex = (guardianPageNum - 1) * guardianPageSize;
      const guardianEndIndex = Math.min(guardianStartIndex + guardianPageSize, allGuardians.length);
      const pagedGuardians = allGuardians.slice(guardianStartIndex, guardianEndIndex);

      // 创建分页后的namespace group
      pagedNamespaceGroups.push({
        ...ns,
        guardians: pagedGuardians,
        guardianTotal: guardianTotal, // 保留总数用于分页显示
      });
    });

    // 更新分页Map状态
    setGuardianPaginationMap(newGuardianPaginationMap);
    setNamespaceGroups(pagedNamespaceGroups);

    // 计算所有供应商数量用于统计（使用完整数据）
    const allVendors = cache.flatMap((ns) => ns.guardians || []);
    setAllVendorsCount(allVendors.length);
    setActiveVendorsCount(
      allVendors.filter((v) => v.status !== '1' && v.status !== 'STOPPED').length,
    );
  };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      // 请求数据时，传递一个很大的pageSize给二级分页，以获取所有数据
      const params: PageQuery & { vendorName?: string; status?: string } = {
        pageNum: pagination.pageNum,
        pageSize: pagination.pageSize,
        vendorName: searchQuery || undefined,
        status: statusFilter || undefined,
        vendorPageNum: 1,
        vendorPageSize: 10000, // 设置一个很大的值以获取所有guardian
      };
      const result = await gpuVendorApi.getVendorList(params);
      const allNamespaceGroups = result.rows || [];
      setTotal(result.total || 0);

      // 保存完整数据到缓存
      setAllNamespaceGroupsCache(allNamespaceGroups);

      // 初始化或保留现有的分页信息
      const newGuardianPaginationMap = new Map(guardianPaginationMap);

      allNamespaceGroups.forEach((ns) => {
        const namespaceKey = ns.namespace || '';
        const guardianTotal = ns.guardianTotal || ns.guardians?.length || 0;

        const existingGuardianPagination = newGuardianPaginationMap.get(namespaceKey);
        if (existingGuardianPagination) {
          newGuardianPaginationMap.set(namespaceKey, {
            ...existingGuardianPagination,
            total: guardianTotal,
          });
        } else {
          newGuardianPaginationMap.set(namespaceKey, {
            pageNum: 1,
            pageSize: pagination.vendorPageSize || 10,
            total: guardianTotal,
          });
        }
      });

      // 应用客户端分页
      applyClientPagination(allNamespaceGroups, newGuardianPaginationMap);
    } catch (error: any) {
      console.error('Failed to fetch vendor list:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminSupplier.toast.fetchFailed'),
      });
      setNamespaceGroups([]);
      setAllNamespaceGroupsCache([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      await fetchVendors();
      showToast({ type: 'success', message: t('adminSupplier.toast.refreshSuccess') });
    } catch (error: any) {
      console.error('Failed to refresh vendor list:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminSupplier.toast.refreshFailed'),
      });
    }
  };

  // 列表只在这一处拉取：初次加载、分页/筛选/搜索变更、或 URL 带 t 时各触发一次
  useEffect(() => {
    fetchVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.pageNum, pagination.pageSize, searchQuery, statusFilter, location.search]);

  const handleView = async (vendor: SysGpuVendorVo) => {
    if (!vendor) {
      showToast({ type: 'warning', message: t('adminSupplier.toast.noVendorId') });
      return;
    }
    const id = vendor.id;
    if (id !== 0 && id !== '0' && (id === undefined || id === null || id === '')) {
      showToast({ type: 'warning', message: t('adminSupplier.toast.noVendorId') });
      return;
    }
    try {
      const fullVendor = await gpuVendorApi.getVendorById(vendor.id!);
      if (fullVendor == null || fullVendor === undefined) {
        showToast({
          type: 'error',
          message: t('adminSupplier.toast.vendorNotFound'),
        });
        return;
      }
      setEditingVendor(fullVendor);
      const resolvedVendorType =
        fullVendor.vendorType?.trim() ||
        (fullVendor.namespace?.toLowerCase().includes('vastai') ? 'vast.ai' : null) ||
        (fullVendor.namespace?.toLowerCase().includes('luyao') ? 'autoDL' : null) ||
        (fullVendor.vendorName?.toLowerCase().includes('vastai') ? 'vast.ai' : null) ||
        (fullVendor.vendorName?.toLowerCase().includes('luyao') ? 'autoDL' : null) ||
        'personal';
      setFormData({
        id: fullVendor.id,
        vendorName: fullVendor.vendorName,
        vendorType: resolvedVendorType,
        shortName: fullVendor.shortName || '',
        brand: fullVendor.brand || '',
        contactPerson: fullVendor.contactPerson || '',
        contactPhone: fullVendor.contactPhone || '',
        contactEmail: fullVendor.contactEmail || '',
        address: fullVendor.address || '',
        website: fullVendor.website || '',
        supportLevel: fullVendor.supportLevel || '',
        status: fullVendor.status,
        remark: fullVendor.remark || '',
        apiKey: fullVendor.apiKey || '',
      });
      setViewOnly(true);
      setIsModalOpen(true);
    } catch (error: any) {
      console.error('Failed to fetch vendor detail:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminSupplier.toast.fetchDetailFailed'),
      });
    }
  };

  // 用于统计的供应商数据
  const [_allVendorsCount, setAllVendorsCount] = useState(0);
  const [_activeVendorsCount, setActiveVendorsCount] = useState(0);

  // 切换命名空间展开/收起
  const toggleNamespaceExpand = (namespace: string) => {
    setExpandedNamespaceKeys((prev) =>
      prev.includes(namespace) ? prev.filter((x) => x !== namespace) : [...prev, namespace],
    );
  };

  // 处理二级列表（guardian）分页 - 为每个namespace独立管理
  const handleGuardianPageChange = (namespace: string, page: number) => {
    setGuardianPaginationMap((prevMap) => {
      const newMap = new Map(prevMap);
      const currentPagination = newMap.get(namespace) || {
        pageNum: 1,
        pageSize: pagination.vendorPageSize || 10,
        total: 0,
      };
      newMap.set(namespace, {
        ...currentPagination,
        pageNum: page,
      });
      // 立即应用客户端分页
      applyClientPagination(allNamespaceGroupsCache, newMap);
      return newMap;
    });
  };

  /** 按 GpuNodeAPITypeEnum 显示状态：STARTING→开始, BUSY→忙碌, STOPPING→停车, STOPPED→停止, IDLE→空闲；0/1 仍显示启用/停用 */
  const getStatusLabel = (status: string | null | undefined) => {
    if (status == null || status === '') return '-';
    const i18nKey = GPU_NODE_API_STATUS_KEYS[status];
    if (i18nKey) return (t as (key: string) => string)(i18nKey);
    if (status === '0') return t('adminSupplier.status.enabled');
    if (status === '1') return t('adminSupplier.status.disabled');
    return status;
  };
  const isStatusDisabled = (status: string | null | undefined) =>
    status === '1' || status === 'STOPPED';

  // 守护进程表格列定义（用于二级列表）- 按比例铺满整行，消除右侧大片空白
  const guardianColumns: TableColumn<SysGpuVendorVo>[] = [
    {
      key: 'vendorName',
      title: t('adminSupplier.table.name'),
      width: '38%',
      render: (vendor) => {
        // 显示格式：alias (apiGuardianId)，下方小字 cluster；括号内优先回显 apiGuardianId，与 API 一致
        const alias =
          vendor.guardianAlias ||
          vendor.shortName ||
          vendor.vendorName ||
          (vendor.id != null ? String(vendor.id) : '') ||
          '-';
        const bracketId = vendor.apiGuardianId ?? (vendor.id != null ? String(vendor.id) : '');
        const cluster = vendor.cluster || '';

        return (
          <div className="flex items-center min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold mr-2.5 border border-blue-200">
              {alias.charAt(0)?.toUpperCase() || 'G'}
            </div>
            <div className="flex flex-col min-w-0">
              <div
                className="text-sm font-medium text-slate-900 truncate"
                title={`${alias}${bracketId ? ` (${bracketId})` : ''}`}
              >
                {alias}
                {bracketId && <span className="text-slate-500 font-normal"> ({bracketId})</span>}
              </div>
              {cluster ? (
                <div className="text-xs text-slate-500 mt-0.5 truncate" title={cluster}>
                  {cluster}
                </div>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: 'startedAt',
      title: t('adminSupplier.table.startedAt'),
      width: '22%',
      align: 'center',
      render: (vendor) => {
        const v = vendor.startedAt;
        if (!v) return <span className="text-sm text-slate-400">-</span>;
        try {
          const d = typeof v === 'string' ? new Date(v) : v;
          return (
            <span className="text-sm text-slate-600 whitespace-nowrap">
              {d.toLocaleString('zh-CN')}
            </span>
          );
        } catch {
          return <span className="text-sm text-slate-600">{String(v)}</span>;
        }
      },
    },
    {
      key: 'tags',
      title: t('adminSupplier.table.tags'),
      width: '15%',
      align: 'center',
      render: (vendor) => {
        if (!vendor.tags) return <span className="text-sm text-slate-400">-</span>;
        return (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600 max-w-full truncate"
            title={String(vendor.tags)}
          >
            {vendor.tags}
          </span>
        );
      },
    },
    {
      key: 'status',
      title: t('adminSupplier.table.status'),
      width: '10%',
      align: 'center',
      render: (vendor) => (
        <span className="inline-flex items-center justify-center">
          <span
            className={`w-2 h-2 rounded-full mr-1.5 shrink-0 ${
              isStatusDisabled(vendor.status) ? 'bg-slate-400' : 'bg-green-500'
            }`}
          />
          <span className="text-sm text-slate-600">{getStatusLabel(vendor.status)}</span>
        </span>
      ),
    },
  ];

  const safeVendorId = (record: SysGpuVendorVo | null | undefined): string | number | null => {
    if (record == null) return null;
    const id = record.id;
    if (id === undefined || id === null || id === '') return null;
    return id;
  };

  const rowActions: TableAction<SysGpuVendorVo>[] = [
    {
      key: 'view',
      label: t('adminSupplier.action.view'),
      icon: <Icons.Eye className="w-4 h-4" />,
      onClick: (record) => {
        if (!record || safeVendorId(record) == null) {
          showToast({ type: 'warning', message: t('adminSupplier.toast.noVendorId') });
          return;
        }
        handleView(record);
      },
      type: 'secondary',
      tooltip: t('adminSupplier.action.view'),
    },
  ];

  // 渲染命名空间下的守护进程列表（二级列表）
  const renderNamespaceGuardians = (namespaceGroup: SysGpuVendorNamespaceGroupVo) => {
    const namespaceKey = namespaceGroup.namespace || '';
    // 使用 guardianTotal 作为总数，如果没有则使用 guardians 长度（兼容处理）
    const actualTotal = namespaceGroup.guardianTotal ?? (namespaceGroup.guardians?.length || 0);
    const guardianPagination = guardianPaginationMap.get(namespaceKey) || {
      pageNum: pagination.vendorPageNum || 1,
      pageSize: pagination.vendorPageSize || 10,
      total: actualTotal,
    };
    const guardians = namespaceGroup.guardians || [];
    // 直接使用 actualTotal 或分页对象中的 total（优先使用 actualTotal）
    const totalGuardians = actualTotal || guardianPagination.total;
    const currentPage = guardianPagination.pageNum;
    const pageSize = guardianPagination.pageSize;
    const totalPages = Math.ceil(totalGuardians / pageSize);

    return (
      <div className="ml-4 mt-2 mb-4">
        <EnterpriseTable
          columns={guardianColumns}
          data={guardians.filter((g): g is SysGpuVendorVo => g != null && g !== undefined)}
          rowKey={(guardian, index) =>
            guardian?.id != null ? String(guardian.id) : `vendor-${index}`
          }
          loading={false}
          actions={rowActions}
          stickyHeader={false}
          height="auto"
          width="100%"
          empty={{
            title: t('adminSupplier.empty.noVendors'),
            description: t('adminSupplier.empty.noVendorsDesc'),
          }}
        />
        {totalGuardians > pageSize && (
          <div className="mt-2 flex items-center justify-between px-2 py-2 text-xs text-slate-600 bg-white border-t border-slate-200">
            <span>
              {t('table.pagination.summary', {
                start: (currentPage - 1) * pageSize + 1,
                end: Math.min(currentPage * pageSize, totalGuardians),
                total: totalGuardians,
              })}
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                title={t('table.pagination.prev')}
                onClick={() => handleGuardianPageChange(namespaceKey, Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                className="px-2 py-1 border border-slate-300 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                &lt;
              </button>
              <span className="px-2 text-xs">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                title={t('table.pagination.next')}
                onClick={() =>
                  handleGuardianPageChange(namespaceKey, Math.min(totalPages, currentPage + 1))
                }
                disabled={currentPage >= totalPages}
                className="px-2 py-1 border border-slate-300 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                &gt;
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 将三级列表结构渲染为自定义内容
  const renderVendorTreeContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
        </div>
      );
    }

    if (namespaceGroups.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Icons.Box className="w-12 h-12 text-slate-300 mb-4" />
          <p className="text-sm font-medium text-slate-900">{t('adminSupplier.empty.title')}</p>
          <p className="text-xs text-slate-500 mt-1">{t('adminSupplier.empty.description')}</p>
        </div>
      );
    }

    return (
      <div className="divide-y divide-slate-200">
        {namespaceGroups.map((namespaceGroup, nsIndex) => {
          const isNamespaceExpanded = expandedNamespaceKeys.includes(namespaceGroup.namespace);
          const guardianTotal = namespaceGroup.guardianTotal || 0;
          const enabledCount = namespaceGroup.enabledGuardianCount || 0;
          const disabledCount = namespaceGroup.disabledGuardianCount || 0;

          return (
            <div key={nsIndex} className="bg-white">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => toggleNamespaceExpand(namespaceGroup.namespace)}
              >
                <div className="flex items-center space-x-3 flex-1">
                  <Icons.ChevronRight
                    className={`w-5 h-5 text-slate-500 transition-transform ${
                      isNamespaceExpanded ? 'rotate-90' : ''
                    }`}
                  />
                  <div className="flex flex-col flex-1">
                    <div className="flex items-center space-x-3">
                      <span className="text-base font-bold text-slate-900">
                        {namespaceGroup.namespace || t('adminSupplier.namespace.uncategorized')}
                      </span>
                      <span className="text-xs text-slate-500">
                        ({t('adminSupplier.namespace.guardianCount', { count: guardianTotal })})
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-xs text-slate-600">
                        {t('adminSupplier.namespace.enabledLabel')}{' '}
                        <span className="text-green-600 font-medium">{enabledCount}</span>
                      </span>
                      <span className="text-xs text-slate-600">
                        {t('adminSupplier.namespace.disabledLabel')}{' '}
                        <span className="text-slate-400 font-medium">{disabledCount}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {isNamespaceExpanded && renderNamespaceGuardians(namespaceGroup)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {toastContainer()}
      <div className="flex flex-col h-full max-h-full bg-slate-50 overflow-hidden relative">
        <div className="h-full max-h-full p-2 sm:p-4 border border-slate-200 shadow-sm overflow-hidden min-w-0 flex-1 min-h-0">
          <EnterpriseTable
            title={t('adminSupplier.title')}
            description={t('adminSupplier.subtitle')}
            columns={[]}
            data={[]}
            rowKey={() => ''}
            loading={false}
            toolbarActions={[
              {
                key: 'refresh',
                label: t('adminSupplier.action.refresh'),
                icon: <Icons.RefreshCw className="w-4 h-4" />,
                onClick: handleRefresh,
                type: 'secondary',
              },
            ]}
            search={{
              value: searchQuery,
              onChange: (value) => {
                setSearchQuery(value);
                setPagination({ ...pagination, pageNum: 1 });
              },
              placeholder: t('adminSupplier.search.placeholder'),
            }}
            filters={
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center w-full sm:w-auto">
                <select
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 flex-1 sm:flex-none min-w-[120px]"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPagination({ ...pagination, pageNum: 1 });
                  }}
                >
                  <option value="">{t('adminSupplier.filter.statusAll')}</option>
                  <option value="0">{t('adminSupplier.status.enabled')}</option>
                  <option value="1">{t('adminSupplier.status.disabled')}</option>
                </select>
              </div>
            }
            pagination={{
              pageNum: pagination.pageNum ?? 1,
              pageSize: pagination.pageSize ?? 10,
              total,
              pageSizes: [5, 10, 20, 50],
              onChange: (page) => setPagination((prev) => ({ ...prev, pageNum: page })),
              onPageSizeChange: (size) =>
                setPagination((prev) => ({ ...prev, pageNum: 1, pageSize: size })),
              compact: false,
            }}
            empty={{
              title: t('adminSupplier.empty.title'),
              description: t('adminSupplier.empty.description'),
            }}
            contentClassName="!p-0"
            height="100%"
            width="100%"
            stickyHeader={false}
            extraContent={
              <div className="flex-1 min-h-0 overflow-auto bg-white">
                {renderVendorTreeContent()}
              </div>
            }
          />
        </div>

        <EnterpriseModal
          open={isModalOpen}
          title={t('adminSupplier.modal.viewTitle')}
          onClose={() => {
            setIsModalOpen(false);
            setViewOnly(false);
          }}
          footer={null}
          width="60vw"
          height="80vh"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.vendorName}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.namePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.type')} <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.vendorType || 'personal'}
                  disabled
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-slate-50 cursor-default appearance-none pr-7"
                >
                  <option value="personal">{t('adminSupplier.type.personal')}</option>
                  <option value="autoDL">{t('adminSupplier.type.autoDL')}</option>
                  <option value="vast.ai">{t('adminSupplier.type.vastAI')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.shortName')}
                </label>
                <input
                  type="text"
                  value={formData.shortName}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.shortNamePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.brand')}
                </label>
                <input
                  type="text"
                  value={formData.brand}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.brandPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.contactPerson')}
                </label>
                <input
                  type="text"
                  value={formData.contactPerson}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.contactPersonPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.contactPhone')}
                </label>
                <input
                  type="tel"
                  value={formData.contactPhone}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.contactPhonePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.contactEmail')}
                </label>
                <input
                  type="email"
                  value={formData.contactEmail}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.contactEmailPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.address')}
                </label>
                <input
                  type="text"
                  value={formData.address}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.addressPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.website')}
                </label>
                <input
                  type="url"
                  value={formData.website}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.websitePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.supportLevel')}
                </label>
                <input
                  type="text"
                  value={formData.supportLevel}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.supportLevelPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.status')}
                </label>
                <select
                  value={formData.status}
                  disabled
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                >
                  <option value="0">{t('adminSupplier.status.enabled')}</option>
                  <option value="1">{t('adminSupplier.status.disabled')}</option>
                </select>
              </div>

              {editingVendor && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('adminSupplier.form.namespace')}
                    </label>
                    <input
                      type="text"
                      value={editingVendor.namespace || '-'}
                      readOnly
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-100 text-sm text-slate-600 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('adminSupplier.form.cluster')}
                    </label>
                    <input
                      type="text"
                      value={editingVendor.cluster || '-'}
                      readOnly
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-100 text-sm text-slate-600 cursor-not-allowed"
                    />
                  </div>
                </>
              )}

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplier.form.apiKey')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.apiKey ? '••••••••' : ''}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminSupplier.form.apiKeyPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">{t('adminSupplier.form.apiKeyHint')}</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('adminSupplier.form.remark')}
              </label>
              <textarea
                value={formData.remark}
                readOnly
                rows={4}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                placeholder={t('adminSupplier.form.remarkPlaceholder')}
              />
            </div>

            {editingVendor && (
              <NodeList vendorId={editingVendor.id} vendorName={editingVendor.vendorName} />
            )}

            {!editingVendor && (
              <div className="mt-6 p-4 border border-slate-200 rounded-lg bg-slate-50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold flex items-center">
                    <Icons.Server className="w-5 h-5 mr-2 text-brand-600" />
                    {t('adminSupplier.nodeInfo.title')}
                  </h3>
                  <p className="text-sm text-slate-500">{t('adminSupplier.nodeInfo.subtitle')}</p>
                </div>
                <div className="text-sm text-slate-600">
                  <p>{t('adminSupplier.nodeInfo.tip1')}</p>
                  <p>{t('adminSupplier.nodeInfo.tip2')}</p>
                </div>
              </div>
            )}
          </div>
        </EnterpriseModal>
      </div>
    </>
  );
};

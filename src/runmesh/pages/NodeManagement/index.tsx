import React, { useState, useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useToast } from '@/runmesh/components/Toast';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import { EnterpriseModal } from '@/runmesh/components/EnterpriseTable/Modal';
import { gpuNodeApi, gpuVendorApi } from '@/runmesh/api';
import type {
  SysGpuNodeVo,
  SysGpuNodeBo,
  PageQuery,
  SysGpuNodeNamespaceGroupVo,
  SysGpuNodeClusterGroupVo,
} from '@/runmesh/api/gpuNode';
import type { SysGpuVendorVo } from '@/runmesh/api/gpuVendor';
import { isActiveNode } from '@/runmesh/utils';
import { useLanguage } from '@/runmesh/i18n';

export const NodeManagement: React.FC = () => {
  const { showToast, toastContainer } = useToast();
  const { t } = useLanguage();
  const [namespaceGroups, setNamespaceGroups] = useState<SysGpuNodeNamespaceGroupVo[]>([]);
  // 存储完整的未分页数据，用于客户端分页
  const [allNamespaceGroupsCache, setAllNamespaceGroupsCache] = useState<
    SysGpuNodeNamespaceGroupVo[]
  >([]);
  const [vendors, setVendors] = useState<SysGpuVendorVo[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorValue, setVendorValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [expandedNamespaceKeys, setExpandedNamespaceKeys] = useState<string[]>([]);
  const [expandedClusterKeys, setExpandedClusterKeys] = useState<string[]>([]);
  const [pagination, setPagination] = useState<PageQuery>({
    pageNum: 1,
    pageSize: 10,
    clusterPageNum: 1,
    clusterPageSize: 10,
    nodePageNum: 1,
    nodePageSize: 10,
  });

  // 存储每个namespace的cluster分页信息
  const [clusterPaginationMap, setClusterPaginationMap] = useState<
    Map<string, { pageNum: number; pageSize: number; total: number }>
  >(new Map());

  // 存储每个cluster的node分页信息
  const [nodePaginationMap, setNodePaginationMap] = useState<
    Map<string, { pageNum: number; pageSize: number; total: number }>
  >(new Map());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [_viewOnly, setViewOnly] = useState(false);
  const [_editingNode, setEditingNode] = useState<SysGpuNodeVo | null>(null);
  const [formData, setFormData] = useState<SysGpuNodeBo>({
    nodeName: '',
    nodeCode: '',
    vendorId: undefined,
    hostName: '',
    hostIp: '',
    gpuModel: '',
    gpuCount: undefined,
    cpuCores: undefined,
    memoryGb: undefined,
    status: '0',
    remark: '',
  });

  const fetchVendors = async () => {
    setVendorLoading(true);
    try {
      const result = await gpuVendorApi.getVendorList({
        pageNum: 1,
        pageSize: 1000,
        vendorPageSize: 10000,
      });
      const namespaceGroups = result.rows || [];
      // 从分组结构中提取所有供应商（guardians）
      const allVendors: SysGpuVendorVo[] = [];
      namespaceGroups.forEach((ns) => {
        if (ns.guardians && ns.guardians.length > 0) {
          allVendors.push(...ns.guardians);
        }
      });
      setVendors(allVendors);
    } catch (error: any) {
      console.error('Failed to fetch vendor list:', error);
    } finally {
      setVendorLoading(false);
    }
  };

  // 从缓存数据应用客户端分页
  const applyClientPagination = (
    cache: SysGpuNodeNamespaceGroupVo[],
    clusterMap: Map<string, { pageNum: number; pageSize: number; total: number }>,
    nodeMap: Map<string, { pageNum: number; pageSize: number; total: number }>,
  ) => {
    const newClusterPaginationMap = new Map(clusterMap);
    const newNodePaginationMap = new Map(nodeMap);
    const pagedNamespaceGroups: SysGpuNodeNamespaceGroupVo[] = [];

    cache.forEach((ns) => {
      const namespaceKey = ns.namespace || '';
      const allClusters = ns.clusters || [];
      const clusterTotal = ns.clusterTotal || allClusters.length;

      // 获取或初始化该namespace的cluster分页信息
      let clusterPagination = newClusterPaginationMap.get(namespaceKey);
      if (!clusterPagination) {
        clusterPagination = {
          pageNum: 1,
          pageSize: pagination.clusterPageSize || 10,
          total: clusterTotal,
        };
        newClusterPaginationMap.set(namespaceKey, clusterPagination);
      } else {
        // 更新总数（创建新对象以保持不可变性）
        newClusterPaginationMap.set(namespaceKey, {
          ...clusterPagination,
          total: clusterTotal,
        });
        clusterPagination = newClusterPaginationMap.get(namespaceKey)!;
      }

      // 对cluster进行客户端分页
      const clusterPageSize = clusterPagination.pageSize;
      const clusterPageNum = clusterPagination.pageNum;
      const clusterStartIndex = (clusterPageNum - 1) * clusterPageSize;
      const clusterEndIndex = Math.min(clusterStartIndex + clusterPageSize, allClusters.length);
      const pagedClusters = allClusters.slice(clusterStartIndex, clusterEndIndex);

      // 对每个cluster下的node进行客户端分页
      const pagedClustersWithNodes = pagedClusters.map((cluster) => {
        const clusterKey = `${namespaceKey}::${cluster.cluster || ''}`;
        const allNodes = cluster.nodes || [];
        const nodeTotal = cluster.nodeTotal || allNodes.length;

        // 获取或初始化该cluster的node分页信息
        let nodePagination = newNodePaginationMap.get(clusterKey);
        if (!nodePagination) {
          nodePagination = {
            pageNum: 1,
            pageSize: pagination.nodePageSize || 10,
            total: nodeTotal,
          };
          newNodePaginationMap.set(clusterKey, nodePagination);
        } else {
          // 更新总数（创建新对象以保持不可变性）
          newNodePaginationMap.set(clusterKey, {
            ...nodePagination,
            total: nodeTotal,
          });
          nodePagination = newNodePaginationMap.get(clusterKey)!;
        }

        // 对node进行客户端分页
        const nodePageSize = nodePagination.pageSize;
        const nodePageNum = nodePagination.pageNum;
        const nodeStartIndex = (nodePageNum - 1) * nodePageSize;
        const nodeEndIndex = Math.min(nodeStartIndex + nodePageSize, allNodes.length);
        const pagedNodes = allNodes.slice(nodeStartIndex, nodeEndIndex);

        return {
          ...cluster,
          nodes: pagedNodes,
          nodeTotal: nodeTotal, // 保留总数用于分页显示
        };
      });

      // 创建分页后的namespace group
      pagedNamespaceGroups.push({
        ...ns,
        clusters: pagedClustersWithNodes,
        clusterTotal: clusterTotal, // 保留总数用于分页显示
      });
    });

    // 更新分页Map状态
    setClusterPaginationMap(newClusterPaginationMap);
    setNodePaginationMap(newNodePaginationMap);
    setNamespaceGroups(pagedNamespaceGroups);
  };

  const fetchNodes = async () => {
    setLoading(true);
    try {
      // 请求数据时，传递一个很大的pageSize给二级和三级分页，以获取所有数据
      const params: any = {
        pageNum: pagination.pageNum,
        pageSize: pagination.pageSize,
        nodeName: searchQuery || undefined,
        status: statusFilter || undefined,
        vendorId: vendorFilter || undefined,
        clusterPageNum: 1,
        clusterPageSize: 10000, // 设置一个很大的值以获取所有cluster
        nodePageNum: 1,
        nodePageSize: 10000, // 设置一个很大的值以获取所有node
      };

      const result = await gpuNodeApi.getNodeList(params);
      const allNamespaceGroups = result.rows || [];
      setTotal(result.total || 0);

      // 保存完整数据到缓存
      setAllNamespaceGroupsCache(allNamespaceGroups);

      // 应用客户端分页
      // 先更新分页Map，然后应用分页
      const newClusterPaginationMap = new Map(clusterPaginationMap);
      const newNodePaginationMap = new Map(nodePaginationMap);

      allNamespaceGroups.forEach((ns) => {
        const namespaceKey = ns.namespace || '';
        const allClusters = ns.clusters || [];
        const clusterTotal = ns.clusterTotal || allClusters.length;

        // 初始化或保留现有的分页信息，并更新总数
        const existingClusterPagination = newClusterPaginationMap.get(namespaceKey);
        if (existingClusterPagination) {
          newClusterPaginationMap.set(namespaceKey, {
            ...existingClusterPagination,
            total: clusterTotal,
          });
        } else {
          newClusterPaginationMap.set(namespaceKey, {
            pageNum: 1,
            pageSize: pagination.clusterPageSize || 10,
            total: clusterTotal,
          });
        }

        allClusters.forEach((cluster) => {
          const clusterKey = `${namespaceKey}::${cluster.cluster || ''}`;
          const nodeTotal = cluster.nodeTotal || cluster.nodes?.length || 0;

          const existingNodePagination = newNodePaginationMap.get(clusterKey);
          if (existingNodePagination) {
            newNodePaginationMap.set(clusterKey, {
              ...existingNodePagination,
              total: nodeTotal,
            });
          } else {
            newNodePaginationMap.set(clusterKey, {
              pageNum: 1,
              pageSize: pagination.nodePageSize || 10,
              total: nodeTotal,
            });
          }
        });
      });

      // 应用客户端分页
      applyClientPagination(allNamespaceGroups, newClusterPaginationMap, newNodePaginationMap);
    } catch (error: any) {
      console.error('Failed to fetch node list:', error);
      showToast({ type: 'error', message: error.message || t('adminNode.toast.fetchFailed') });
      setNamespaceGroups([]);
      setAllNamespaceGroupsCache([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    // 直接调用 list 接口刷新节点列表
    await fetchNodes();
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  useEffect(() => {
    fetchNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.pageNum, pagination.pageSize, searchQuery, statusFilter, vendorFilter]);

  const handleView = async (node: SysGpuNodeVo) => {
    try {
      const fullNode = await gpuNodeApi.getNodeById(node.id!);
      if (fullNode == null || fullNode === undefined) {
        showToast({
          type: 'error',
          message: t('adminNode.toast.nodeNotFound'),
        });
        return;
      }
      setEditingNode(fullNode);
      setFormData({
        id: fullNode.id,
        nodeName: fullNode.nodeName,
        nodeCode: fullNode.nodeCode,
        vendorId: fullNode.vendorId,
        hostName: fullNode.hostName || '',
        hostIp: fullNode.hostIp || '',
        gpuModel: fullNode.gpuModel || '',
        gpuCount: fullNode.gpuCount,
        cpuCores: fullNode.cpuCores,
        memoryGb: fullNode.memoryGb,
        status: fullNode.status,
        remark: fullNode.remark || '',
      });
      setVendorValue(fullNode.vendorId ? String(fullNode.vendorId) : '');
      setViewOnly(true);
      setIsModalOpen(true);
    } catch (error: any) {
      console.error('Failed to fetch node detail:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminNode.toast.fetchDetailFailed'),
      });
    }
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setPagination({ ...pagination, pageNum: 1 });
  };

  // 切换命名空间展开/收起
  const toggleNamespaceExpand = (namespace: string) => {
    setExpandedNamespaceKeys((prev) =>
      prev.includes(namespace) ? prev.filter((x) => x !== namespace) : [...prev, namespace],
    );
  };

  // 切换集群展开/收起
  const toggleClusterExpand = (namespace: string, cluster: string) => {
    const key = `${namespace}::${cluster}`;
    setExpandedClusterKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  };

  // 处理二级列表（cluster）分页 - 为每个namespace独立管理
  const handleClusterPageChange = (namespace: string, page: number) => {
    setClusterPaginationMap((prevMap) => {
      const newMap = new Map(prevMap);
      const currentPagination = newMap.get(namespace) || {
        pageNum: 1,
        pageSize: pagination.clusterPageSize || 10,
        total: 0,
      };
      newMap.set(namespace, {
        ...currentPagination,
        pageNum: page,
      });
      // 使用当前最新的nodePaginationMap应用客户端分页
      applyClientPagination(allNamespaceGroupsCache, newMap, nodePaginationMap);
      return newMap;
    });
  };

  // 处理三级列表（node）分页 - 为每个cluster独立管理
  const handleNodePageChange = (namespace: string, cluster: string, page: number) => {
    const clusterKey = `${namespace}::${cluster}`;
    setNodePaginationMap((prevMap) => {
      const newMap = new Map(prevMap);
      const currentPagination = newMap.get(clusterKey) || {
        pageNum: 1,
        pageSize: pagination.nodePageSize || 10,
        total: 0,
      };
      newMap.set(clusterKey, {
        ...currentPagination,
        pageNum: page,
      });
      // 使用当前最新的clusterPaginationMap应用客户端分页
      applyClientPagination(allNamespaceGroupsCache, clusterPaginationMap, newMap);
      return newMap;
    });
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'STARTING':
        return t('adminNode.status.starting');
      case 'BUSY':
        return t('adminNode.status.busy');
      case 'STOPPING':
        return t('adminNode.status.stopping');
      case 'STOPPED':
        return t('adminNode.status.stopped');
      case 'IDLE':
        return t('adminNode.status.idle');
      default:
        return t('adminNode.status.unknown');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'STARTING':
        return {
          bg: 'bg-amber-50',
          text: 'text-amber-700',
          border: 'border-amber-200',
          dot: 'bg-amber-500',
        };
      case 'BUSY':
        return {
          bg: 'bg-green-50',
          text: 'text-green-700',
          border: 'border-green-200',
          dot: 'bg-green-500',
        };
      case 'STOPPING':
        return {
          bg: 'bg-orange-50',
          text: 'text-orange-700',
          border: 'border-orange-200',
          dot: 'bg-orange-500',
        };
      case 'STOPPED':
        return {
          bg: 'bg-red-50',
          text: 'text-red-700',
          border: 'border-red-200',
          dot: 'bg-red-500',
        };
      case 'IDLE':
        return {
          bg: 'bg-blue-50',
          text: 'text-blue-700',
          border: 'border-blue-200',
          dot: 'bg-blue-500',
        };
      default:
        return {
          bg: 'bg-slate-100',
          text: 'text-slate-600',
          border: 'border-slate-200',
          dot: 'bg-slate-400',
        };
    }
  };

  const vendorSelectValue = vendorValue;

  // 统计活跃节点和总节点数（从三级结构中计算）
  const allNodes = namespaceGroups.flatMap(
    (ns) => ns.clusters?.flatMap((cluster) => cluster.nodes || []) || [],
  );
  const activeNodes = allNodes.filter((n) => isActiveNode(n.status)).length;
  const totalNodes = allNodes.length;

  // 兜底：如果节点没有 guardianAlias，尝试从 vendors 查找
  const getVendorGuardianAliasFallback = (vendorId?: string | number) => {
    if (vendorId == null || vendorId === '') return null;
    const v = vendors.find((x) => String(x.id) === String(vendorId));
    return v?.guardianAlias ?? v?.vendorName ?? v?.shortName ?? null;
  };

  const columns: TableColumn<SysGpuNodeVo>[] = [
    {
      key: 'nodeName',
      title: t('adminNode.table.nodeDetail'),
      render: (node) => (
        <div className="flex flex-col space-y-1">
          <span className="text-xs font-medium text-slate-900">
            {node.nodeName || t('adminNode.common.na')}
          </span>
          <span className="text-xs text-slate-500">
            {node.apiWorkerId ?? (node.id != null ? String(node.id) : '')}
          </span>
        </div>
      ),
    },
    {
      key: 'vendor',
      title: t('adminNode.table.vendor'),
      render: (node) => {
        const alias = node.guardianAlias || getVendorGuardianAliasFallback(node.vendorId);
        if (!alias) return <span className="text-xs">{t('adminNode.common.na')}</span>;
        return <span className="text-xs font-medium text-slate-900">{alias}</span>;
      },
    },
    {
      key: 'hostIp',
      title: t('adminNode.table.hostIp'),
      render: (node) => <span className="text-xs">{node.hostIp || t('adminNode.common.na')}</span>,
    },
    {
      key: 'gpuModel',
      title: t('adminNode.table.gpuSpec'),
      render: (node) => (
        <span className="px-3 py-1 bg-slate-100 rounded-lg text-xs font-mono font-medium text-slate-700">
          {node.gpuModel || t('adminNode.common.na')}
        </span>
      ),
    },
    {
      key: 'config',
      title: t('adminNode.table.config'),
      render: (node) => (
        <div className="text-xs space-y-0.5">
          <div className="text-slate-700">
            {t('adminNode.table.config.gpu', { count: node.gpuCount || 0 })}
          </div>
          <div className="text-xs text-slate-500">
            {t('adminNode.table.config.cpuMemory', {
              cpu: node.cpuCores || 0,
              memory: node.memoryGb || 0,
            })}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      title: t('adminNode.table.status'),
      render: (node) => {
        const statusColor = getStatusColor(node.status);
        return (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}
          >
            <span className={`w-2.5 h-2.5 rounded-full mr-2.5 ${statusColor.dot}`}></span>
            {getStatusLabel(node.status)}
          </span>
        );
      },
    },
  ];

  const safeRecordId = (record: SysGpuNodeVo | null | undefined): string | number | null => {
    if (record == null) return null;
    const id = record.id;
    if (id === undefined || id === null || id === '') return null;
    return id;
  };

  const rowActions: TableAction<SysGpuNodeVo>[] = [
    {
      key: 'view',
      label: t('adminNode.action.view'),
      icon: <Icons.Eye className="w-4 h-4" />,
      onClick: (record) => {
        const id = safeRecordId(record);
        if (id == null) {
          showToast({ type: 'warning', message: t('adminNode.toast.noNodeId') });
          return;
        }
        handleView(record!);
      },
      tooltip: t('adminNode.action.view'),
      type: 'secondary',
    },
  ];

  // 渲染集群下的节点列表（三级列表）
  const renderClusterNodes = (cluster: SysGpuNodeClusterGroupVo, namespace: string) => {
    const clusterKey = `${namespace}::${cluster.cluster || ''}`;
    // 使用 nodeTotal 作为总数，如果没有则使用 nodes 长度（兼容处理）
    const actualTotal = cluster.nodeTotal ?? (cluster.nodes?.length || 0);
    const nodePagination = nodePaginationMap.get(clusterKey) || {
      pageNum: pagination.nodePageNum || 1,
      pageSize: pagination.nodePageSize || 10,
      total: actualTotal,
    };
    const nodes = cluster.nodes || [];
    // 直接使用 actualTotal 或分页对象中的 total（优先使用 actualTotal）
    const totalNodes = actualTotal || nodePagination.total;
    const currentPage = nodePagination.pageNum;
    const pageSize = nodePagination.pageSize;
    const totalPages = Math.ceil(totalNodes / pageSize);

    return (
      <div className="ml-8 mt-2 mb-4 border-l-2 border-slate-200 pl-4">
        <EnterpriseTable
          columns={columns}
          data={nodes.filter((n): n is SysGpuNodeVo => n != null && n !== undefined)}
          rowKey={(node, index) => (node?.id != null ? String(node.id) : `node-${index}`)}
          loading={false}
          actions={rowActions}
          stickyHeader={false}
          height="auto"
          width="100%"
          empty={{
            title: t('adminNode.empty.title'),
            description: t('adminNode.empty.description'),
          }}
        />
        {totalNodes > pageSize && (
          <div className="mt-2 flex items-center justify-between px-2 py-2 text-xs text-slate-600">
            <span>
              {t('table.pagination.summary', {
                start: (currentPage - 1) * pageSize + 1,
                end: Math.min(currentPage * pageSize, totalNodes),
                total: totalNodes,
              })}
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                title={t('table.pagination.prev')}
                onClick={() =>
                  handleNodePageChange(
                    namespace,
                    cluster.cluster || '',
                    Math.max(1, currentPage - 1),
                  )
                }
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
                  handleNodePageChange(
                    namespace,
                    cluster.cluster || '',
                    Math.min(totalPages, currentPage + 1),
                  )
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

  // 渲染命名空间下的集群列表（二级列表）
  const renderNamespaceClusters = (namespaceGroup: SysGpuNodeNamespaceGroupVo) => {
    const namespaceKey = namespaceGroup.namespace || '';
    // 使用 clusterTotal 作为总数，如果没有则使用 clusters 长度（兼容处理）
    const actualTotal = namespaceGroup.clusterTotal ?? (namespaceGroup.clusters?.length || 0);
    const clusterPagination = clusterPaginationMap.get(namespaceKey) || {
      pageNum: pagination.clusterPageNum || 1,
      pageSize: pagination.clusterPageSize || 10,
      total: actualTotal,
    };
    const clusters = namespaceGroup.clusters || [];
    // 直接使用 actualTotal 或分页对象中的 total（优先使用 actualTotal）
    const totalClusters = actualTotal || clusterPagination.total;
    const currentPage = clusterPagination.pageNum;
    const pageSize = clusterPagination.pageSize;
    const totalPages = Math.ceil(totalClusters / pageSize);

    return (
      <div className="ml-4 mt-2 mb-4">
        {clusters.map((cluster, clusterIndex) => {
          const clusterKey = `${namespaceGroup.namespace}::${cluster.cluster}`;
          const isClusterExpanded = expandedClusterKeys.includes(clusterKey);
          const nodeCount = cluster.nodes?.length || 0;

          return (
            <div key={clusterIndex} className="mb-3 border border-slate-200 rounded-lg bg-slate-50">
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => toggleClusterExpand(namespaceGroup.namespace, cluster.cluster)}
              >
                <div className="flex items-center space-x-3">
                  <Icons.ChevronRight
                    className={`w-4 h-4 text-slate-500 transition-transform ${
                      isClusterExpanded ? 'rotate-90' : ''
                    }`}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-900">
                      {cluster.cluster || ''}
                    </span>
                    <span className="text-xs text-slate-500 mt-0.5">
                      {t('adminNode.nodeCountLabel', { count: nodeCount })}
                    </span>
                  </div>
                </div>
              </div>
              {isClusterExpanded && renderClusterNodes(cluster, namespaceGroup.namespace)}
            </div>
          );
        })}
        {totalClusters > pageSize && (
          <div className="mt-2 flex items-center justify-between px-2 py-2 text-xs text-slate-600 bg-white border-t border-slate-200">
            <span>
              {t('table.pagination.summary', {
                start: (currentPage - 1) * pageSize + 1,
                end: Math.min(currentPage * pageSize, totalClusters),
                total: totalClusters,
              })}
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                title={t('table.pagination.prev')}
                onClick={() => handleClusterPageChange(namespaceKey, Math.max(1, currentPage - 1))}
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
                  handleClusterPageChange(namespaceKey, Math.min(totalPages, currentPage + 1))
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
  const renderNodeTreeContent = () => {
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
          <p className="text-sm font-medium text-slate-900">{t('adminNode.empty.title')}</p>
          <p className="text-xs text-slate-500 mt-1">{t('adminNode.empty.description')}</p>
        </div>
      );
    }

    return (
      <div className="divide-y divide-slate-200">
        {namespaceGroups.map((namespaceGroup, nsIndex) => {
          const isNamespaceExpanded = expandedNamespaceKeys.includes(namespaceGroup.namespace);
          const nodeTotal = namespaceGroup.nodeTotal || 0;
          const idleCount = namespaceGroup.idleNodeCount || 0;
          const busyCount = namespaceGroup.busyNodeCount || 0;

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
                        {namespaceGroup.namespace || ''}
                      </span>
                      <span className="text-xs text-slate-500">
                        ({t('adminNode.nodeCountLabel', { count: nodeTotal })})
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-xs text-slate-600">
                        {t('adminNode.namespace.idleLabel')}{' '}
                        <span className="text-blue-600 font-medium">{idleCount}</span>
                      </span>
                      <span className="text-xs text-slate-600">
                        {t('adminNode.namespace.busyLabel')}{' '}
                        <span className="text-green-600 font-medium">{busyCount}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {isNamespaceExpanded && renderNamespaceClusters(namespaceGroup)}
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
            title={t('adminNode.title')}
            description={t('adminNode.subtitle')}
            columns={[]}
            data={[]}
            rowKey={() => ''}
            loading={false}
            actions={[]}
            toolbarActions={[
              {
                key: 'refresh',
                label: t('adminNode.action.refresh'),
                icon: <Icons.RefreshCw className="w-4 h-4" />,
                onClick: handleRefresh,
                type: 'secondary',
              },
            ]}
            search={{
              value: searchQuery,
              onChange: handleSearch,
              placeholder: t('adminNode.search.placeholder'),
            }}
            searchExtra={
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <p className="text-sm text-slate-500 font-medium uppercase">
                    {t('adminNode.stats.totalNodes')}
                  </p>
                  <div className="flex items-baseline mt-3">
                    <span className="text-3xl font-bold text-slate-900">{totalNodes}</span>
                    <span className="ml-3 text-sm text-slate-400">
                      {t('adminNode.stats.nodesUnit')}
                    </span>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <p className="text-sm text-slate-500 font-medium uppercase">
                    {t('adminNode.stats.activeNodes')}
                  </p>
                  <div className="flex items-baseline mt-3">
                    <span className="text-3xl font-bold text-slate-900">{activeNodes}</span>
                    <span className="ml-3 text-sm text-green-600 font-medium">
                      {t('adminNode.stats.online')}
                    </span>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <p className="text-sm text-slate-500 font-medium uppercase">
                    {t('adminNode.stats.namespaceCount')}
                  </p>
                  <div className="flex items-baseline mt-3">
                    <span className="text-3xl font-bold text-slate-900">
                      {namespaceGroups.length}
                    </span>
                    <span className="ml-3 text-sm text-slate-400">
                      {t('adminNode.stats.namespaceUnit')}
                    </span>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <p className="text-sm text-slate-500 font-medium uppercase">
                    {t('adminNode.stats.health')}
                  </p>
                  <div className="flex items-baseline mt-3">
                    <span className="text-3xl font-bold text-slate-900">
                      {totalNodes > 0 ? Math.round((activeNodes / totalNodes) * 100) : 0}%
                    </span>
                    <span className="ml-3 text-sm text-slate-400">
                      {t('adminNode.stats.onlineRate')}
                    </span>
                  </div>
                </div>
              </div>
            }
            filters={
              <div className="flex flex-wrap gap-3 items-center">
                <select
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 min-w-[130px]"
                  value={vendorFilter || ''}
                  onChange={(e) => {
                    setVendorFilter(e.target.value);
                    setPagination({ ...pagination, pageNum: 1 });
                  }}
                >
                  <option value="">{t('adminNode.filter.vendorAll')}</option>
                  {vendors
                    .filter((vendor) => vendor.id !== undefined && vendor.id !== null)
                    .map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.guardianAlias ??
                          vendor.vendorName ??
                          vendor.shortName ??
                          String(vendor.id)}
                      </option>
                    ))}
                </select>
                <select
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 min-w-[120px]"
                  value={statusFilter || ''}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPagination({ ...pagination, pageNum: 1 });
                  }}
                >
                  <option value="">{t('adminNode.filter.statusAll')}</option>
                  <option value="STARTING">{t('adminNode.status.starting')}</option>
                  <option value="BUSY">{t('adminNode.status.busy')}</option>
                  <option value="STOPPING">{t('adminNode.status.stopping')}</option>
                  <option value="STOPPED">{t('adminNode.status.stopped')}</option>
                  <option value="IDLE">{t('adminNode.status.idle')}</option>
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
            }}
            empty={{
              title: t('adminNode.empty.title'),
              description: t('adminNode.empty.description'),
            }}
            contentClassName="!p-0"
            height="100%"
            width="100%"
            stickyHeader={false}
            extraContent={
              <div className="flex-1 min-h-0 overflow-auto bg-white">{renderNodeTreeContent()}</div>
            }
          />
        </div>

        {isModalOpen && (
          <EnterpriseModal
            open={isModalOpen}
            title={t('adminNode.modal.viewTitle')}
            onClose={() => {
              setIsModalOpen(false);
              setViewOnly(false);
            }}
            footer={null}
            width="60vw"
            height="auto"
          >
            <div className="px-2 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.nodeName}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.namePlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.code')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.nodeCode}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.codePlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.vendor')}
                  </label>
                  <div className="space-y-1">
                    <select
                      value={vendorSelectValue}
                      disabled
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-slate-50 cursor-default pr-7"
                    >
                      <option value="">
                        {vendorLoading
                          ? t('adminNode.form.vendorLoading')
                          : t('adminNode.form.vendorPlaceholder')}
                      </option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id ?? vendor.vendorName} value={vendor.id ?? ''}>
                          {vendor.vendorName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.hostName')}
                  </label>
                  <input
                    type="text"
                    value={formData.hostName}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.hostNamePlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.hostIp')}
                  </label>
                  <input
                    type="text"
                    value={formData.hostIp}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.hostIpPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.gpuModel')}
                  </label>
                  <input
                    type="text"
                    value={formData.gpuModel}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.gpuModelPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.gpuCount')}
                  </label>
                  <input
                    type="text"
                    value={formData.gpuCount ?? ''}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.gpuCountPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.cpuCores')}
                  </label>
                  <input
                    type="text"
                    value={formData.cpuCores ?? ''}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.cpuCoresPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.memory')}
                  </label>
                  <input
                    type="text"
                    value={formData.memoryGb ?? ''}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                    placeholder={t('adminNode.form.memoryPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminNode.form.status')}
                  </label>
                  <select
                    value={formData.status}
                    disabled
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-slate-50 cursor-default pr-7"
                  >
                    <option value="STARTING">{t('adminNode.status.starting')}</option>
                    <option value="BUSY">{t('adminNode.status.busy')}</option>
                    <option value="STOPPING">{t('adminNode.status.stopping')}</option>
                    <option value="STOPPED">{t('adminNode.status.stopped')}</option>
                    <option value="IDLE">{t('adminNode.status.idle')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminNode.form.remark')}
                </label>
                <textarea
                  value={formData.remark}
                  readOnly
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm text-slate-700 cursor-default"
                  placeholder={t('adminNode.form.remarkPlaceholder')}
                />
              </div>
            </div>
          </EnterpriseModal>
        )}
      </div>
    </>
  );
};

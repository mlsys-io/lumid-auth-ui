import React, { useState, useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useToast } from '@/runmesh/components/Toast';
import { ConfirmDialog } from '@/runmesh/components/ConfirmDialog';
import * as gpuNodeApi from '@/runmesh/api/gpuNode';
import type { SysGpuNodeVo, SysGpuNodeBo, SysGpuNodeNamespaceGroupVo } from '@/runmesh/api/gpuNode';
import * as gpuVendorApi from '@/runmesh/api/gpuVendor';
import type { SysGpuVendorVo } from '@/runmesh/api/gpuVendor';
import { useLanguage } from '@/runmesh/i18n';

/** 从节点列表接口的分组结构中展平出节点数组 */
function flattenNodesFromGroupedRows(
  rows: SysGpuNodeNamespaceGroupVo[] | undefined,
): SysGpuNodeVo[] {
  if (!rows || !Array.isArray(rows)) return [];
  return rows.flatMap((ns) => (ns.clusters || []).flatMap((c) => c.nodes || []));
}

/** 从供应商列表接口的分组结构中按名称找到第一个匹配的 guardian，返回其 id */
function resolveVendorIdFromGroupedRows(
  rows: { guardians?: SysGpuVendorVo[]; clusters?: { vendors?: SysGpuVendorVo[] }[] }[] | undefined,
  vendorName: string,
): string | number | undefined {
  if (!rows || !Array.isArray(rows) || !vendorName) return undefined;
  const name = String(vendorName).trim().toLowerCase();
  for (const group of rows) {
    const guardians = group.guardians || [];
    for (const g of guardians) {
      const match =
        (g.vendorName && g.vendorName.trim().toLowerCase() === name) ||
        (g.guardianAlias && g.guardianAlias.trim().toLowerCase() === name) ||
        (g.shortName && g.shortName.trim().toLowerCase() === name);
      if (match && g.id !== undefined && g.id !== null && g.id !== '') return g.id;
    }
    const clusters = group.clusters || [];
    for (const c of clusters) {
      const vendors = c.vendors || [];
      for (const v of vendors) {
        const match =
          (v.vendorName && v.vendorName.trim().toLowerCase() === name) ||
          (v.guardianAlias && v.guardianAlias.trim().toLowerCase() === name) ||
          (v.shortName && v.shortName.trim().toLowerCase() === name);
        if (match && v.id !== undefined && v.id !== null && v.id !== '') return v.id;
      }
    }
  }
  return undefined;
}

interface NodeListProps {
  /** 供应商名称（用于无 vendorId 时解析） */
  vendorName?: string;
  /** 供应商/Guardian ID（与列表、节点表一致，优先使用） */
  vendorId?: string | number;
}

const NodeList: React.FC<NodeListProps> = ({ vendorName, vendorId: vendorIdProp }) => {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [nodes, setNodes] = useState<SysGpuNodeVo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SysGpuNodeBo | null>(null);
  const [formData, setFormData] = useState<SysGpuNodeBo>({
    nodeName: '',
    nodeCode: '',
    vendorId: undefined,
    hostName: '',
    hostIp: '',
    gpuModel: '',
    gpuCount: 0,
    cpuCores: 0,
    memoryGb: 0,
    status: 'RUNNING',
    remark: '',
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant?: 'default' | 'danger';
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    if (vendorIdProp != null && vendorIdProp !== '') {
      fetchNodesByVendorId(String(vendorIdProp));
    } else if (vendorName) {
      fetchNodesByVendorName(vendorName);
    } else {
      setNodes([]);
      setLoading(false);
    }
  }, [vendorIdProp, vendorName]);

  const fetchNodesByVendorId = async (vendorId: string) => {
    try {
      setLoading(true);
      const result = await gpuNodeApi.getNodeList({
        vendorId,
        pageNum: 1,
        pageSize: 10000,
        clusterPageNum: 1,
        clusterPageSize: 10000,
        nodePageNum: 1,
        nodePageSize: 10000,
      });
      const flattened = flattenNodesFromGroupedRows(result.rows);
      setNodes(flattened);
    } catch (error: any) {
      console.error('Failed to fetch node list:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminSupplierNodes.toast.fetchFailed'),
      });
      setNodes([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchNodesByVendorName = async (name: string) => {
    try {
      setLoading(true);
      const vendorResponse = await gpuVendorApi.getVendorList({ vendorName: name });
      const rows = vendorResponse.rows || [];
      const resolvedId = resolveVendorIdFromGroupedRows(rows, name);
      if (resolvedId === undefined || resolvedId === null || resolvedId === '') {
        setNodes([]);
        return;
      }
      await fetchNodesByVendorId(String(resolvedId));
    } catch (error: any) {
      console.error('Failed to fetch node list:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminSupplierNodes.toast.fetchFailed'),
      });
      setNodes([]);
    } finally {
      setLoading(false);
    }
  };

  const refetchNodes = () => {
    if (vendorIdProp != null && vendorIdProp !== '') {
      fetchNodesByVendorId(String(vendorIdProp));
    } else if (vendorName) {
      fetchNodesByVendorName(vendorName);
    }
  };

  // 获取供应商ID（用于新增/编辑节点表单）
  const getVendorId = async (): Promise<string | number | undefined> => {
    if (vendorIdProp != null && vendorIdProp !== '') return vendorIdProp;
    if (!vendorName) return undefined;
    const vendorResponse = await gpuVendorApi.getVendorList({ vendorName });
    const rows = vendorResponse.rows || [];
    return resolveVendorIdFromGroupedRows(rows, vendorName);
  };

  // 打开新增节点弹窗
  const handleAddNode = async () => {
    const vendorId = await getVendorId();
    setEditingNode(null);
    setFormData({
      nodeName: '',
      nodeCode: '',
      vendorId: vendorId,
      hostName: '',
      hostIp: '',
      gpuModel: '',
      gpuCount: 0,
      cpuCores: 0,
      memoryGb: 0,
      status: 'RUNNING',
      remark: '',
    });
    setIsModalOpen(true);
  };

  // 打开编辑节点弹窗
  const handleEditNode = (node: SysGpuNodeVo) => {
    setEditingNode(node);
    setFormData({
      id: node.id,
      nodeName: node.nodeName,
      nodeCode: node.nodeCode,
      vendorId: node.vendorId,
      hostName: node.hostName || '',
      hostIp: node.hostIp || '',
      gpuModel: node.gpuModel || '',
      gpuCount: node.gpuCount || 0,
      cpuCores: node.cpuCores || 0,
      memoryGb: node.memoryGb || 0,
      status: node.status,
      remark: node.remark || '',
    });
    setIsModalOpen(true);
  };

  // 删除节点
  const handleDeleteNode = async (nodeId: string | number, nodeName?: string) => {
    setConfirmDialog({
      open: true,
      title: t('adminSupplierNodes.confirm.delete.title'),
      message: nodeName
        ? t('adminSupplierNodes.confirm.delete.messageWithName', { name: nodeName })
        : t('adminSupplierNodes.confirm.delete.message'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await gpuNodeApi.deleteNode([nodeId]);
          showToast({ type: 'success', message: t('adminSupplierNodes.toast.deleteSuccess') });
          refetchNodes();
        } catch (error: any) {
          console.error('Failed to delete node:', error);
          showToast({
            type: 'error',
            message: error.message || t('adminSupplierNodes.toast.deleteFailed'),
          });
        } finally {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        }
      },
    });
  };

  // 保存节点
  const handleSaveNode = async () => {
    try {
      if (!formData.nodeName?.trim()) {
        showToast({ type: 'warning', message: t('adminSupplierNodes.toast.nameRequired') });
        return;
      }
      if (!formData.nodeCode?.trim()) {
        showToast({ type: 'warning', message: t('adminSupplierNodes.toast.codeRequired') });
        return;
      }

      if (editingNode) {
        await gpuNodeApi.updateNode(formData);
        showToast({ type: 'success', message: t('adminSupplierNodes.toast.updateSuccess') });
      } else {
        await gpuNodeApi.addNode(formData);
        showToast({ type: 'success', message: t('adminSupplierNodes.toast.createSuccess') });
      }

      refetchNodes();
      setIsModalOpen(false);
    } catch (error: any) {
      console.error('Failed to save node:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminSupplierNodes.toast.saveFailed'),
      });
      // 保持模态框打开，让用户可以修正错误
    }
  };

  // 切换节点状态
  const handleToggleStatus = async (
    nodeId: string | number,
    currentStatus: string,
    nodeName?: string,
  ) => {
    const newStatus = currentStatus === '0' ? '1' : '0';
    const statusText =
      newStatus === '1'
        ? t('adminSupplierNodes.action.disable')
        : t('adminSupplierNodes.action.enable');

    setConfirmDialog({
      open: true,
      title: t('adminSupplierNodes.confirm.status.title', { action: statusText }),
      message: nodeName
        ? t('adminSupplierNodes.confirm.status.messageWithName', {
            action: statusText,
            name: nodeName,
          })
        : t('adminSupplierNodes.confirm.status.message', { action: statusText }),
      onConfirm: async () => {
        try {
          await gpuNodeApi.changeNodeStatus(nodeId, newStatus);
          showToast({
            type: 'success',
            message: t('adminSupplierNodes.toast.statusSuccess', { action: statusText }),
          });
          refetchNodes();
        } catch (error: any) {
          console.error('Failed to update status:', error);
          showToast({
            type: 'error',
            message:
              error.message || t('adminSupplierNodes.toast.statusFailed', { action: statusText }),
          });
        } finally {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="p-4 flex justify-center items-center">
        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-brand-600 mr-3"></div>
        <span>{t('adminSupplierNodes.loading')}</span>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <Icons.Server className="w-5 h-5 mr-2 text-brand-600" />
          {t('adminSupplierNodes.title')}
        </h3>
        <button
          onClick={handleAddNode}
          className="bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center"
        >
          <Icons.Plus className="w-4 h-4 mr-1" />
          {t('adminSupplierNodes.action.add')}
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="text-center py-8 border border-slate-200 rounded-lg bg-slate-50 text-slate-500">
          <Icons.Box className="w-12 h-12 mx-auto text-slate-300 mb-2" />
          <p>{t('adminSupplierNodes.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-slate-200 rounded-lg">
            <thead className="bg-slate-50">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNodes.table.id')}
                </th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNodes.table.name')}
                </th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNodes.table.code')}
                </th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNodes.table.gpuModel')}
                </th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNodes.table.status')}
                </th>
                <th className="py-3 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNodes.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {nodes.map((node) => (
                <tr key={node.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 whitespace-nowrap text-sm text-slate-700">
                    {node.apiWorkerId ?? node.id}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-sm font-medium text-slate-900">
                    {node.nodeName}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-sm text-slate-700">
                    {node.nodeCode}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-sm text-slate-700">
                    {node.gpuModel || '-'}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {(() => {
                      let statusClass = '';
                      let statusText = '';
                      switch (node.status) {
                        case 'STARTING':
                          statusClass = 'bg-amber-100 text-amber-800';
                          statusText = t('adminSupplierNodes.status.starting');
                          break;
                        case 'BUSY':
                          statusClass = 'bg-green-100 text-green-800';
                          statusText = t('adminSupplierNodes.status.busy');
                          break;
                        case 'STOPPING':
                          statusClass = 'bg-orange-100 text-orange-800';
                          statusText = t('adminSupplierNodes.status.stopping');
                          break;
                        case 'STOPPED':
                          statusClass = 'bg-red-100 text-red-800';
                          statusText = t('adminSupplierNodes.status.stopped');
                          break;
                        case 'IDLE':
                          statusClass = 'bg-blue-100 text-blue-800';
                          statusText = t('adminSupplierNodes.status.idle');
                          break;
                        default:
                          statusClass = 'bg-slate-100 text-slate-800';
                          statusText = t('adminSupplierNodes.status.unknown');
                          break;
                      }
                      return (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}`}
                        >
                          {statusText}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      className="text-slate-400 hover:text-brand-600 p-1 mr-2"
                      title={t('adminSupplierNodes.action.edit')}
                      onClick={() => handleEditNode(node)}
                    >
                      <Icons.Edit className="w-4 h-4" />
                    </button>
                    <button
                      className="text-slate-400 hover:text-amber-600 p-1 mr-2"
                      title={
                        node.status === '0'
                          ? t('adminSupplierNodes.action.disable')
                          : t('adminSupplierNodes.action.enable')
                      }
                      onClick={() => handleToggleStatus(node.id!, node.status, node.nodeName)}
                    >
                      <Icons.Power className="w-4 h-4" />
                    </button>
                    <button
                      className="text-slate-400 hover:text-red-600 p-1"
                      title={t('adminSupplierNodes.action.delete')}
                      onClick={() => handleDeleteNode(node.id!, node.nodeName)}
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑/新增节点弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-xl font-bold text-slate-800">
                {editingNode
                  ? t('adminSupplierNodes.modal.editTitle')
                  : t('adminSupplierNodes.modal.addTitle')}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.nodeName}
                  onChange={(e) => setFormData({ ...formData, nodeName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminSupplierNodes.form.namePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.code')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.nodeCode}
                  onChange={(e) => setFormData({ ...formData, nodeCode: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminSupplierNodes.form.codePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.hostName')}
                </label>
                <input
                  type="text"
                  value={formData.hostName}
                  onChange={(e) => setFormData({ ...formData, hostName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminSupplierNodes.form.hostNamePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.hostIp')}
                </label>
                <input
                  type="text"
                  value={formData.hostIp}
                  onChange={(e) => setFormData({ ...formData, hostIp: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminSupplierNodes.form.hostIpPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.gpuModel')}
                </label>
                <input
                  type="text"
                  value={formData.gpuModel}
                  onChange={(e) => setFormData({ ...formData, gpuModel: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminSupplierNodes.form.gpuModelPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminSupplierNodes.form.gpuCount')}
                  </label>
                  <input
                    type="number"
                    value={formData.gpuCount || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        gpuCount: e.target.value ? parseInt(e.target.value) : 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminSupplierNodes.form.cpuCores')}
                  </label>
                  <input
                    type="number"
                    value={formData.cpuCores || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cpuCores: e.target.value ? parseInt(e.target.value) : 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminSupplierNodes.form.memoryGb')}
                  </label>
                  <input
                    type="number"
                    value={formData.memoryGb || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        memoryGb: e.target.value ? parseInt(e.target.value) : 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.status')}
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  <option value="0">{t('adminSupplierNodes.form.status.running')}</option>
                  <option value="1">{t('adminSupplierNodes.form.status.stopped')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminSupplierNodes.form.remark')}
                </label>
                <textarea
                  value={formData.remark}
                  onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminSupplierNodes.form.remarkPlaceholder')}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end space-x-3 sticky bottom-0 bg-white">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-sm"
              >
                {t('adminSupplierNodes.action.cancel')}
              </button>
              <button
                onClick={handleSaveNode}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm"
              >
                {t('adminSupplierNodes.action.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};

export default NodeList;

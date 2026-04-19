import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

interface SupplierNode {
  id: string;
  hostId: string;
  gpuModel: string;
  vram: string;
  totalGpus: number;
  idleGpus: number;
  cpu: string;
  ram: string;
  storage: string;
  driverVersion: string;
  pricePerHour: number;
  status: 'online' | 'offline' | 'maintenance';
}

export const SupplierNodeConfig: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SupplierNode | null>(null);

  // Mock Data
  const [nodes, _setNodes] = useState<SupplierNode[]>([
    {
      id: '1',
      hostId: 'cn-north-01',
      gpuModel: 'RTX 3090',
      vram: '24GB',
      totalGpus: 8,
      idleGpus: 4,
      cpu: 'AMD EPYC 7543',
      ram: '512GB',
      storage: '2TB NVMe',
      driverVersion: '535.104',
      pricePerHour: 0.22,
      status: 'online',
    },
    {
      id: '2',
      hostId: 'cn-north-02',
      gpuModel: 'RTX 4090',
      vram: '24GB',
      totalGpus: 4,
      idleGpus: 0,
      cpu: 'Intel Xeon Gold 6330',
      ram: '256GB',
      storage: '1TB SSD',
      driverVersion: '535.104',
      pricePerHour: 0.45,
      status: 'online',
    },
  ]);

  const handleEdit = (node: SupplierNode) => {
    setEditingNode(node);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingNode(null);
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // Logic to update or add node
    setIsModalOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-auto">
      <header className="px-8 py-6 bg-white border-b border-slate-100 flex items-center sticky top-0 z-10">
        <button
          onClick={() => navigate('/admin/suppliers')}
          className="mr-4 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <Icons.ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800">{t('adminSupplierNode.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('adminSupplierNode.subtitle.prefix')}{' '}
            <span className="font-mono text-slate-700">{id}</span>{' '}
            {t('adminSupplierNode.subtitle.suffix')}
          </p>
        </div>
        <button
          onClick={handleAddNew}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm flex items-center"
        >
          <Icons.Plus className="w-4 h-4 mr-2" />
          {t('adminSupplierNode.action.addServer')}
        </button>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.hostId')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.gpuSpec')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.allocation')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.hardware')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.pricePerGpu')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.status')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('adminSupplierNode.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {nodes.map((node) => (
                <tr key={node.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-slate-100 rounded text-slate-500">
                        <Icons.Server className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-medium text-slate-900">{node.hostId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-800">{node.gpuModel}</span>
                      <span className="text-xs text-slate-500">{node.vram} VRAM</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap align-middle">
                    <div className="w-32">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700">
                          {t('adminSupplierNode.table.available', { count: node.idleGpus })}
                        </span>
                        <span className="text-slate-400">
                          {t('adminSupplierNode.table.total', { count: node.totalGpus })}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full"
                          style={{
                            width: `${((node.totalGpus - node.idleGpus) / node.totalGpus) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-0.5">
                      <div className="flex items-center text-xs text-slate-600">
                        <Icons.Cpu className="w-3 h-3 mr-1 text-slate-400" />
                        <span className="truncate max-w-[150px]" title={node.cpu}>
                          {node.cpu}
                        </span>
                      </div>
                      <div className="flex items-center text-xs text-slate-600">
                        <Icons.HardDrive className="w-3 h-3 mr-1 text-slate-400" />
                        <span>{node.storage}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-bold text-slate-900">
                      ${node.pricePerHour.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                        node.status === 'online'
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${node.status === 'online' ? 'bg-green-500' : 'bg-slate-400'}`}
                      ></span>
                      {node.status === 'online'
                        ? t('adminSupplierNode.status.online')
                        : t('adminSupplierNode.status.offline')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(node)}
                      className="text-brand-600 hover:text-brand-800 p-1"
                    >
                      <Icons.Edit className="w-4 h-4" />
                    </button>
                    <button className="text-red-400 hover:text-red-600 p-1 ml-2">
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Config Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {editingNode
                  ? t('adminSupplierNode.modal.editTitle')
                  : t('adminSupplierNode.modal.addTitle')}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.hostId')}
                  </label>
                  <div className="relative">
                    <Icons.Server className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      defaultValue={editingNode?.hostId}
                      placeholder={t('adminSupplierNode.form.hostIdPlaceholder')}
                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.gpuModel')}
                  </label>
                  <div className="relative">
                    <Icons.Chip className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      defaultValue={editingNode?.gpuModel}
                      placeholder={t('adminSupplierNode.form.gpuModelPlaceholder')}
                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.vram')}
                  </label>
                  <div className="relative">
                    <Icons.Database className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      defaultValue={editingNode?.vram}
                      placeholder={t('adminSupplierNode.form.vramPlaceholder')}
                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.idleGpus')}
                  </label>
                  <input
                    type="number"
                    defaultValue={editingNode?.idleGpus}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.totalGpus')}
                  </label>
                  <input
                    type="number"
                    defaultValue={editingNode?.totalGpus}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.cpu')}
                  </label>
                  <div className="relative">
                    <Icons.Cpu className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      defaultValue={editingNode?.cpu}
                      placeholder={t('adminSupplierNode.form.cpuPlaceholder')}
                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.storage')}
                  </label>
                  <div className="relative">
                    <Icons.HardDrive className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      defaultValue={editingNode?.storage}
                      placeholder={t('adminSupplierNode.form.storagePlaceholder')}
                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.driverVersion')}
                  </label>
                  <input
                    type="text"
                    defaultValue={editingNode?.driverVersion}
                    placeholder={t('adminSupplierNode.form.driverVersionPlaceholder')}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {t('adminSupplierNode.form.pricePerHour')}
                  </label>
                  <div className="relative">
                    <Icons.DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={editingNode?.pricePerHour}
                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {t('adminSupplierNode.action.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 shadow-sm flex items-center"
                >
                  <Icons.Save className="w-4 h-4 mr-2" />
                  {t('adminSupplierNode.action.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

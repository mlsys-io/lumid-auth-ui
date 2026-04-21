import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import { getGpuNodeList, refreshGpuNodes } from '@/runmesh/api/user/gpuNodeApi';
import { allowRefresh } from '@/runmesh/utils/apiRateLimiter';
import { useLanguage } from '@/runmesh/i18n';

interface AvailableGpu {
  id: string;
  name: string;
  gpuModel: string;
  gpuCount: number;
  vram: string;
  cpu: string;
  ram: string;
  storage: string;
  region: string;
  price: number;
  supplier: string;
  reliability: number;
}

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
    <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <span className="text-xs text-slate-500">
          {t('gpuRentalList.pagination.summary', {
            start: startItem,
            end: endItem,
            total: totalItems,
          })}
        </span>
        <div className="flex items-center space-x-1.5">
          <span className="text-xs text-slate-500">{t('gpuRentalList.pagination.perPage')}</span>
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
          className={`px-2.5 py-1 border rounded text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 ${currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage <= 1}
        >
          <Icons.ChevronRight className="w-3.5 h-3.5 rotate-180" />
        </button>

        {getPageNumbers().map((page, index) =>
          page === -1 ? (
            <span key={`ellipsis-${index}`} className="px-1.5 py-1 text-xs text-slate-400">
              ...
            </span>
          ) : (
            <button
              key={page}
              className={`px-2.5 py-1 border rounded text-xs font-medium ${
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
          className={`px-2.5 py-1 border rounded text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 ${currentPage >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          disabled={currentPage >= totalPages || totalPages === 0}
        >
          <Icons.ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const GpuRentalList: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const getRegionDisplayLabel = (region: string): string => {
    if (!region) return t('gpuRentalList.region.unknown');
    if (region === '美东') return t('gpuRentalList.region.usEast');
    if (region === '美西') return t('gpuRentalList.region.usWest');
    if (region === '欧西') return t('gpuRentalList.region.euWest');
    if (region === '亚太') return t('gpuRentalList.region.apac');
    return region;
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [gpuModelFilter, setGpuModelFilter] = useState('All');
  const [regionFilter, setRegionFilter] = useState('All');
  const [gpus, setGpus] = useState<AvailableGpu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    pageNum: 1,
    pageSize: 10,
  });

  // 获取GPU节点数据 — initial load triggers a cloud sync first so
  // sys_gpu_node gets populated from FlowMesh on first page-open.
  useEffect(() => {
    const fetchGpus = async () => {
      try {
        setLoading(true);
        let response;
        try {
          response = await refreshGpuNodes({}, { pageNum: 1, pageSize: 100 });
        } catch {
          response = await getGpuNodeList({}, { pageNum: 1, pageSize: 100 });
        }

        // 将后端数据转换为前端所需格式
        const formattedGpus = response.rows.map((node) => {
          // 根据GPU型号估算显存大小
          let vram = '16GB';
          if (node.gpuModel?.includes('A100')) vram = '80GB';
          else if (node.gpuModel?.includes('H100')) vram = '80GB';
          else if (node.gpuModel?.includes('4090') || node.gpuModel?.includes('RTX 4090'))
            vram = '24GB';
          else if (node.gpuModel?.includes('3090') || node.gpuModel?.includes('RTX 3090'))
            vram = '24GB';
          else if (node.gpuModel?.includes('V100')) vram = '32GB';

          // 估算价格（基于GPU型号和数量）
          let price = 0.5;
          if (node.gpuModel?.includes('A100')) price = 4.8;
          else if (node.gpuModel?.includes('H100')) price = 24.5;
          else if (node.gpuModel?.includes('4090') || node.gpuModel?.includes('RTX 4090'))
            price = 0.95;
          else if (node.gpuModel?.includes('3090') || node.gpuModel?.includes('RTX 3090'))
            price = 0.28;
          else if (node.gpuModel?.includes('L40S')) price = 1.2;

          return {
            id: node.nodeCode || `node-${node.id}`,
            name: `${node.gpuCount}x ${node.gpuModel}`,
            gpuModel: node.gpuModel || t('gpuRentalList.unknownGpu'),
            gpuCount: node.gpuCount || 1,
            vram: vram,
            cpu: t('gpuRentalList.cpuCores', { count: node.cpuCores || 16 }),
            ram: `${node.memoryGb || 64}GB`,
            storage: '1TB SSD',
            region: node.hostIp || t('gpuRentalList.region.unknown'),
            price: price,
            supplier: t('gpuRentalList.supplier.flowmesh'),
            reliability: 99.5,
          };
        });

        setGpus(formattedGpus);
      } catch (err) {
        console.error('获取GPU节点数据失败:', err);
        setError(t('gpuRentalList.error.fetchFailed'));
        // 使用默认数据作为后备
        setGpus([
          {
            id: 'vm-10293',
            name: t('gpuRentalList.fallback.a100'),
            gpuModel: 'NVIDIA A100',
            gpuCount: 4,
            vram: '80GB',
            cpu: 'AMD EPYC 7742',
            ram: '256GB',
            storage: '2TB NVMe',
            region: t('gpuRentalList.region.usCentral'),
            price: 4.8,
            supplier: t('gpuRentalList.supplier.flowmesh'),
            reliability: 99.9,
          },
          {
            id: 'vm-8821',
            name: t('gpuRentalList.fallback.rtx3090'),
            gpuModel: 'RTX 3090',
            gpuCount: 1,
            vram: '24GB',
            cpu: 'Intel Xeon Gold',
            ram: '64GB',
            storage: '512GB NVMe',
            region: t('gpuRentalList.region.euWest'),
            price: 0.28,
            supplier: 'Vast.ai',
            reliability: 97.5,
          },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchGpus();
  }, [t]);

  // 过滤数据
  const filteredGpus = gpus.filter((gpu) => {
    const matchesSearch =
      gpu.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      gpu.gpuModel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      gpu.region.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesModel = gpuModelFilter === 'All' || gpu.gpuModel.includes(gpuModelFilter);
    const matchesRegion = regionFilter === 'All' || gpu.region.includes(regionFilter);

    return matchesSearch && matchesModel && matchesRegion;
  });

  // 获取唯一GPU型号
  const uniqueModels = Array.from(new Set(gpus.map((g) => g.gpuModel)));

  // 刷新数据 — pulls fresh node state from FlowMesh cloud via the
  // /refresh endpoint (upserts into sys_gpu_node server-side), then
  // falls back to a plain list query if refresh fails (e.g. cloud
  // down) so the UI always shows whatever's persisted locally.
  const refreshData = async () => {
    try {
      // 允许绕过API频率限制
      allowRefresh('/gpuNode/list');

      setLoading(true);
      let response;
      try {
        response = await refreshGpuNodes({}, { pageNum: 1, pageSize: 100 });
      } catch {
        // Cloud sync failed — fall back to the last-known local list.
        response = await getGpuNodeList({}, { pageNum: 1, pageSize: 100 });
      }

      // 将后端数据转换为前端所需格式
      const formattedGpus = response.rows.map((node) => {
        // 根据GPU型号估算显存大小
        let vram = '16GB';
        if (node.gpuModel?.includes('A100')) vram = '80GB';
        else if (node.gpuModel?.includes('H100')) vram = '80GB';
        else if (node.gpuModel?.includes('4090') || node.gpuModel?.includes('RTX 4090'))
          vram = '24GB';
        else if (node.gpuModel?.includes('3090') || node.gpuModel?.includes('RTX 3090'))
          vram = '24GB';
        else if (node.gpuModel?.includes('V100')) vram = '32GB';

        // 估算价格（基于GPU型号和数量）
        let price = 0.5;
        if (node.gpuModel?.includes('A100')) price = 4.8;
        else if (node.gpuModel?.includes('H100')) price = 24.5;
        else if (node.gpuModel?.includes('4090') || node.gpuModel?.includes('RTX 4090'))
          price = 0.95;
        else if (node.gpuModel?.includes('3090') || node.gpuModel?.includes('RTX 3090'))
          price = 0.28;
        else if (node.gpuModel?.includes('L40S')) price = 1.2;

        return {
          id: node.nodeCode || `node-${node.id}`,
          name: `${node.gpuCount}x ${node.gpuModel}`,
          gpuModel: node.gpuModel || t('gpuRentalList.unknownGpu'),
          gpuCount: node.gpuCount || 1,
          vram: vram,
          cpu: t('gpuRentalList.cpuCores', { count: node.cpuCores || 16 }),
          ram: `${node.memoryGb || 64}GB`,
          storage: '1TB SSD',
          region: node.hostIp || t('gpuRentalList.region.unknown'),
          price: price,
          supplier: t('gpuRentalList.supplier.flowmesh'),
          reliability: 99.5,
        };
      });

      setGpus(formattedGpus);
    } catch (err) {
      console.error('刷新GPU节点数据失败:', err);
      setError(t('gpuRentalList.error.refreshFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 计算分页信息
  const totalPages = Math.ceil(filteredGpus.length / pagination.pageSize);
  const startItem = (pagination.pageNum - 1) * pagination.pageSize + 1;
  const endItem = Math.min(pagination.pageNum * pagination.pageSize, filteredGpus.length);
  const paginatedGpus = filteredGpus.slice(startItem - 1, endItem);

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-auto">
      <header className="px-8 py-6 bg-white border-b border-slate-100 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t('gpuRentalList.title')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('gpuRentalList.subtitle')}</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={refreshData}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200 shadow-sm"
          >
            <Icons.Clock className="w-4 h-4" />
            <span>{t('gpuRentalList.refresh')}</span>
          </button>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {/* Filters */}
          <div className="p-4 border-b border-slate-100 flex flex-wrap gap-4 bg-slate-50/50">
            <div className="flex-1 min-w-[300px]">
              <div className="relative">
                <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={t('gpuRentalList.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full bg-white"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 border-l border-slate-200 pl-4 min-w-[180px]">
              <span className="text-xs font-medium text-slate-500 uppercase">
                {t('gpuRentalList.filter.model')}
              </span>
              <select
                className="px-2.5 py-1 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 min-w-[120px]"
                value={gpuModelFilter}
                onChange={(e) => setGpuModelFilter(e.target.value)}
              >
                <option value="All">{t('gpuRentalList.filter.modelAll')}</option>
                {uniqueModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center space-x-2 border-l border-slate-200 pl-4 min-w-[180px]">
              <span className="text-xs font-medium text-slate-500 uppercase">
                {t('gpuRentalList.filter.region')}
              </span>
              <select
                className="px-2.5 py-1 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 min-w-[120px]"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
              >
                <option value="All">{t('gpuRentalList.filter.regionAll')}</option>
                <option value="美东">{t('gpuRentalList.region.usEast')}</option>
                <option value="美西">{t('gpuRentalList.region.usWest')}</option>
                <option value="欧西">{t('gpuRentalList.region.euWest')}</option>
                <option value="亚太">{t('gpuRentalList.region.apac')}</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    GPU
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {t('gpuRentalList.table.specs')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {t('gpuRentalList.table.region')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {t('gpuRentalList.table.supplier')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {t('gpuRentalList.table.price')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {t('gpuRentalList.table.reliability')}
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {t('gpuRentalList.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <div className="flex justify-center items-center">
                        <Icons.Zap className="w-5 h-5 animate-spin text-brand-600" />
                        <span className="ml-2 text-xs text-slate-600">
                          {t('gpuRentalList.loading')}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <Icons.AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                      <p className="text-xs text-slate-600">{error}</p>
                      <button
                        onClick={refreshData}
                        className="mt-3 px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-xs"
                      >
                        {t('gpuRentalList.reload')}
                      </button>
                    </td>
                  </tr>
                ) : paginatedGpus.length > 0 ? (
                  paginatedGpus.map((gpu) => (
                    <tr key={gpu.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center border border-slate-100 text-slate-600 mr-2.5">
                            <Icons.Chip className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-slate-900">{gpu.name}</div>
                            <div className="text-xs text-slate-500">{gpu.gpuModel}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="space-y-0.5">
                          <div className="text-xs text-slate-600 flex items-center">
                            <Icons.Database className="w-3 h-3 mr-1 text-slate-400" />
                            {t('gpuRentalList.specs.vram', { value: gpu.vram })}
                          </div>
                          <div className="text-xs text-slate-600 flex items-center">
                            <Icons.Server className="w-3 h-3 mr-1 text-slate-400" />
                            {t('gpuRentalList.specs.ram', { value: gpu.ram })}
                          </div>
                          <div className="text-xs text-slate-600 flex items-center">
                            <Icons.HardDrive className="w-3 h-3 mr-1 text-slate-400" />
                            {t('gpuRentalList.specs.storage', { value: gpu.storage })}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center text-xs text-slate-600">
                          <Icons.MapPin className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          {getRegionDisplayLabel(gpu.region)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-slate-600">{gpu.supplier}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-bold text-brand-600">
                          ${gpu.price.toFixed(2)}
                        </span>
                        <span className="text-xs text-slate-500">{t('gpuRentalList.perHour')}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                          <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-green-500"></span>
                          {t('gpuRentalList.reliability', { percent: gpu.reliability })}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-medium">
                        <button
                          onClick={() => navigate(`/app/compute/${gpu.id}`)}
                          className="flex items-center space-x-1 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg transition-colors shadow-sm shadow-brand-500/20"
                        >
                          <span>{t('gpuRentalList.deploy')}</span>
                          <Icons.ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <Icons.Box className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <h3 className="text-xs font-medium text-slate-500 mb-1">
                        {t('gpuRentalList.empty.title')}
                      </h3>
                      <p className="text-slate-400 text-xs">{t('gpuRentalList.empty.desc')}</p>
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
            totalItems={filteredGpus.length}
            startItem={startItem}
            endItem={endItem}
            onPageChange={(page) => setPagination({ ...pagination, pageNum: page })}
            onPageSizeChange={(size) => setPagination({ pageNum: 1, pageSize: size })}
            pageSize={pagination.pageSize}
          />
        </div>
      </div>
    </div>
  );
};

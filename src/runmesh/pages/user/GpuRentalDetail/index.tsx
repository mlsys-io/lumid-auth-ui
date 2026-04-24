import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

const getDeployableModels = (t: (key: string) => string) => [
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    tags: [t('gpuRentalDetail.tag.inference'), t('gpuRentalDetail.tag.code')],
    size: '32GB',
  },
  {
    id: 'llama-3-70b',
    name: 'Llama 3 70B',
    tags: [t('gpuRentalDetail.tag.general'), t('gpuRentalDetail.tag.chat')],
    size: '40GB',
  },
  {
    id: 'sdxl-turbo',
    name: 'Stable Diffusion XL',
    tags: [t('gpuRentalDetail.tag.image')],
    size: '12GB',
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    tags: [t('gpuRentalDetail.tag.text')],
    size: '24GB',
  },
  {
    id: 'custom-docker',
    name: t('gpuRentalDetail.model.customDocker'),
    tags: [t('gpuRentalDetail.tag.advanced')],
    size: '-',
  },
];

export const GpuRentalDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [rentalDuration, setRentalDuration] = useState(1);
  const deployableModels = getDeployableModels(t as (key: string) => string);

  // Mock fetching node details based on ID
  const nodeDetails = {
    id: id,
    name: t('gpuRentalDetail.node.name'),
    gpuModel: 'NVIDIA A100',
    gpuCount: 4,
    vram: '80GB',
    cpu: 'AMD EPYC 7742 64-Core',
    ram: '256GB',
    storage: '2TB NVMe',
    region: t('gpuRentalDetail.node.region'),
    price: 4.8,
    supplier: t('gpuRentalDetail.node.supplier'),
    bandwidth: '10 Gbps',
    cudaVersion: '12.2',
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-auto">
      <header className="px-8 py-6 bg-white border-b border-slate-100 flex items-center sticky top-0 z-10">
        <button
          onClick={() => navigate('/app/compute')}
          className="mr-4 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <Icons.ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            {t('gpuRentalDetail.deployTo', { id: nodeDetails.id ?? '' })}
          </h1>
          <div className="flex items-center text-sm text-slate-500 mt-1 space-x-3">
            <span className="flex items-center">
              <Icons.Server className="w-3 h-3 mr-1" /> {nodeDetails.supplier}
            </span>
            <span>•</span>
            <span className="flex items-center">
              <Icons.MapPin className="w-3 h-3 mr-1" /> {nodeDetails.region}
            </span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
        {/* Hardware Specs Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center">
            <Icons.Chip className="w-5 h-5 mr-2 text-brand-600" />
            {t('gpuRentalDetail.hardware.title')}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase mb-1">GPU</p>
              <p className="text-slate-800 font-medium">
                {nodeDetails.gpuCount}x {nodeDetails.gpuModel}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase mb-1">
                {t('gpuRentalDetail.hardware.vram')}
              </p>
              <p className="text-slate-800 font-medium">{nodeDetails.vram} / GPU</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase mb-1">CPU</p>
              <p className="text-slate-800 font-medium">{nodeDetails.cpu}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase mb-1">
                {t('gpuRentalDetail.hardware.ram')}
              </p>
              <p className="text-slate-800 font-medium">{nodeDetails.ram}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase mb-1">
                {t('gpuRentalDetail.hardware.storage')}
              </p>
              <p className="text-slate-800 font-medium">{nodeDetails.storage}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase mb-1">
                {t('gpuRentalDetail.hardware.bandwidth')}
              </p>
              <p className="text-slate-800 font-medium">{nodeDetails.bandwidth}</p>
            </div>
          </div>
        </div>

        {/* Model Selection */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center">
            <Icons.Box className="w-5 h-5 mr-2 text-brand-600" />
            {t('gpuRentalDetail.model.title')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {deployableModels.map((model) => (
              <div
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={`cursor-pointer rounded-xl border p-4 transition-all relative ${
                  selectedModel === model.id
                    ? 'bg-brand-50 border-brand-500 shadow-md ring-1 ring-brand-500'
                    : 'bg-white border-slate-200 hover:border-brand-300 hover:shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold text-slate-800">{model.name}</span>
                  {selectedModel === model.id && (
                    <Icons.CheckCircle className="w-5 h-5 text-brand-600" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {model.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200"
                    >
                      {tag}
                    </span>
                  ))}
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">
                    {model.size}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {selectedModel === 'custom-docker' && (
            <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200 animate-in fade-in">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('gpuRentalDetail.model.dockerUrl')}
              </label>
              <input
                type="text"
                placeholder={t('gpuRentalDetail.model.dockerPlaceholder')}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          )}
        </div>

        {/* Duration & Cost */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center">
            <Icons.Clock className="w-5 h-5 mr-2 text-brand-600" />
            {t('gpuRentalDetail.duration.title')}
          </h2>
          <div className="flex items-center space-x-4 mb-6">
            <input
              type="range"
              min="1"
              max="48"
              value={rentalDuration}
              onChange={(e) => setRentalDuration(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
            />
            <span className="text-slate-800 font-bold w-24 text-right">
              {t('gpuRentalDetail.duration.hours', { hours: rentalDuration })}
            </span>
          </div>

          <div className="bg-slate-900 rounded-xl p-6 text-white flex justify-between items-center">
            <div>
              <p className="text-slate-400 text-sm mb-1">{t('gpuRentalDetail.cost.estimate')}</p>
              <p className="text-3xl font-bold">
                ${(nodeDetails.price * rentalDuration).toFixed(2)}
              </p>
            </div>
            <button className="bg-brand-600 hover:bg-brand-500 text-white px-8 py-3 rounded-lg font-bold text-lg shadow-lg shadow-brand-500/20 flex items-center transition-transform hover:scale-105 active:scale-95">
              <Icons.Rocket className="w-5 h-5 mr-2" />
              {t('gpuRentalDetail.deployNow')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

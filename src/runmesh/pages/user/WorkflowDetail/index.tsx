import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import { getWorkflowMarketItem } from '@/runmesh/api/user/workflowMarketApi';
import { WorkflowMarketItem } from '@/runmesh/types';
import { useLanguage } from '@/runmesh/i18n';

export const WorkflowDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [workflowMarketItem, setWorkflowMarketItem] = useState<WorkflowMarketItem | null>(null);

  // 加载工作流市场数据
  useEffect(() => {
    const loadData = async () => {
      if (!id) return;

      try {
        setLoading(true);
        const data = await getWorkflowMarketItem(Number(id));
        setWorkflowMarketItem(data);
      } catch (error) {
        console.error('加载工作流详情失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, t]);

  // 点击流程预览跳转到 n8n 页面
  const handlePreviewClick = () => {
    if (workflowMarketItem?.workflowId) {
      navigate(`/app/n8n/${workflowMarketItem.workflowId}`);
    } else {
      console.warn('该工作流没有关联的 workflowId');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  // Mock Detail Data
  const workflow = {
    id: id,
    name: workflowMarketItem?.name || t('workflowDetail.default.name'),
    description: workflowMarketItem?.description || t('workflowDetail.default.description'),
    author: workflowMarketItem?.creator || t('workflowDetail.default.author'),
    category: workflowMarketItem?.appType || t('workflowDetail.default.category'),
    publishedAt: workflowMarketItem?.createTime
      ? new Date(workflowMarketItem.createTime).toLocaleDateString()
      : t('workflowDetail.default.publishedAt'),
    uses: workflowMarketItem?.useCount || 12543,
    stars: workflowMarketItem?.favoriteCount || 456,
    forks: workflowMarketItem?.downloads || 89,
    tags: workflowMarketItem?.tags
      ? workflowMarketItem.tags.split(',').map((tag) => tag.trim())
      : [t('workflowDetail.default.tag1'), t('workflowDetail.default.tag2'), 'RAG', 'Agent'],
    inputs: [
      { name: 'query', type: 'String', desc: t('workflowDetail.input.queryDesc'), required: true },
      { name: 'depth', type: 'Number', desc: t('workflowDetail.input.depthDesc'), required: false },
    ],
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-auto">
      {/* Header */}
      <header className="px-8 py-6 bg-white border-b border-slate-100 flex items-center sticky top-0 z-10 justify-between">
        <div className="flex items-center">
          <button
            onClick={() => navigate('/app/market')}
            className="mr-4 text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-100"
          >
            <Icons.ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <h1 className="text-xl font-bold text-slate-800">{workflow.name}</h1>
        </div>
        <div className="flex space-x-3">
          <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center shadow-sm">
            <Icons.Share2 className="w-4 h-4 mr-2" />
            {t('workflowDetail.action.share')}
          </button>
          <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 shadow-sm flex items-center">
            <Icons.Copy className="w-4 h-4 mr-2" />
            {t('workflowDetail.action.useTemplate')}
          </button>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Description Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
            <div className="flex items-center space-x-2 mb-4">
              <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded text-xs font-semibold">
                {workflow.category}
              </span>
              {workflow.tags.map((tag) => (
                <span key={tag} className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded text-xs">
                  #{tag}
                </span>
              ))}
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">{workflow.name}</h2>
            <p className="text-slate-600 leading-relaxed mb-6">{workflow.description}</p>

            <div className="flex items-center space-x-6 pt-6 border-t border-slate-100 text-sm text-slate-500">
              <div className="flex items-center">
                <Icons.Play className="w-4 h-4 mr-1.5" />
                <span className="font-semibold text-slate-700 mr-1">
                  {workflow.uses.toLocaleString()}
                </span>{' '}
                {t('workflowDetail.stats.runs')}
              </div>
              <div className="flex items-center">
                <Icons.Star className="w-4 h-4 mr-1.5" />
                <span className="font-semibold text-slate-700 mr-1">{workflow.stars}</span>{' '}
                {t('workflowDetail.stats.favorites')}
              </div>
              <div className="flex items-center">
                <Icons.GitFork className="w-4 h-4 mr-1.5" />
                <span className="font-semibold text-slate-700 mr-1">{workflow.forks}</span>{' '}
                {t('workflowDetail.stats.forks')}
              </div>
              <div className="flex items-center">
                <Icons.Clock className="w-4 h-4 mr-1.5" />
                {t('workflowDetail.stats.publishedAt', { date: workflow.publishedAt })}
              </div>
            </div>
          </div>

          {/* Workflow Preview */}
          <div
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-lg transition-shadow duration-200"
            onClick={handlePreviewClick}
            title={t('workflowDetail.preview.viewFull')}
          >
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">{t('workflowDetail.preview.title')}</h3>
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Icons.ChevronRight className="w-4 h-4" />
                {t('workflowDetail.preview.viewFull')}
              </span>
            </div>
            <div className="h-80 bg-slate-50 relative flex items-center justify-center overflow-hidden group">
              {/* Dotted Background */}
              <div
                className="absolute inset-0 z-0 opacity-40 group-hover:opacity-60 transition-opacity"
                style={{
                  backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              ></div>

              {/* Abstract Node Graph Representation */}
              <div className="relative z-10 flex items-center space-x-12 opacity-80 scale-90 group-hover:scale-95 transition-transform duration-200">
                {/* Start */}
                <div className="w-32 h-16 bg-white border-2 border-green-200 rounded-lg shadow-sm flex items-center justify-center space-x-2">
                  <div className="w-6 h-6 bg-green-100 rounded flex items-center justify-center text-green-600">
                    <Icons.Play className="w-3 h-3" />
                  </div>
                  <span className="font-bold text-slate-700">
                    {t('workflowDetail.preview.start')}
                  </span>
                </div>
                {/* Arrow */}
                <div className="w-12 h-0.5 bg-slate-300 relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 border-t-2 border-r-2 border-slate-300 rotate-45"></div>
                </div>
                {/* Node 1 */}
                <div className="w-40 h-20 bg-white border-2 border-blue-200 rounded-lg shadow-sm flex flex-col items-center justify-center">
                  <div className="flex items-center space-x-2 mb-1">
                    <Icons.Search className="w-4 h-4 text-blue-500" />
                    <span className="font-bold text-slate-700">
                      {t('workflowDetail.preview.node.googleSearch')}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {t('workflowDetail.preview.node.toolCall')}
                  </span>
                </div>
                {/* Arrow */}
                <div className="w-12 h-0.5 bg-slate-300 relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 border-t-2 border-r-2 border-slate-300 rotate-45"></div>
                </div>
                {/* Node 2 */}
                <div className="w-40 h-20 bg-white border-2 border-indigo-200 rounded-lg shadow-sm flex flex-col items-center justify-center">
                  <div className="flex items-center space-x-2 mb-1">
                    <Icons.Chip className="w-4 h-4 text-indigo-500" />
                    <span className="font-bold text-slate-700">
                      {t('workflowDetail.preview.node.deepseekR1')}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {t('workflowDetail.preview.node.reasoning')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Author Profile */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
              {t('workflowDetail.author.title')}
            </h3>
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-lg border border-indigo-200">
                {workflow.author.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-slate-900">{workflow.author}</p>
                <p className="text-xs text-slate-500">{t('workflowDetail.author.badge')}</p>
              </div>
            </div>
            <button className="w-full mt-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
              {t('workflowDetail.author.viewProfile')}
            </button>
          </div>

          {/* Inputs */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
              {t('workflowDetail.inputs.title')}
            </h3>
            <div className="space-y-4">
              {workflow.inputs.map((input, idx) => (
                <div key={idx} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-mono text-sm font-bold text-slate-700">{input.name}</span>
                    <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 rounded">
                      {input.type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{input.desc}</p>
                  {input.required && (
                    <span className="text-[10px] text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                      {t('workflowDetail.inputs.required')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

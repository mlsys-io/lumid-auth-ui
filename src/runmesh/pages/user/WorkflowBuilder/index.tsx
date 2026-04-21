import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import { getWorkflowDetail, updateWorkflow, createWorkflow } from '@/runmesh/api/user/workflow';
import { WorkflowItem } from '@/runmesh/api/user/workflow';
import { allowRefresh } from '@/runmesh/utils/apiRateLimiter';
import { useEnterpriseTip } from '@/runmesh/components/EnterpriseTip';
import { useLanguage } from '@/runmesh/i18n';

type NodeType = 'webhook' | 'http' | 'sheets' | 'slack' | 'if' | 'schedule';

interface WorkflowNode {
  id: string;
  type: NodeType;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  active: boolean;
}

export const WorkflowBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const { success, error: tipError, warning } = useEnterpriseTip();
  const { t } = useLanguage();
  const [isActive, setIsActive] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workflowData, setWorkflowData] = useState<WorkflowItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);

  const loadWorkflow = async () => {
    if (!id) return;

    // 允许绕过API频率限制
    allowRefresh('/workflow/detail');

    setLoading(true);
    setError(null);
    try {
      const workflowId = parseInt(id);

      if (isNaN(workflowId)) {
        throw new Error(t('workflowBuilder.error.invalidId', { id }));
      }

      const workflow = await getWorkflowDetail(workflowId);
      setWorkflowData(workflow);
      setIsActive(workflow.status === '1');

      // 尝试解析工作流配置并设置节点
      if (workflow.definitionJson) {
        try {
          const workflowConfig = JSON.parse(workflow.definitionJson);

          // 如果配置中有节点数据，则更新节点
          if (workflowConfig.nodes && Array.isArray(workflowConfig.nodes)) {
            const parsedNodes = workflowConfig.nodes.map((node: any) => ({
              id: node.id || Math.random().toString(36).substr(2, 9),
              type: node.type || 'webhook',
              title: node.title || node.name || t('workflowBuilder.node.defaultTitle'),
              subtitle: node.subtitle || node.description || '',
              x: node.x || Math.random() * 1000,
              y: node.y || Math.random() * 500,
              active: node.active !== false,
            }));

            if (parsedNodes.length > 0) {
              setNodes(parsedNodes);
            }
          }
        } catch {
          // 如果解析失败，继续使用默认节点
        }
      }
    } catch (error) {
      console.error('加载工作流失败:', error);
      setError(
        t('workflowBuilder.error.loadFailed', {
          reason: error instanceof Error ? error.message : t('workflowBuilder.error.unknown'),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  // 加载现有工作流数据
  useEffect(() => {
    if (id) {
      loadWorkflow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 保存工作流
  const handleSave = async () => {
    if (!id) {
      // 新建工作流的情况，创建新工作流
      await createNewWorkflow();
      return;
    }

    if (!workflowData) {
      tipError(t('workflowBuilder.error.dataMissing'));
      return;
    }

    // 验证工作流名称
    if (!workflowData.name || workflowData.name.trim() === '') {
      warning(t('workflowBuilder.validation.nameRequired'));
      return;
    }

    // 验证节点数据
    if (!nodes || nodes.length === 0) {
      warning(t('workflowBuilder.validation.nodeRequired'));
      return;
    }

    setSaving(true);
    try {
      // 构建工作流配置
      const workflowConfig = {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type,
          name: node.title,
          description: node.subtitle,
          x: node.x,
          y: node.y,
          active: node.active,
        })),
        connections: [], // 可以在这里添加连接信息
        metadata: {
          lastModified: new Date().toISOString(),
          version: (workflowData.version || 1) + 1,
        },
      };

      // 构建更新数据 - 包含所有必需字段
      const updateData = {
        workflowId: parseInt(id),
        name: workflowData.name,
        description: workflowData.description,
        definitionJson: JSON.stringify(workflowConfig),
        version: workflowData.version || 1,
        publishStatus: workflowData.publishStatus || '0',
        status: workflowData.status || '0',
        remark: workflowData.remark || '',
        appType: workflowData.appType || '0',
        icon: workflowData.icon || '',
        tags: workflowData.tags || '',
        isTemplate: workflowData.isTemplate || '0',
      };

      await updateWorkflow(updateData);

      // 更新本地数据
      setWorkflowData((prev) =>
        prev
          ? {
              ...prev,
              version: (prev.version || 1) + 1,
              updateTime: new Date().toISOString(),
            }
          : null,
      );

      success(t('workflowBuilder.success.saved'));
    } catch (error) {
      console.error('保存工作流失败:', error);
      tipError(
        t('workflowBuilder.error.saveFailed', {
          reason: error instanceof Error ? error.message : t('workflowBuilder.error.unknown'),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  // 创建新工作流
  const createNewWorkflow = async () => {
    // 验证工作流名称
    if (!workflowData || !workflowData.name || workflowData.name.trim() === '') {
      warning(t('workflowBuilder.validation.nameRequired'));
      return;
    }

    // 验证节点数据
    if (!nodes || nodes.length === 0) {
      warning(t('workflowBuilder.validation.nodeRequired'));
      return;
    }

    setSaving(true);
    try {
      // 构建工作流配置
      const workflowConfig = {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type,
          name: node.title,
          description: node.subtitle,
          x: node.x,
          y: node.y,
          active: node.active,
        })),
        connections: [], // 可以在这里添加连接信息
        metadata: {
          lastModified: new Date().toISOString(),
          version: 1,
        },
      };

      // 构建创建数据 - 设置默认publishStatus为'3'（草稿）
      const createData = {
        name: workflowData.name,
        description: workflowData.description || '',
        definitionJson: JSON.stringify(workflowConfig),
        version: 1,
        publishStatus: '3', // 默认设置为草稿状态
        status: '1', // 默认设置为启用状态
        remark: workflowData.remark || '',
        appType: workflowData.appType || 'workflow',
        icon: workflowData.icon || '',
        tags: workflowData.tags || '',
        isTemplate: workflowData.isTemplate || '0',
      };

      const result = await createWorkflow(createData);

      // 更新本地数据并设置ID
      const newWorkflowData: WorkflowItem = {
        ...createData,
        workflowId: result,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        downloads: 0,
        createBy: 0,
      };
      setWorkflowData(newWorkflowData);

      // 更新URL参数，使其包含新创建的工作流ID
      navigate(`/app/n8n/${result}`);

      success(t('workflowBuilder.success.created'));
    } catch (error) {
      console.error('创建工作流失败:', error);
      tipError(
        t('workflowBuilder.error.createFailed', {
          reason: error instanceof Error ? error.message : t('workflowBuilder.error.unknown'),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleNodeClick = (node: WorkflowNode) => {
    setSelectedNode(node);
    setShowConfig(true);
  };

  const getIconForType = (type: NodeType) => {
    switch (type) {
      case 'webhook':
        return <Icons.Webhook className="w-5 h-5 text-orange-600" />;
      case 'http':
        return <Icons.Globe className="w-5 h-5 text-blue-600" />;
      case 'sheets':
        return <Icons.Sheets className="w-5 h-5 text-green-600" />;
      case 'slack':
        return <Icons.Slack className="w-5 h-5 text-purple-600" />;
      case 'if':
        return <Icons.Split className="w-5 h-5 text-yellow-600" />;
      case 'schedule':
        return <Icons.Clock className="w-5 h-5 text-gray-600" />;
      default:
        return <Icons.Box className="w-5 h-5 text-gray-600" />;
    }
  };

  const getNodeColor = (type: NodeType) => {
    switch (type) {
      case 'webhook':
        return 'bg-orange-50 border-orange-200 group-hover:border-orange-400';
      case 'http':
        return 'bg-blue-50 border-blue-200 group-hover:border-blue-400';
      case 'sheets':
        return 'bg-green-50 border-green-200 group-hover:border-green-400';
      case 'slack':
        return 'bg-purple-50 border-purple-200 group-hover:border-purple-400';
      case 'if':
        return 'bg-yellow-50 border-yellow-200 group-hover:border-yellow-400';
      default:
        return 'bg-white border-slate-200 group-hover:border-slate-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="text-center">
          <Icons.AlertCircle className="w-8 h-8 text-brand-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">{t('workflowBuilder.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="text-center">
          <Icons.AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700 transition-colors"
          >
            {t('workflowBuilder.action.back')}
          </button>
        </div>
      </div>
    );
  }

  // 添加新节点到画布
  const addNodeToCanvas = (type: NodeType, title: string, subtitle: string) => {
    // 计算新节点的位置，避免与其他节点重叠
    const baseX = 100;
    const baseY = 100;
    const spacing = 220; // 节点之间的间距
    const nodesPerRow = 4;

    const newNodeCount = nodes.length;
    const newRow = Math.floor(newNodeCount / nodesPerRow);
    const newIndexInRow = newNodeCount % nodesPerRow;

    const x = baseX + newIndexInRow * spacing;
    const y = baseY + newRow * 100;

    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type,
      title,
      subtitle,
      x,
      y,
      active: true,
    };
    setNodes((prev) => [...prev, newNode]);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-100 overflow-hidden">
      {/* 1. n8n Style Header */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-50 shadow-sm">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(-1)}
            className="p-1 hover:bg-slate-100 rounded text-slate-500"
          >
            <Icons.ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-slate-800 text-sm">
                {workflowData
                  ? workflowData.name
                  : id
                    ? t('workflowBuilder.title.edit')
                    : t('workflowBuilder.title.create')}
              </span>
              {id && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 font-medium">
                  {t('workflowBuilder.label.id', { id })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Active Switch */}
          <div className="flex items-center space-x-2 mr-4">
            <span
              className={`text-xs font-semibold ${isActive ? 'text-green-600' : 'text-slate-400'}`}
            >
              {isActive ? t('workflowBuilder.status.active') : t('workflowBuilder.status.inactive')}
            </span>
            <button
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${isActive ? 'bg-green-500' : 'bg-slate-300'}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ease-in-out ${isActive ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </button>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icons.Save className="w-4 h-4" />
            <span>
              {saving ? t('workflowBuilder.action.saving') : t('workflowBuilder.action.save')}
            </span>
          </button>

          <button className="flex items-center space-x-1 px-4 py-1.5 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors shadow-sm shadow-brand-500/30">
            <Icons.PlayCircle className="w-4 h-4" />
            <span>{t('workflowBuilder.action.execute')}</span>
          </button>
        </div>
      </header>

      {/* 节点工具栏 */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 z-40 shadow-sm overflow-x-auto">
        <div className="flex items-center space-x-3">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
            {t('workflowBuilder.toolbar.addNode')}
          </span>

          <button
            onClick={() =>
              addNodeToCanvas(
                'webhook',
                t('workflowBuilder.node.webhook.title'),
                t('workflowBuilder.node.webhook.subtitle'),
              )
            }
            className="flex flex-col items-center space-y-1 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors min-w-[60px]"
            title={t('workflowBuilder.node.webhook.title')}
          >
            <div className="text-orange-600">
              <Icons.Webhook className="w-5 h-5" />
            </div>
            <span className="text-xs text-slate-600">
              {t('workflowBuilder.node.webhook.label')}
            </span>
          </button>

          <button
            onClick={() =>
              addNodeToCanvas(
                'sheets',
                t('workflowBuilder.node.sheets.title'),
                t('workflowBuilder.node.sheets.subtitle'),
              )
            }
            className="flex flex-col items-center space-y-1 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors min-w-[60px]"
            title={t('workflowBuilder.node.sheets.title')}
          >
            <div className="text-green-600">
              <Icons.Sheets className="w-5 h-5" />
            </div>
            <span className="text-xs text-slate-600">{t('workflowBuilder.node.sheets.label')}</span>
          </button>

          <button
            onClick={() =>
              addNodeToCanvas(
                'http',
                t('workflowBuilder.node.http.title'),
                t('workflowBuilder.node.http.subtitle'),
              )
            }
            className="flex flex-col items-center space-y-1 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors min-w-[60px]"
            title={t('workflowBuilder.node.http.title')}
          >
            <div className="text-blue-600">
              <Icons.Globe className="w-5 h-5" />
            </div>
            <span className="text-xs text-slate-600">{t('workflowBuilder.node.http.label')}</span>
          </button>

          <button
            onClick={() =>
              addNodeToCanvas(
                'slack',
                t('workflowBuilder.node.slack.title'),
                t('workflowBuilder.node.slack.subtitle'),
              )
            }
            className="flex flex-col items-center space-y-1 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors min-w-[60px]"
            title={t('workflowBuilder.node.slack.title')}
          >
            <div className="text-purple-600">
              <Icons.Slack className="w-5 h-5" />
            </div>
            <span className="text-xs text-slate-600">{t('workflowBuilder.node.slack.label')}</span>
          </button>

          <button
            onClick={() =>
              addNodeToCanvas(
                'if',
                t('workflowBuilder.node.if.title'),
                t('workflowBuilder.node.if.subtitle'),
              )
            }
            className="flex flex-col items-center space-y-1 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors min-w-[60px]"
            title={t('workflowBuilder.node.if.title')}
          >
            <div className="text-yellow-600">
              <Icons.Split className="w-5 h-5" />
            </div>
            <span className="text-xs text-slate-600">{t('workflowBuilder.node.if.label')}</span>
          </button>

          <button
            onClick={() =>
              addNodeToCanvas(
                'schedule',
                t('workflowBuilder.node.schedule.title'),
                t('workflowBuilder.node.schedule.subtitle'),
              )
            }
            className="flex flex-col items-center space-y-1 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors min-w-[60px]"
            title={t('workflowBuilder.node.schedule.title')}
          >
            <div className="text-gray-600">
              <Icons.Clock className="w-5 h-5" />
            </div>
            <span className="text-xs text-slate-600">
              {t('workflowBuilder.node.schedule.label')}
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Canvas */}
        <div
          className="absolute inset-0 z-0 bg-slate-50 cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: 'radial-gradient(#cbd5e1 1.5px, transparent 1.5px)',
            backgroundSize: '24px 24px',
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Render Nodes */}
          {nodes.map((node) => (
            <div
              key={node.id}
              onClick={() => handleNodeClick(node)}
              className={`absolute w-[200px] h-[80px] rounded-lg shadow-sm border transition-all duration-200 cursor-pointer group flex overflow-hidden bg-white hover:shadow-md ${getNodeColor(node.type)} ${selectedNode?.id === node.id ? 'ring-2 ring-brand-500' : ''}`}
              style={{ left: node.x, top: node.y }}
            >
              {/* Left Icon Strip */}
              <div className="w-12 h-full flex items-center justify-center border-r border-inherit bg-opacity-50">
                {getIconForType(node.type)}
              </div>

              {/* Content */}
              <div className="flex-1 p-3 flex flex-col justify-center">
                <span className="font-bold text-slate-800 text-sm truncate">{node.title}</span>
                <span className="text-[10px] text-slate-500 truncate">{node.subtitle}</span>
              </div>

              {/* Hover Actions */}
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-red-500">
                  <Icons.Trash className="w-3 h-3" />
                </button>
              </div>

              {/* Connector Dots */}
              <div className="absolute top-1/2 -left-1.5 w-3 h-3 bg-white border-2 border-slate-300 rounded-full transform -translate-y-1/2 hover:border-brand-500 hover:scale-125 transition-all z-10"></div>
              <div className="absolute top-1/2 -right-1.5 w-3 h-3 bg-white border-2 border-slate-300 rounded-full transform -translate-y-1/2 hover:border-brand-500 hover:scale-125 transition-all z-10"></div>
            </div>
          ))}
        </div>

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-6 left-6 flex items-center space-x-2 bg-white rounded-full shadow-lg border border-slate-200 p-1.5 z-20">
          <button
            onClick={() => setZoomLevel((z) => Math.max(z - 10, 50))}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-500"
          >
            <Icons.ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-medium w-8 text-center text-slate-600">
            {zoomLevel}%
          </span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(z + 10, 200))}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-500"
          >
            <Icons.ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1"></div>
          <button
            className="p-2 hover:bg-slate-100 rounded-full text-slate-500"
            title={t('workflowBuilder.canvas.fitToScreen')}
          >
            <Icons.Maximize className="w-4 h-4" />
          </button>
        </div>

        {/* Right Configuration Panel (Drawer) */}
        <div
          className={`absolute top-0 right-0 h-full w-[400px] bg-white border-l border-slate-200 shadow-xl transform transition-transform duration-300 z-40 flex flex-col ${showConfig ? 'translate-x-0' : 'translate-x-full'}`}
        >
          {selectedNode ? (
            <>
              {/* Panel Header */}
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 bg-white border border-slate-200 rounded-md shadow-sm text-brand-600">
                    {getIconForType(selectedNode.type)}
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">{selectedNode.title}</h2>
                    <p className="text-xs text-slate-500">
                      {t('workflowBuilder.label.id', { id: selectedNode.id })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowConfig(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded"
                >
                  <Icons.X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-200 px-6">
                <button className="py-3 text-xs font-semibold text-brand-600 border-b-2 border-brand-600 mr-6">
                  {t('workflowBuilder.panel.tabs.parameters')}
                </button>
                <button className="py-3 text-xs font-semibold text-slate-500 hover:text-slate-800 mr-6">
                  {t('workflowBuilder.panel.tabs.settings')}
                </button>
                <button className="py-3 text-xs font-semibold text-slate-500 hover:text-slate-800">
                  {t('workflowBuilder.panel.tabs.output')}
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {selectedNode.type === 'http' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.http.requestMethod')}
                      </label>
                      <select className="w-full text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500">
                        <option>GET</option>
                        <option>POST</option>
                        <option>PUT</option>
                        <option>DELETE</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.http.url')}
                      </label>
                      <input
                        type="text"
                        className="w-full text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500"
                        placeholder={t('workflowBuilder.panel.http.urlPlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.http.auth')}
                      </label>
                      <select className="w-full text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500">
                        <option>{t('workflowBuilder.panel.http.authNone')}</option>
                        <option>{t('workflowBuilder.panel.http.authBasic')}</option>
                        <option>{t('workflowBuilder.panel.http.authBearer')}</option>
                        <option>{t('workflowBuilder.panel.http.authHeader')}</option>
                      </select>
                    </div>
                  </div>
                )}

                {selectedNode.type === 'sheets' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-green-50 text-green-700 text-xs rounded border border-green-200 flex items-center">
                      <Icons.CheckCircle className="w-4 h-4 mr-2" />
                      {t('workflowBuilder.panel.sheets.credentialConnected')}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.sheets.resource')}
                      </label>
                      <select className="w-full text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500">
                        <option>{t('workflowBuilder.panel.sheets.resourceSpreadsheet')}</option>
                        <option>{t('workflowBuilder.panel.sheets.resourceSheet')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.sheets.operation')}
                      </label>
                      <select className="w-full text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500">
                        <option>{t('workflowBuilder.panel.sheets.operationRead')}</option>
                        <option>{t('workflowBuilder.panel.sheets.operationAppend')}</option>
                        <option>{t('workflowBuilder.panel.sheets.operationUpdate')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.sheets.spreadsheetId')}
                      </label>
                      <input
                        type="text"
                        className="w-full text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500"
                        placeholder={t('workflowBuilder.panel.sheets.spreadsheetIdPlaceholder')}
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === 'if' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('workflowBuilder.panel.if.condition1')}
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          className="flex-1 text-sm border-slate-200 rounded-md p-2"
                          placeholder={t('workflowBuilder.panel.if.value1')}
                        />
                        <select className="w-20 text-sm border-slate-200 rounded-md p-2">
                          <option>==</option>
                          <option>!=</option>
                          <option>&gt;</option>
                          <option>&lt;</option>
                        </select>
                        <input
                          type="text"
                          className="flex-1 text-sm border-slate-200 rounded-md p-2"
                          placeholder={t('workflowBuilder.panel.if.value2')}
                        />
                      </div>
                    </div>
                    <button className="text-xs text-brand-600 font-medium hover:underline">
                      {t('workflowBuilder.panel.if.addCondition')}
                    </button>
                  </div>
                )}

                <div className="pt-6 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t('workflowBuilder.panel.notes.label')}
                  </label>
                  <textarea
                    className="w-full h-20 text-sm border-slate-200 rounded-md p-2 bg-white focus:ring-2 focus:ring-brand-500 resize-none"
                    placeholder={t('workflowBuilder.panel.notes.placeholder')}
                  ></textarea>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              {t('workflowBuilder.panel.empty')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import {
  getWorkflowMarketList,
  addWorkflowToMarket,
  updateWorkflowMarketItem,
  getWorkflowMarketItem,
} from '@/runmesh/api/user/workflowMarketApi';
import {
  favoriteWorkflow,
  unfavoriteWorkflow,
  updateWorkflow,
  getWorkflowTypes,
  getFavoriteStatus,
  getFavoriteCount,
  incrementWorkflowUse,
  createWorkflow,
} from '@/runmesh/api/user/workflow';
import type { WorkflowType } from '@/runmesh/api/user/workflow';
import { WorkflowMarketItem, mapBackendToWorkflowMarketItem } from '@/runmesh/types';
import { allowRefresh } from '@/runmesh/utils/apiRateLimiter';
import { useEnterpriseTip } from '@/runmesh/components/EnterpriseTip';
import { generateWorkflowId } from '@/runmesh/utils/index';
import { useLanguage } from '@/runmesh/i18n';

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryCode?: string;
  tags?: string;
  author: string;
  uses: number;
  stars: number;
  icon: React.ReactNode;
  definitionJson?: string;
  workflowId?: string | number;
  favoriteId?: string | number;
  displayWorkflowId?: string;
}

interface TableDataInfo<T> {
  rows: T[];
  total: number;
  code: number;
  msg: string;
}

const toNumberId = (val: any): number | undefined => {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const isNumericString = (val?: string | number) =>
  val !== undefined && val !== null && /^\d+$/.test(String(val));

const DEFAULT_TYPE_CONFIG = [
  { code: '搜索增强', key: 'workflowMarket.type.searchEnhance' },
  { code: '内容创作', key: 'workflowMarket.type.contentCreation' },
  { code: '编程开发', key: 'workflowMarket.type.programming' },
  { code: '社交媒体', key: 'workflowMarket.type.socialMedia' },
  { code: '翻译', key: 'workflowMarket.type.translation' },
  { code: '图像生成', key: 'workflowMarket.type.imageGeneration' },
  { code: '人力资源', key: 'workflowMarket.type.hr' },
  { code: '其他', key: 'workflowMarket.type.other' },
];

const getDefaultWorkflowTypes = (t: (key: string) => string): WorkflowType[] =>
  DEFAULT_TYPE_CONFIG.map((item, index) => ({
    typeId: index + 1,
    typeCode: item.code, // 兜底时使用名称作为编码，保持与历史行为一致
    typeName: t(item.key),
  }));

export const WorkflowMarket: React.FC = () => {
  const navigate = useNavigate();
  const { success: tipSuccess, error: tipError, warning: tipWarning } = useEnterpriseTip();
  const { t, language } = useLanguage();
  const [selectedTypeCode, setSelectedTypeCode] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [workflowData, setWorkflowData] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showReuseModal, setShowReuseModal] = useState(false);
  const [reuseData, setReuseData] = useState<{
    wf: WorkflowTemplate | null;
    name: string;
    description: string;
  }>({ wf: null, name: '', description: '' });
  const [editingItem, setEditingItem] = useState<WorkflowMarketItem | null>(null);
  const [favoriteState, setFavoriteState] = useState<Record<string, boolean>>({});
  const [favoriteCountState, setFavoriteCountState] = useState<Record<string, number>>({});
  const [workflowTypes, setWorkflowTypes] = useState<WorkflowType[]>(() =>
    getDefaultWorkflowTypes(t as (key: string) => string),
  );
  const [authToken, setAuthToken] = useState<string>(localStorage.getItem('token') || '');
  const [formData, setFormData] = useState<Partial<WorkflowMarketItem>>({
    name: '',
    description: '',
    appType: '',
    status: '0',
    publishStatus: '0',
    isTemplate: '1',
    downloads: 0,
    useCount: 0,
    favoriteCount: 0,
    creator: '', // 初始化为空，后续在打开表单时设置
    definitionJson: '{}', // 确保提供默认值
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.command === 'previewPageReady') {
          setIframeReady(true);
        }
      } catch {
        // Not JSON or other message
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (showReuseModal && iframeReady && reuseData.wf?.definitionJson && iframeRef.current) {
      try {
        const workflow = JSON.parse(reuseData.wf.definitionJson);
        iframeRef.current.contentWindow?.postMessage(
          {
            command: 'previewWorkflow',
            workflow,
          },
          '*',
        );
      } catch (e) {
        console.error('Failed to parse workflow JSON:', e);
      }
    }
  }, [showReuseModal, iframeReady, reuseData.wf?.definitionJson]);

  // 当关闭弹窗时，重置 iframeReady
  useEffect(() => {
    if (!showReuseModal) {
      setIframeReady(false);
    }
  }, [showReuseModal]);

  const categoryOptions = [
    { typeCode: '', typeName: t('workflowMarket.filter.all') },
    ...workflowTypes,
  ];
  const typeNameMap = useMemo(
    () => new Map(workflowTypes.map((t) => [t.typeCode, t.typeName || t.typeCode])),
    [workflowTypes],
  );

  const transformToTemplates = (
    rows: any[],
    localTypeNameMap: Map<string, string>,
  ): WorkflowTemplate[] =>
    rows.map((item: any) => {
      const mappedItem: WorkflowMarketItem = mapBackendToWorkflowMarketItem(item);

      const displayCategory =
        localTypeNameMap.get(mappedItem.appType || '') ||
        mappedItem.appType ||
        t('workflowMarket.type.other');
      const categoryKey = displayCategory.toLowerCase();
      let iconComponent: React.ReactNode;
      switch (categoryKey) {
        case 'search':
        case 'search enhance':
        case 'search enhancement':
        case '搜索增强':
          iconComponent = <Icons.Search className="w-6 h-6 text-blue-600" />;
          break;
        case 'content':
        case 'content creation':
        case '内容创作':
          iconComponent = <Icons.FileText className="w-6 h-6 text-orange-600" />;
          break;
        case 'development':
        case 'programming':
        case '编程开发':
          iconComponent = <Icons.Terminal className="w-6 h-6 text-green-600" />;
          break;
        case 'social media':
        case '社交媒体':
          iconComponent = <Icons.MessageSquare className="w-6 h-6 text-pink-600" />;
          break;
        case 'translation':
        case '翻译':
          iconComponent = <Icons.Globe className="w-6 h-6 text-cyan-600" />;
          break;
        case 'image generation':
        case '图像生成':
          iconComponent = <Icons.Image className="w-6 h-6 text-purple-600" />;
          break;
        case 'human resources':
        case '人力资源':
          iconComponent = <Icons.Workflow className="w-6 h-6 text-amber-600" />;
          break;
        case 'other':
        case '其他':
          iconComponent = <Icons.Workflow className="w-6 h-6 text-indigo-600" />;
          break;
        default:
          iconComponent = <Icons.Workflow className="w-6 h-6 text-indigo-600" />;
      }

      const definitionJson =
        typeof mappedItem.definitionJson === 'string'
          ? mappedItem.definitionJson
          : mappedItem.definitionJson
            ? JSON.stringify(mappedItem.definitionJson)
            : '{}';

      return {
        id: mappedItem.workflowMarketId?.toString() || '',
        name: mappedItem.name || t('workflowMarket.item.unnamed'),
        description: mappedItem.description || t('workflowMarket.item.noDescription'),
        category: displayCategory,
        categoryCode: mappedItem.appType || undefined,
        tags: mappedItem.tags || '',
        author: mappedItem.creator || t('workflowMarket.item.unknownAuthor'),
        uses: mappedItem.useCount || 0,
        stars: mappedItem.favoriteCount || 0,
        icon: iconComponent,
        definitionJson,
        workflowId: mappedItem.workflowId, // 原始字符串用于显示
        favoriteId: mappedItem.workflowMarketId ? String(mappedItem.workflowMarketId) : undefined, // 后端收藏用数值ID
        displayWorkflowId:
          typeof mappedItem.workflowId === 'string' ? mappedItem.workflowId : undefined,
      };
    });

  // 预加载收藏状态与数量（基于 favoriteId，即 workflowMarketId 数字）
  const preloadFavoriteMeta = async (templates: WorkflowTemplate[]) => {
    const entries = templates
      .map((t) => ({
        cardId: t.id,
        favId: t.favoriteId,
      }))
      .filter((e) => e.favId !== undefined && e.favId !== null && isNumericString(String(e.favId)));

    if (!entries.length) {
      setFavoriteState({});
      setFavoriteCountState({});
      return;
    }

    try {
      const results = await Promise.all(
        entries.map(async ({ cardId, favId }) => {
          const idStr = String(favId);
          try {
            const [status, count] = await Promise.all([
              getFavoriteStatus(idStr),
              getFavoriteCount(idStr),
            ]);
            return {
              cardId,
              status: Boolean(status),
              count: typeof count === 'number' ? count : 0,
            };
          } catch (error) {
            console.error('获取收藏状态失败', cardId, favId, error);
            return { cardId, status: false, count: 0 };
          }
        }),
      );

      setFavoriteState((prev) => {
        const next = { ...prev };
        results.forEach((r) => (next[r.cardId] = r.status));
        return next;
      });

      setFavoriteCountState((prev) => {
        const next = { ...prev };
        results.forEach((r) => (next[r.cardId] = r.count));
        return next;
      });
    } catch (error) {
      console.error('批量获取收藏信息失败', error);
    }
  };

  // 监听 token 变化（storage 事件）
  useEffect(() => {
    const handleStorage = () => {
      const nextToken = localStorage.getItem('token') || '';
      if (nextToken !== authToken) {
        setAuthToken(nextToken);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [authToken]);

  // token 变化时清空收藏状态并刷新列表
  useEffect(() => {
    setFavoriteState({});
    setFavoriteCountState({});
    refreshWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  // 当 workflowData 变化且存在卡片时预取收藏状态/数量
  useEffect(() => {
    if (workflowData.length > 0) {
      preloadFavoriteMeta(workflowData);
    } else {
      setFavoriteState({});
      setFavoriteCountState({});
    }
  }, [workflowData]);

  // 获取当前登录用户
  const getCurrentUser = (): string => {
    // 尝试从localStorage获取用户信息
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        return user.name || user.username || user.email || t('workflowMarket.user.unknown');
      } catch (e) {
        console.error('解析用户信息失败:', e);
      }
    }

    // 尝试从store或context获取用户信息
    try {
      // 如果应用使用了全局状态管理（如Redux、Zustand等）
      const globalState = (window as any).__STORE__ || (window as any).appState;
      if (globalState && globalState.user) {
        return (
          globalState.user.name ||
          globalState.user.username ||
          globalState.user.email ||
          t('workflowMarket.user.unknown')
        );
      }
    } catch (e) {
      console.error('获取全局状态失败:', e);
    }

    // 尝试从JWT token解析用户信息
    const token = localStorage.getItem('token');
    if (token) {
      try {
        // 简单解析JWT token的payload部分
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          // 解码base64（处理padding）
          const base64Payload = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            atob(base64Payload)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join(''),
          );
          const payload = JSON.parse(jsonPayload);
          return (
            payload.sub ||
            payload.username ||
            payload.name ||
            payload.user ||
            t('workflowMarket.user.unknown')
          );
        }
      } catch (e) {
        console.error('解析token失败:', e);
      }
    }

    // 尝试从sessionStorage获取用户信息
    const sessionUserStr = sessionStorage.getItem('user');
    if (sessionUserStr) {
      try {
        const user = JSON.parse(sessionUserStr);
        return user.name || user.username || user.email || t('workflowMarket.user.unknown');
      } catch (e) {
        console.error('解析会话用户信息失败:', e);
      }
    }

    // 如果没有用户信息，返回默认值
    return t('workflowMarket.user.unknown');
  };

  const buildQueryParams = () => {
    const queryParams: { name?: string; appType?: string } = {};
    if (selectedTypeCode) {
      queryParams.appType = selectedTypeCode; // 发送 typeCode 给后端查询
    }
    if (searchQuery) {
      queryParams.name = searchQuery;
    }
    return queryParams;
  };

  const resolveWorkflowTypes = (types: WorkflowType[] | null): Map<string, string> => {
    const nextTypes =
      types && types.length
        ? types
        : workflowTypes.length
          ? workflowTypes
          : getDefaultWorkflowTypes(t as (key: string) => string);
    setWorkflowTypes(nextTypes);
    return new Map(nextTypes.map((t) => [t.typeCode, t.typeName || t.typeCode]));
  };

  // 刷新工作流市场数据
  const refreshWorkflows = async () => {
    // 允许绕过API频率限制
    allowRefresh('/workflowMarket/list');

    try {
      setLoading(true);

      const queryParams = buildQueryParams();

      const [result, types] = await Promise.all([
        getWorkflowMarketList(queryParams, {
          pageNum: 1,
          pageSize: 100,
        }),
        getWorkflowTypes().catch((error) => {
          console.error('获取应用类型失败，使用默认类型', error);
          return null;
        }),
      ]);

      const localTypeNameMap = resolveWorkflowTypes(types);
      const mapped = transformToTemplates(result.rows, localTypeNameMap);
      setWorkflowData(mapped);
      preloadFavoriteMeta(mapped);
    } catch (error) {
      console.error('获取工作流市场数据失败:', error);
      // 如果API调用失败，可以设置一些默认数据或显示错误信息
      setWorkflowData([]);
      setWorkflowTypes((prev) =>
        prev.length ? prev : getDefaultWorkflowTypes(t as (key: string) => string),
      );
    } finally {
      setLoading(false);
    }
  };

  // 从后端API获取工作流市场数据，根据分类和搜索条件
  useEffect(() => {
    refreshWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypeCode, searchQuery, language]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAdd = async () => {
    try {
      // 构建符合后端BO类要求的数据对象
      const updatedFormData = {
        name: formData.name || '', // 必填字段
        description: formData.description || '',
        definitionJson: formData.definitionJson || '{}', // 必填字段
        appType: formData.appType || '',
        creator: getCurrentUser(), // 当前用户
        status: formData.status || '0', // 默认状态
        publishStatus: formData.publishStatus || '0', // 默认发布状态
        remark: formData.remark || '',
        workflowId: formData.workflowId || undefined, // 明确设置为undefined
        version: formData.version || 0,
        icon: formData.icon || '',
        tags: formData.tags || '',
        isTemplate: formData.isTemplate || '1',
        downloads: formData.downloads || 0,
        useCount: formData.useCount || 0,
        favoriteCount: formData.favoriteCount || 0,
      };

      // 验证必填字段
      if (!updatedFormData.name) {
        tipWarning(t('workflowMarket.validation.nameRequired'));
        return;
      }

      const id = await addWorkflowToMarket(updatedFormData);

      // 如果包含workflowId，则同步更新工作流应用表的应用类型等信息
      if (updatedFormData.workflowId) {
        try {
          await updateWorkflow({
            workflowId: updatedFormData.workflowId,
            name: updatedFormData.name,
            description: updatedFormData.description,
            definitionJson: updatedFormData.definitionJson,
            appType: updatedFormData.appType,
            status: updatedFormData.status,
            publishStatus: updatedFormData.publishStatus,
            remark: updatedFormData.remark,
            version: updatedFormData.version,
            icon: updatedFormData.icon,
            tags: updatedFormData.tags,
            isTemplate: updatedFormData.isTemplate,
            downloads: updatedFormData.downloads,
            favoriteCount: updatedFormData.favoriteCount,
          });
        } catch (error) {
          console.error('同步工作流应用表失败:', error);
          tipWarning(t('workflowMarket.warning.syncAfterAddFailed'));
        }
      }

      tipSuccess(t('workflowMarket.success.added', { id }));
      setShowForm(false);
      setFormData({
        name: '',
        description: '',
        appType: '',
        status: '0',
        publishStatus: '0',
        isTemplate: '1',
        downloads: 0,
        useCount: 0,
        favoriteCount: 0,
        creator: getCurrentUser(), // 设置为当前用户
        definitionJson: '{}', // 确保提供默认值
      });
      // 重新获取数据
      const queryParams = buildQueryParams();
      const result: TableDataInfo<WorkflowMarketItem> = await getWorkflowMarketList(queryParams, {
        pageNum: 1,
        pageSize: 100,
      });
      const mapped = transformToTemplates(result.rows, typeNameMap);
      setWorkflowData(mapped);
      preloadFavoriteMeta(mapped);
    } catch (err) {
      console.error('新增失败:', err);
      tipError(
        t('workflowMarket.error.addFailed', {
          reason: err instanceof Error ? err.message : t('workflowMarket.error.unknown'),
        }),
      );
    }
  };

  const handleUpdate = async () => {
    if (!editingItem || !editingItem.workflowMarketId) {
      tipWarning(t('workflowMarket.warning.noItemSelected'));
      return;
    }

    try {
      // 构建符合后端BO类要求的数据对象
      const updateData = {
        workflowMarketId: editingItem.workflowMarketId, // 编辑时必须包含ID
        name: formData.name || '', // 必填字段
        description: formData.description || '',
        definitionJson: formData.definitionJson || '{}', // 必填字段
        appType: formData.appType || '',
        creator: formData.creator || getCurrentUser(), // 当前用户
        status: formData.status || '0', // 默认状态
        publishStatus: formData.publishStatus || '0', // 默认发布状态
        remark: formData.remark || '',
        workflowId:
          formData.workflowId ??
          editingItem.workflowId ??
          toNumberId(editingItem.workflowMarketId) ??
          undefined, // 用于同步更新工作流表
        version: formData.version || 0,
        icon: formData.icon || '',
        tags: formData.tags || '',
        isTemplate: formData.isTemplate || '1',
        downloads: formData.downloads || 0,
        useCount: formData.useCount || 0,
        favoriteCount: formData.favoriteCount || 0,
      };

      await updateWorkflowMarketItem(updateData);

      // 同步更新工作流应用表中的应用类型等信息
      if (updateData.workflowId) {
        try {
          await updateWorkflow({
            workflowId: updateData.workflowId,
            name: updateData.name,
            description: updateData.description,
            definitionJson: updateData.definitionJson,
            appType: updateData.appType,
            status: updateData.status,
            publishStatus: updateData.publishStatus,
            remark: updateData.remark,
            version: updateData.version,
            icon: updateData.icon,
            tags: updateData.tags,
            isTemplate: updateData.isTemplate,
            downloads: updateData.downloads,
            favoriteCount: updateData.favoriteCount,
          });
        } catch (error) {
          console.error('同步更新工作流应用表失败:', error);
          tipWarning(t('workflowMarket.warning.syncAfterUpdateFailed'));
        }
      }

      tipSuccess(t('workflowMarket.success.updated', { id: editingItem.workflowMarketId }));
      setShowForm(false);
      setEditingItem(null);
      setFormData({
        name: '',
        description: '',
        appType: '',
        status: '0',
        publishStatus: '0',
        isTemplate: '1',
        downloads: 0,
        useCount: 0,
        favoriteCount: 0,
        creator: getCurrentUser(), // 设置为当前用户
        definitionJson: '{}', // 确保提供默认值
      });
      // 重新获取数据
      const queryParams = buildQueryParams();
      const result: TableDataInfo<WorkflowMarketItem> = await getWorkflowMarketList(queryParams, {
        pageNum: 1,
        pageSize: 100,
      });
      setWorkflowData(transformToTemplates(result.rows, typeNameMap));
    } catch (err) {
      console.error('更新失败:', err);
      tipError(
        t('workflowMarket.error.updateFailed', {
          reason: err instanceof Error ? err.message : t('workflowMarket.error.unknown'),
        }),
      );
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      handleUpdate();
    } else {
      handleAdd();
    }
  };

  const handleReuse = (wf: WorkflowTemplate) => {
    setReuseData({
      wf,
      name: wf.name,
      description: wf.description,
    });
    setShowReuseModal(true);
  };

  const confirmReuse = async () => {
    const { wf, name, description } = reuseData;
    if (!wf) return;

    const definition =
      typeof wf.definitionJson === 'string'
        ? wf.definitionJson || '{}'
        : JSON.stringify(wf.definitionJson || {});
    const workflowIdNum = toNumberId(wf.workflowId ?? wf.displayWorkflowId);
    if (workflowIdNum) {
      incrementWorkflowUse(workflowIdNum).catch((err) => console.warn('记录使用次数失败', err));
      setWorkflowData((prev) =>
        prev.map((item) => (item.id === wf.id ? { ...item, uses: (item.uses || 0) + 1 } : item)),
      );
    }

    const workflowId = generateWorkflowId();
    try {
      setLoading(true);
      const result = await createWorkflow({
        workflowId,
        name: name || wf.name || t('workflowMarket.reuse.defaultName'),
        appType: wf.categoryCode || wf.category || 'workflow',
        definitionJson: definition,
        description: description || wf.description || '',
        publishStatus: '3',
        status: '1',
        version: 1,
        remark: '',
        icon: '',
        tags: wf.tags || '',
        isTemplate: '0',
      });

      if (result) {
        // tipSuccess('应用已创建，正在跳转');
        setShowReuseModal(false);
        navigate('/app/n8n/' + workflowId);
      }
    } catch (error) {
      console.error('复用创建工作流失败', error);
      tipError(t('workflowMarket.error.reuseFailed'));
    } finally {
      setLoading(false);
    }
  };

  const resolveWorkflowId = async (wf: WorkflowTemplate): Promise<string | null> => {
    // 收藏接口要求 Long，前端只传可转换为数字的 ID，优先使用 marketId
    if (wf.favoriteId && isNumericString(String(wf.favoriteId))) return String(wf.favoriteId);

    if (isNumericString(String(wf.id))) {
      const idStr = String(wf.id);
      setWorkflowData((prev) =>
        prev.map((item) => (item.id === wf.id ? { ...item, favoriteId: idStr } : item)),
      );
      return idStr;
    }

    // 兜底从详情中取 workflowMarketId（数值），workflowId 若是数字也可用
    try {
      const detail = await getWorkflowMarketItem(Number(wf.id));
      const mapped = mapBackendToWorkflowMarketItem(detail);
      const favoriteId =
        (mapped.workflowMarketId ? String(mapped.workflowMarketId) : undefined) ||
        (isNumericString(String(mapped.workflowId)) ? String(mapped.workflowId) : undefined);

      if (favoriteId && isNumericString(favoriteId)) {
        setWorkflowData((prev) =>
          prev.map((item) => {
            if (item.id !== wf.id) return item;
            const displayWorkflowId =
              typeof mapped.workflowId === 'string'
                ? mapped.workflowId
                : typeof item.displayWorkflowId === 'string'
                  ? item.displayWorkflowId
                  : undefined;
            return {
              ...item,
              favoriteId,
              workflowId: mapped.workflowId || item.workflowId,
              displayWorkflowId,
            };
          }),
        );
        return favoriteId;
      }
    } catch (error) {
      console.error('获取工作流详情失败，无法解析 workflowId:', error);
    }

    return null;
  };

  const toggleFavorite = async (wf: WorkflowTemplate) => {
    const workflowId = await resolveWorkflowId(wf);
    if (!workflowId) {
      tipWarning(t('workflowMarket.warning.missingWorkflowId'));
      return;
    }
    const isFav = favoriteState[wf.id] || false;
    try {
      if (isFav) {
        await unfavoriteWorkflow(workflowId);
        tipSuccess(t('workflowMarket.favorite.unfavorited'));
      } else {
        await favoriteWorkflow(workflowId);
        tipSuccess(t('workflowMarket.favorite.favorited'));
      }
      setFavoriteState((prev) => ({ ...prev, [wf.id]: !isFav }));
      setFavoriteCountState((prev) => ({
        ...prev,
        [wf.id]: Math.max(0, (prev[wf.id] ?? wf.stars ?? 0) + (isFav ? -1 : 1)),
      }));
      setWorkflowData((prev) =>
        prev.map((item) =>
          item.id === wf.id
            ? {
                ...item,
                stars: Math.max(
                  0,
                  (favoriteCountState[wf.id] ?? item.stars ?? 0) + (isFav ? -1 : 1),
                ),
              }
            : item,
        ),
      );
    } catch (error) {
      console.error('收藏操作失败:', error);
      tipError(t('workflowMarket.favorite.failed'));
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingItem(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-auto">
      {/* Header */}
      <header className="px-6 py-6 bg-white border-b border-slate-200">
        <div className="max-w-full mx-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('workflowMarket.title')}</h1>
            <p className="text-slate-600 text-base">{t('workflowMarket.subtitle')}</p>
          </div>
          <button
            onClick={refreshWorkflows}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center"
          >
            <Icons.RefreshCw className="w-4 h-4 mr-2" />
            {t('workflowMarket.refresh')}
          </button>
        </div>
      </header>

      <div className="flex-1 p-4 max-w-full mx-0 w-full overflow-y-auto">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 space-y-3 sm:space-y-0">
          {/* Categories */}
          <div className="flex overflow-x-auto pb-1 md:pb-0 hide-scrollbar space-x-2 w-full sm:w-auto">
            {categoryOptions.map((cat) => (
              <button
                key={cat.typeCode || 'all'}
                onClick={() => setSelectedTypeCode(cat.typeCode)} // 这会触发useEffect重新获取数据
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                  selectedTypeCode === cat.typeCode
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {cat.typeName || cat.typeCode || t('workflowMarket.filter.all')}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-56">
            <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('workflowMarket.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }} // 这也会触发useEffect重新获取数据
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
          </div>
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  {editingItem
                    ? t('workflowMarket.form.editTitle')
                    : t('workflowMarket.form.addTitle')}
                </h3>

                <form onSubmit={handleFormSubmit}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('workflowMarket.form.name')}
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name || ''}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('workflowMarket.form.description')}
                      </label>
                      <textarea
                        name="description"
                        value={formData.description || ''}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                        rows={3}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('workflowMarket.form.appType')}
                      </label>
                      <select
                        name="appType"
                        value={formData.appType || ''}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        <option value="">{t('workflowMarket.form.appTypePlaceholder')}</option>
                        {workflowTypes.map((type) => (
                          <option key={type.typeCode} value={type.typeCode}>
                            {type.typeName || type.typeCode}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('workflowMarket.form.creator')}
                      </label>
                      <input
                        type="text"
                        name="creator"
                        value={formData.creator || ''}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                        readOnly // 创建者字段只读，自动填充
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={closeForm}
                      className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {t('dialog.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700"
                    >
                      {editingItem
                        ? t('workflowMarket.form.update')
                        : t('workflowMarket.form.create')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Reuse Modal - Match Image 1 */}
        {showReuseModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-200">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-800 flex items-center">
                  <span className="mr-2">{t('workflowMarket.reuse.titlePrefix')}</span>
                  <span className="font-extrabold tracking-tight">{reuseData.name}</span>
                  <span className="ml-2">{t('workflowMarket.reuse.titleSuffix')}</span>
                </h3>
                <button
                  onClick={() => setShowReuseModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Icons.X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    {t('workflowMarket.reuse.icon')}
                  </label>
                  <div className="flex items-center space-x-3">
                    {/* <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-2xl shadow-sm">
                      🔍
                    </div> */}
                    <input
                      type="text"
                      value={reuseData.name}
                      onChange={(e) => setReuseData((prev) => ({ ...prev, name: e.target.value }))}
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all text-slate-800 font-medium"
                      placeholder={t('workflowMarket.reuse.namePlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    {t('workflowMarket.reuse.description')}
                  </label>
                  <textarea
                    value={reuseData.description}
                    onChange={(e) =>
                      setReuseData((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all text-slate-800 min-h-[120px] resize-none"
                    placeholder={t('workflowMarket.reuse.descriptionPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    {t('workflowMarket.reuse.preview')}
                  </label>
                  <div className="w-full h-[400px] border border-slate-200 rounded-xl overflow-hidden bg-slate-50 relative">
                    {!iframeReady && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-10">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-600 mb-3"></div>
                        <p className="text-sm text-slate-500 font-medium">
                          {t('workflowMarket.reuse.loadingPreview')}
                        </p>
                      </div>
                    )}
                    <iframe
                      ref={iframeRef}
                      src={`${import.meta.env.VITE_N8N_URL}/workflow-preview`}
                      className={`w-full h-full border-none transition-opacity duration-300 ${iframeReady ? 'opacity-100' : 'opacity-0'}`}
                      title="Workflow Preview"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-3 pt-4">
                  <button
                    onClick={() => setShowReuseModal(false)}
                    className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-all active:scale-95"
                  >
                    {t('dialog.cancel')}
                  </button>
                  <button
                    onClick={confirmReuse}
                    className="px-8 py-2.5 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 shadow-lg shadow-brand-500/30 transition-all active:scale-95 flex items-center"
                  >
                    {t('workflowMarket.reuse.create')}
                    <span className="ml-2 text-[10px] bg-white/20 px-1.5 py-0.5 rounded flex items-center font-normal opacity-80">
                      <Icons.Command className="w-2.5 h-2.5 mr-0.5" />
                      <span>↵</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Grid - Optimized for screen space */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 min-h-0">
          {workflowData.map((wf) => {
            const tags =
              wf.tags
                ?.split(',')
                .map((t) => t.trim())
                .filter(Boolean) || [];
            return (
              <div
                key={wf.id}
                onClick={() => {
                  // navigate(`/app/n8n/${wf.workflowId}`);
                }}
                className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col h-full min-h-[140px]"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center group-hover:bg-brand-50 group-hover:border-brand-100 transition-colors flex-shrink-0">
                    {wf.icon}
                  </div>
                  <div className="flex items-center flex-wrap gap-1 text-slate-400 flex-shrink-0">
                    {tags.length ? (
                      tags.map((tag, idx) => (
                        <span
                          key={`${tag}-${idx}`}
                          className="text-xs font-medium bg-slate-100 px-1.5 py-0.5 rounded text-slate-500"
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs font-medium bg-slate-100 px-1.5 py-0.5 rounded text-slate-400">
                        {t('workflowMarket.tags.none')}
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="font-semibold text-slate-800 text-sm mb-1 group-hover:text-brand-600 transition-colors line-clamp-1">
                  {wf.name}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2 flex-1">
                  {wf.description}
                </p>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center space-x-3">
                    <span className="flex items-center">
                      <Icons.Play className="w-3 h-3 mr-1" />
                      {wf.uses.toLocaleString()}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(wf);
                      }}
                      className="flex items-center space-x-1 text-xs px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors"
                      title={
                        favoriteState[wf.id]
                          ? t('workflowMarket.favorite.unfavoriteTitle')
                          : t('workflowMarket.favorite.favoriteTitle')
                      }
                    >
                      <Icons.Star
                        className={`w-3 h-3 ${favoriteState[wf.id] ? 'text-amber-500' : 'text-slate-400'}`}
                      />
                      <span>{favoriteCountState[wf.id] ?? wf.stars}</span>
                    </button>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-600 mr-1">
                      {wf.author.charAt(0)}
                    </div>
                    <span className="text-xs">{wf.author}</span>
                  </div>
                </div>

                <div className="mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // 阻止冒泡到父级的onClick
                      handleReuse(wf);
                    }}
                    className="w-full text-xs px-3 py-1.5 rounded-md bg-brand-600 text-white font-medium hover:bg-brand-700 shadow-sm transition-all duration-150 flex items-center justify-center opacity-0 group-hover:opacity-100"
                  >
                    <Icons.Plus className="w-3.5 h-3.5 mr-1" />
                    {t('workflowMarket.reuse.button')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {workflowData.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center flex-1">
            <Icons.Box className="w-12 h-12 text-slate-300 mb-2" />
            <h3 className="text-base font-medium text-slate-500 mb-1">
              {t('workflowMarket.empty.title')}
            </h3>
            <p className="text-slate-400 text-sm">{t('workflowMarket.empty.desc')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getWorkflowList,
  createWorkflow,
  deleteWorkflow,
  submitWorkflowReview,
  cancelPublishReview,
  changeWorkflowStatus,
  getWorkflowDetail,
  updateWorkflow,
  getWorkflowTypes,
  WorkflowType,
  WorkflowItem,
} from '@/runmesh/api/user/workflow';
import { WorkflowEditModal } from '@/runmesh/components/WorkflowEditModal';
import { useToast } from '@/runmesh/components/Toast';
import { TagSelector } from '@/runmesh/components/TagSelector';
import { useWorkflowTransferStore } from '@/runmesh/stores/useWorkflowTransferStore';
import { generateWorkflowId } from '@/runmesh/utils/index';
import { useLanguage } from '@/runmesh/i18n';
import type { TranslationKey } from '@/runmesh/i18n/types';

type TypeOption = { labelKey?: TranslationKey; label: string; value?: string };

const ALL_TYPE_KEY: TranslationKey = 'userDashboard.type.all';

const getDefaultTypeOptions = (t: (key: TranslationKey) => string): TypeOption[] => [
  { labelKey: ALL_TYPE_KEY, label: t(ALL_TYPE_KEY), value: undefined },
  {
    labelKey: 'userDashboard.type.workflow',
    label: t('userDashboard.type.workflow'),
    value: 'workflow',
  },
  {
    labelKey: 'userDashboard.type.chatflow',
    label: t('userDashboard.type.chatflow'),
    value: 'chatflow',
  },
  {
    labelKey: 'userDashboard.type.chatbot',
    label: t('userDashboard.type.chatbot'),
    value: 'chatbot',
  },
  { labelKey: 'userDashboard.type.agent', label: t('userDashboard.type.agent'), value: 'agent' },
  {
    labelKey: 'userDashboard.type.textGenerator',
    label: t('userDashboard.type.textGenerator'),
    value: 'text_generator',
  },
];

type BadgeInfo = { text: string; className: string };

const getStatusBadgeMap = (
  t: (key: TranslationKey) => string,
): Record<string, BadgeInfo | undefined> => ({
  '0': {
    text: t('userDashboard.status.disabled'),
    className: 'bg-gray-50 text-gray-600 border border-gray-200',
  },
  '1': {
    text: t('userDashboard.status.enabled'),
    className: 'bg-green-50 text-green-600 border border-green-200',
  },
});

const getPublishBadgeMap = (
  t: (key: TranslationKey) => string,
): Record<string, BadgeInfo | undefined> => ({
  '0': {
    text: t('userDashboard.publish.processing'),
    className: 'bg-yellow-50 text-yellow-600 border border-yellow-200',
  },
  '1': {
    text: t('userDashboard.publish.published'),
    className: 'bg-green-50 text-green-600 border border-green-200',
  },
  '2': {
    text: t('userDashboard.publish.rejected'),
    className: 'bg-red-50 text-red-600 border border-red-200',
  },
  '3': {
    text: t('userDashboard.publish.draft'),
    className: 'bg-blue-50 text-blue-600 border border-blue-200',
  },
});

const renderBadge = (info?: BadgeInfo) =>
  info ? (
    <>
      <span className="text-slate-300 ml-1.5"></span>
      <span
        className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${info.className}`}
      >
        {info.text}
      </span>
    </>
  ) : null;

// 获取应用图标
const getAppIcon = (appType: string) => {
  switch (appType) {
    case 'workflow':
      return <Icons.Workflow className="w-6 h-6 text-purple-500" />;
    case 'chatflow':
      return <Icons.MessageSquare className="w-6 h-6 text-blue-500" />;
    case 'chatbot':
      return <Icons.Robot className="w-6 h-6 text-cyan-500" />;
    case 'agent':
      return <Icons.Search className="w-6 h-6 text-green-500" />;
    case 'text_generator':
      return <Icons.Terminal className="w-6 h-6 text-yellow-500" />;
    default:
      return <Icons.FileText className="w-6 h-6 text-slate-500" />;
  }
};

const getOptionId = (option: TypeOption) => option.labelKey ?? option.label;

const getOptionLabel = (option: TypeOption, t: (key: TranslationKey) => string) =>
  option.labelKey ? t(option.labelKey) : option.label;

// 格式化时间
const formatTime = (
  dateStr: string,
  language: string,
  t: (key: TranslationKey, params?: Record<string, string>) => string,
) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const formatted = date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return t('userDashboard.editAt', { date: formatted });
};

interface AppCardProps {
  app: WorkflowItem;
  onClick?: (app: WorkflowItem) => void;
  onEdit?: (app: WorkflowItem) => void;
  onDelete?: (app: WorkflowItem) => void;
  onPublish?: (app: WorkflowItem) => void;
  onCancelPublish?: (app: WorkflowItem) => void;
  onStatusChange?: (app: WorkflowItem) => void;
  onTagsUpdate?: (app: WorkflowItem) => void;
  isTagSelectorOpen?: boolean;
  tagSelectorContent?: React.ReactNode;
}

const AppCard: React.FC<AppCardProps> = ({
  app,
  onClick,
  onEdit,
  onDelete,
  onPublish,
  onCancelPublish,
  onStatusChange,
  onTagsUpdate,
  isTagSelectorOpen,
  tagSelectorContent,
}) => {
  const { t, language } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tags = app.tags ? app.tags.split(',').filter(Boolean) : [];

  const handleMenuClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    setShowMenu(false);
    action();
  };

  // 处理点击外部区域关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside as (event: Event) => void);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside as (event: Event) => void);
    };
  }, [showMenu]);

  const handleClick = () => {
    onClick?.(app);
  };

  return (
    <div
      className="bg-white border border-slate-200 hover:shadow-lg rounded-xl p-5 transition-all duration-200 flex flex-col h-64 group relative cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white border border-slate-100 shadow-sm group-hover:scale-105 transition-transform overflow-hidden">
            {app.icon ? (
              app.icon.startsWith('http') ? (
                <img src={app.icon} alt={app.name} className="w-full h-full object-contain p-2" />
              ) : (
                <span className="text-2xl">{app.icon}</span>
              )
            ) : (
              getAppIcon(app.appType)
            )}
          </div>
          <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              className="text-slate-500 bg-slate-200 hover:text-slate-700 p-1 rounded-md hover:bg-slate-300 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
            >
              <Icons.MoreHorizontal className="w-5 h-5" />
            </button>

            {/* 操作菜单 */}
            {showMenu && (
              <div className="absolute right-0 mt-1 w-40 bg-slate-100 rounded-lg shadow-lg border border-slate-200 py-1 z-10">
                <button
                  onClick={(e) => handleMenuClick(e, () => onEdit?.(app))}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                >
                  <Icons.Edit className="w-4 h-4" />
                  <span>{t('userDashboard.action.edit')}</span>
                </button>

                {['2', '3'].includes(app.publishStatus || '') && (
                  <button
                    onClick={(e) => handleMenuClick(e, () => onPublish?.(app))}
                    className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 flex items-center space-x-2"
                  >
                    <Icons.Upload className="w-4 h-4" />
                    <span>{t('userDashboard.action.publish')}</span>
                  </button>
                )}
                {app.publishStatus === '0' && (
                  <button
                    onClick={(e) => handleMenuClick(e, () => onCancelPublish?.(app))}
                    className="w-full px-4 py-2 text-left text-sm text-amber-600 hover:bg-amber-50 flex items-center space-x-2"
                  >
                    <Icons.XOctagon className="w-4 h-4" />
                    <span>{t('userDashboard.action.cancelPublish')}</span>
                  </button>
                )}

                <div className="border-t border-slate-100 my-1"></div>

                <button
                  onClick={(e) => handleMenuClick(e, () => onStatusChange?.(app))}
                  className="w-full px-4 py-2 text-left text-sm text-orange-600 hover:bg-orange-50 flex items-center space-x-2"
                >
                  <Icons.Power className="w-4 h-4" />
                  <span>
                    {app.status === '1'
                      ? t('userDashboard.action.disable')
                      : t('userDashboard.action.enable')}
                  </span>
                </button>

                <button
                  onClick={(e) => handleMenuClick(e, () => onDelete?.(app))}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                >
                  <Icons.Trash className="w-4 h-4" />
                  <span>{t('userDashboard.action.delete')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3">
            <h3 className="font-bold text-slate-800 text-base mb-1 line-clamp-1 group-hover:text-brand-600 transition-colors">
              {app.name}
            </h3>
            <p className="text-xs text-slate-400 flex items-center">
              <span className="mr-1.5">v{app.version || 0}</span>
              <span className="text-slate-300"></span>
              <span className="ml-1.5">
                {formatTime(app.updateTime || app.createTime, language, t)}
              </span>
              {/* 状态标签 - 只显示一个 */}
              {renderBadge(getStatusBadgeMap(t)[app.status || ''])}
              {/* 发布状态 - 只显示一个 */}
              {renderBadge(getPublishBadgeMap(t)[app.publishStatus || ''])}
            </p>
          </div>

          <p className="text-xs text-slate-500 line-clamp-2 mb-4 leading-relaxed">
            {app.description || t('userDashboard.noDescription')}
          </p>
        </div>

        <div className="flex items-center space-x-2 mt-auto flex-wrap gap-1">
          {tags.slice(0, 3).map((tag, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200"
            >
              <Icons.FileText className="w-2.5 h-2.5 mr-1 text-slate-400" />
              {tag}
            </span>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTagsUpdate?.(app);
            }}
            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-brand-600 border border-dashed border-brand-200 hover:bg-brand-50"
          >
            <Icons.Plus className="w-3 h-3 mr-1" />
            {tags.length ? t('userDashboard.tag.edit') : t('userDashboard.tag.add')}
          </button>
        </div>
      </div>

      {/* Tag Selector Row (outside card click zone) */}
      {isTagSelectorOpen && (
        <div
          className="absolute inset-x-0 bottom-2 z-20 px-5"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {tagSelectorContent}
        </div>
      )}
    </div>
  );
};

export const UserDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();

  // 状态
  const [activeTab, setActiveTab] = useState<string>(ALL_TYPE_KEY);
  const [showImportModal, setShowImportModal] = useState(false);
  const [apps, setApps] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [total, setTotal] = useState(0);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowItem | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isDraggingImport, setIsDraggingImport] = useState(false);
  const [typeOptions, setTypeOptions] = useState<TypeOption[]>(() => getDefaultTypeOptions(t));
  const editModalRef = useRef<HTMLDivElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; app: WorkflowItem | null }>({
    show: false,
    app: null,
  });

  // 关闭编辑弹窗
  const handleCloseEditModal = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(t('userDashboard.confirmCloseEdit'));
      if (confirmClose) {
        setShowEditModal(false);
        setEditingWorkflow(null);
        setHasUnsavedChanges(false);
      }
    } else {
      setShowEditModal(false);
      setEditingWorkflow(null);
    }
  }, [hasUnsavedChanges, t]);

  // 处理点击空白区域关闭编辑弹窗
  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (showEditModal && editingWorkflow && editModalRef.current) {
        const target = event.target as Element;
        // 检查点击的元素是否在编辑弹窗内部
        if (!editModalRef.current.contains(target)) {
          handleCloseEditModal();
        }
      }
    };

    if (showEditModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEditModal, editingWorkflow, handleCloseEditModal]);
  const [publishConfirm, setPublishConfirm] = useState<{ show: boolean; app: WorkflowItem | null }>(
    {
      show: false,
      app: null,
    },
  );
  const [cancelPublishConfirm, setCancelPublishConfirm] = useState<{
    show: boolean;
    app: WorkflowItem | null;
  }>({ show: false, app: null });
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [statusConfirm, setStatusConfirm] = useState<{
    show: boolean;
    app: WorkflowItem | null;
    action: 'enable' | 'disable' | '';
  }>({ show: false, app: null, action: '' });
  const [tagSelectorApp, setTagSelectorApp] = useState<WorkflowItem | null>(null);
  const [tagSelected, setTagSelected] = useState<string[]>([]);
  const [tagSelectorInitial, setTagSelectorInitial] = useState<string[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [showGlobalTagSelector, setShowGlobalTagSelector] = useState(false);
  const { showToast, toastContainer } = useToast();
  const clearTransferData = useWorkflowTransferStore((s) => s.clear);

  const resolveTypeValue = useCallback(
    (id: string) => typeOptions.find((opt) => getOptionId(opt) === id)?.value,
    [typeOptions],
  );
  // resolveLabelByValue 暂未使用（保留占位以便后续下拉过滤时启用）

  // 加载应用类型（来自 /runmesh/workflow-types/list），失败则回退默认
  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const types = await getWorkflowTypes();
        if (Array.isArray(types) && types.length) {
          const mapped = types.map((wt: WorkflowType) => ({
            label: wt.typeName || wt.typeCode || t('userDashboard.type.unnamed'),
            value: wt.typeCode || wt.typeName,
          }));
          // 全部 始终放首位
          setTypeOptions([
            { labelKey: ALL_TYPE_KEY, label: t(ALL_TYPE_KEY), value: undefined },
            ...mapped,
          ]);
          // 如果当前选中的 tab 不在新的类型列表里，则重置为“全部”
          const exists = mapped.some((m) => getOptionId(m) === activeTab);
          if (!exists && activeTab !== ALL_TYPE_KEY) {
            setActiveTab(ALL_TYPE_KEY);
            loadApps({ appType: undefined, keyword: searchKeyword, onlyMine, tags: globalTags });
          }
        } else {
          setTypeOptions(getDefaultTypeOptions(t));
        }
      } catch (err) {
        console.error('获取应用类型失败，使用默认类型', err);
        setTypeOptions(getDefaultTypeOptions(t));
      }
    };
    fetchTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // 加载应用列表（功能1：获取应用列表）
  const loadApps = useCallback(
    async (params?: {
      appType?: string;
      keyword?: string;
      onlyMine?: boolean;
      tags?: string[];
    }) => {
      setLoading(true);
      try {
        const res = await getWorkflowList({
          pageNum: 1,
          pageSize: 50,
          appType: params?.appType,
          keyword: params?.keyword || undefined,
          onlyMine: params?.onlyMine || undefined,
          // 后端兼容 tags 查询，传入逗号分隔
          tags: params?.tags?.length ? params.tags.join(',') : undefined,
        });
        const normalizedRows = (res.rows || []).map((item) => ({
          ...item,
          workflowId: item.workflowId ?? item.id,
        }));
        setApps(normalizedRows);
        setTotal(res.total || 0);
      } catch (error) {
        console.error(' 加载应用列表失败', error);
        setApps([]);
        setTotal(0);
        showToast({
          type: 'error',
          message: t('userDashboard.toast.loadFailed'),
        });
      } finally {
        setLoading(false);
      }
    },
    [showToast, t],
  );

  // 路由进入/切换时刷新应用列表，确保展示最新数据
  useEffect(() => {
    reloadWithFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Tab 切换
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      const appType = resolveTypeValue(tab);
      loadApps({ appType, keyword: searchKeyword, onlyMine, tags: globalTags });
    },
    [globalTags, loadApps, searchKeyword, onlyMine, resolveTypeValue],
  );

  // 下拉选择类型（与 Tab 同步，发送 typeCode 过滤）— 当前未使用，保留逻辑时可恢复

  // 只看我创建的
  const handleOnlyMineChange = useCallback(
    (checked: boolean) => {
      setOnlyMine(checked);
      const appType = resolveTypeValue(activeTab);
      loadApps({ appType, keyword: searchKeyword, onlyMine: checked, tags: globalTags });
    },
    [activeTab, globalTags, loadApps, searchKeyword, resolveTypeValue],
  );

  // 搜索
  const handleSearch = useCallback(() => {
    const appType = resolveTypeValue(activeTab);
    loadApps({ appType, keyword: searchKeyword, onlyMine, tags: globalTags });
  }, [activeTab, globalTags, loadApps, searchKeyword, onlyMine, resolveTypeValue]);

  // 统一按当前筛选条件刷新
  const reloadWithFilters = useCallback(() => {
    const appType = resolveTypeValue(activeTab);
    return loadApps({ appType, keyword: searchKeyword, onlyMine, tags: globalTags });
  }, [activeTab, globalTags, loadApps, onlyMine, resolveTypeValue, searchKeyword]);

  // 创建空白应用（功能3：创建应用）
  const handleCreateBlank = useCallback(async () => {
    try {
      clearTransferData(); // 创建空白应用前，强制清空可能的残留传输数据
      navigate('/app/n8n/?create=true');
    } catch (error) {
      console.error(' 创建应用失败', error);
      showToast({
        type: 'error',
        message: t('userDashboard.toast.createFailed'),
      });
    } finally {
      setLoading(false);
    }
  }, [clearTransferData, navigate, showToast, t]);

  // 点击应用卡片（功能2：获取应用详情）
  const handleAppClick = useCallback(
    (app: WorkflowItem) => {
      navigate(`/app/n8n/${app.workflowId}`);
    },
    [navigate],
  );

  // 编辑应用（功能2：编辑应用）- 改为弹窗模式
  const handleEdit = useCallback(
    (app: WorkflowItem) => {
      const workflowId = app.workflowId ?? app.id;

      if (!workflowId) {
        showToast({ type: 'error', message: t('userDashboard.toast.missingWorkflowId') });
        return;
      }

      setEditingWorkflow({ ...app, workflowId });
      setShowEditModal(true);
    },
    [showToast, t],
  );

  // 处理工作流保存成功
  const handleWorkflowSave = useCallback((updatedWorkflow: WorkflowItem) => {
    // 更新本地应用列表中的数据
    setApps((prev) =>
      prev.map((app) => (app.workflowId === updatedWorkflow.workflowId ? updatedWorkflow : app)),
    );
    setShowEditModal(false);
    setEditingWorkflow(null);
    setHasUnsavedChanges(false);
  }, []);

  // 删除应用（功能5：删除应用）
  const handleDelete = useCallback(async (app: WorkflowItem) => {
    setDeleteConfirm({ show: true, app });
  }, []);

  // 确认删除应用
  const confirmDelete = useCallback(async () => {
    const app = deleteConfirm.app;
    if (!app) return;
    const workflowId = app.workflowId;

    if (!workflowId) {
      showToast({ type: 'error', message: t('userDashboard.toast.missingWorkflowId') });
      return;
    }

    try {
      setLoading(true);
      await deleteWorkflow([workflowId as string | number]);
      showToast({
        type: 'success',
        message: t('userDashboard.toast.deleteSuccess', { name: app.name ?? '' }),
      });
      await reloadWithFilters();
    } catch (error) {
      console.error(' 删除应用失败', error);
      showToast({
        type: 'error',
        message: t('userDashboard.toast.deleteFailed'),
      });
    } finally {
      setLoading(false);
      setDeleteConfirm({ show: false, app: null });
    }
  }, [deleteConfirm.app, reloadWithFilters, showToast, t]);

  // 发布应用（功能6：发布应用）
  const handlePublish = useCallback(async (app: WorkflowItem) => {
    if (!app.workflowId) return;
    setPublishConfirm({ show: true, app });
  }, []);

  // 确认发布应用
  const confirmPublish = useCallback(async () => {
    const app = publishConfirm.app;
    if (!app || !app.workflowId) return;

    try {
      setLoading(true);
      await submitWorkflowReview(app.workflowId);
      showToast({
        type: 'success',
        message: t('userDashboard.toast.publishSubmitted', { name: app.name ?? '' }),
      });
      await reloadWithFilters();
    } catch (error) {
      console.error(' 提交应用审核失败', error);
      showToast({
        type: 'error',
        message: t('userDashboard.toast.publishFailed'),
      });
    } finally {
      setLoading(false);
      setPublishConfirm({ show: false, app: null });
    }
  }, [publishConfirm.app, reloadWithFilters, showToast, t]);

  // 取消发布申请（处理中 → 草稿）
  const handleCancelPublish = useCallback((app: WorkflowItem) => {
    if (!app.workflowId) return;
    setCancelPublishConfirm({ show: true, app });
  }, []);

  const confirmCancelPublish = useCallback(async () => {
    const app = cancelPublishConfirm.app;
    if (!app || !app.workflowId) return;
    try {
      setLoading(true);
      await cancelPublishReview(app.workflowId);
      showToast({
        type: 'success',
        message: t('userDashboard.toast.cancelPublishSuccess', { name: app.name ?? '' }),
      });
      await reloadWithFilters();
      setListRefreshKey((k) => k + 1);
    } catch (error) {
      console.error('取消发布申请失败', error);
      showToast({
        type: 'error',
        message: t('userDashboard.toast.cancelPublishFailed'),
      });
    } finally {
      setLoading(false);
      setCancelPublishConfirm({ show: false, app: null });
    }
  }, [cancelPublishConfirm.app, reloadWithFilters, showToast, t]);

  // 修改状态（功能7：修改状态）
  const handleStatusChange = useCallback((app: WorkflowItem) => {
    const action = app.status === '1' ? 'disable' : 'enable';
    setStatusConfirm({ show: true, app, action });
  }, []);

  // 打开标签选择器
  const handleTagsUpdate = useCallback((app: WorkflowItem) => {
    const selected = app.tags
      ? app.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    setTagSelected(selected);
    setTagSelectorInitial(selected);
    setTagSelectorApp(app);
  }, []);

  const handleTagsChange = useCallback((tags: string[]) => {
    setTagSelected(tags);
  }, []);

  const handleTagsSubmit = useCallback(
    async (tags: string[]) => {
      setTagSelected(tags);
      const targetWorkflowId = tagSelectorApp?.workflowId ?? tagSelectorApp?.id;
      if (!targetWorkflowId) {
        showToast({ type: 'error', message: t('userDashboard.toast.missingWorkflowId') });
        setTagSelectorApp(null);
        return;
      }
      const newTagsStr = tags.join(',');
      const initial = tagSelectorInitial.join(',');
      if (newTagsStr === initial) {
        setTagSelectorApp(null);
        return;
      }

      try {
        setLoading(true);
        const detail = await getWorkflowDetail(targetWorkflowId);
        // 将选择的 typeCode 一并保存到 appType（逗号分隔）
        let nextAppType = detail.appType || '';
        try {
          const typeList = await getWorkflowTypes();
          const typeCodeMap = new Map(
            (typeList || []).map((t: WorkflowType) => [
              t.typeName || t.typeCode || '',
              t.typeCode || t.typeName || '',
            ]),
          );
          const matchedCodes = tags
            .map((tagName) => typeCodeMap.get(tagName))
            .filter((code): code is string => Boolean(code));
          if (matchedCodes.length) {
            nextAppType = matchedCodes.join(',');
          }
        } catch (error) {
          console.error('获取类型列表失败，继续使用原始 appType', error);
        }

        await updateWorkflow({
          workflowId: targetWorkflowId,
          name: detail.name,
          description: detail.description,
          definitionJson: detail.definitionJson || '{}',
          version: detail.version || 1,
          publishStatus: detail.publishStatus || '0',
          status: detail.status || '1',
          remark: detail.remark || '',
          appType: nextAppType,
          icon: detail.icon || '',
          tags: newTagsStr,
          isTemplate: detail.isTemplate || '0',
        });

        setApps((prev) =>
          prev.map((item) =>
            item.workflowId === targetWorkflowId
              ? {
                  ...item,
                  tags: newTagsStr,
                  appType: nextAppType,
                }
              : item,
          ),
        );

        showToast({
          type: 'success',
          message: t('userDashboard.toast.tagsUpdated'),
        });
      } catch (error) {
        console.error('更新标签失败', error);
        showToast({
          type: 'error',
          message: t('userDashboard.toast.tagsUpdateFailed'),
        });
      } finally {
        setLoading(false);
        setTagSelectorApp(null);
      }
    },
    [setApps, showToast, tagSelectorApp, tagSelectorInitial, t],
  );

  const handleGlobalTagsApply = useCallback(
    (tags: string[]) => {
      setGlobalTags(tags);
      const appType = resolveTypeValue(activeTab);
      loadApps({ appType, keyword: searchKeyword, onlyMine, tags });
      setShowGlobalTagSelector(false);
    },
    [activeTab, loadApps, onlyMine, resolveTypeValue, searchKeyword],
  );

  // 确认状态变更
  const confirmStatusChange = useCallback(async () => {
    const app = statusConfirm.app;
    const action = statusConfirm.action;
    if (!app || !action) return;
    const workflowId = app.workflowId;
    if (!workflowId) {
      showToast({ type: 'error', message: t('userDashboard.toast.missingWorkflowId') });
      return;
    }
    const newStatus = app.status === '1' ? '0' : '1';
    const actionText =
      action === 'disable' ? t('userDashboard.action.disable') : t('userDashboard.action.enable');

    try {
      setLoading(true);
      await changeWorkflowStatus(workflowId as string | number, newStatus);
      showToast({
        type: 'success',
        message: t('userDashboard.toast.statusChanged', {
          name: app.name ?? '',
          action: actionText,
        }),
      });
      await reloadWithFilters();
    } catch (error) {
      console.error(' ' + actionText + '应用失败', error);
      showToast({
        type: 'error',
        message: t('userDashboard.toast.statusChangeFailed', { action: actionText }),
      });
    } finally {
      setLoading(false);
      setStatusConfirm({ show: false, app: null, action: '' });
    }
  }, [reloadWithFilters, showToast, statusConfirm.action, statusConfirm.app, t]);

  // 导入 JSON（功能3：创建应用）
  const handleImportJson = useCallback(
    async (file: File) => {
      try {
        setLoading(true);
        const text = await file.text();
        const json = JSON.parse(text);
        const workflowId = generateWorkflowId();
        json.id = workflowId;
        const result = await createWorkflow({
          workflowId,
          name: t('userDashboard.import.defaultName') || json.name,
          appType: json.appType || 'workflow',
          definitionJson: JSON.stringify(json.definition || json),
          description: json.description || '',
          publishStatus: '3', // 默认设置为草稿状态
          status: '1', // 默认设置为启用状态
          version: 1,
          remark: '',
          icon: '',
          tags: '',
          isTemplate: '0',
        });
        if (result) {
          showToast({
            type: 'success',
            message: t('userDashboard.import.success'),
          });
          setShowImportModal(false);
          await reloadWithFilters();
          navigate('/app/n8n/' + workflowId);
        }
      } catch (error) {
        console.error(' 导入应用失败', error);
        showToast({
          type: 'error',
          message: t('userDashboard.import.failed'),
        });
      } finally {
        setLoading(false);
      }
    },
    [navigate, reloadWithFilters, showToast, t],
  );

  // 文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImportJson(file);
      }
    },
    [handleImportJson],
  );

  const handleImportDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingImport(true);
  }, []);

  const handleImportDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
      return;
    }
    setIsDraggingImport(false);
  }, []);

  const handleImportDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingImport(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.json')) {
        showToast({
          type: 'error',
          message: t('userDashboard.import.onlyJson'),
        });
        return;
      }
      handleImportJson(file);
    },
    [handleImportJson, showToast, t],
  );

  return (
    <div className="flex flex-col bg-transparent">
      {/* Embedded inside AppLayout's scrollable main, so no h-full /
          overflow-hidden / own bg / own p-6 — those double-up against
          the outer shell and create padding mismatch + an inner scroll
          pane on top of the outer one. */}
      <div className="flex-1">
        {/* Type-filter tab strip (All / 工作流 / Chatflow / Chatbot /
            Agent / Text Generator) removed 2026-04-24 per product
            feedback — it distracts from the workflow list and leaks
            the Runmesh i18n into the otherwise-English Workflow
            Builder surface. The underlying `activeTab` state still
            defaults to ALL_TYPE_KEY so the list shows every kind. */}
        <div className="flex flex-col md:flex-row justify-start items-start md:items-center mb-6 space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4 flex-wrap md:flex-nowrap">
            <label className="flex items-center space-x-2 text-xs font-medium text-slate-600 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(e) => handleOnlyMineChange(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>{t('userDashboard.onlyMine')}</span>
            </label>

            <div className="relative">
              <button
                onClick={() => setShowGlobalTagSelector((v) => !v)}
                className="flex items-center space-x-2 bg-slate-100 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200 hover:border-slate-400 whitespace-nowrap"
              >
                <Icons.Tag className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {globalTags.length
                    ? t('userDashboard.tagsSelected', { count: globalTags.length })
                    : t('userDashboard.tagsAll')}
                </span>
                <Icons.ChevronDown
                  className={`w-3 h-3 text-slate-400 transition-transform ${
                    showGlobalTagSelector ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {showGlobalTagSelector && (
                <div className="absolute right-0 mt-2 z-30 bg-slate-100/80 rounded-lg p-1 shadow-sm">
                  <TagSelector
                    value={globalTags}
                    onChange={(tags) => setGlobalTags(tags)}
                    onSubmit={handleGlobalTagsApply}
                    onRequestClose={() => setShowGlobalTagSelector(false)}
                    placeholder={t('userDashboard.tag.searchOrCreate')}
                    maxTags={10}
                    mode="multiple"
                  />
                </div>
              )}
            </div>

            <div className="relative">
              <Icons.Search className="w-3.5 h-3.5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={t('userDashboard.search')}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                onBlur={handleSearch}
                className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none w-48 bg-slate-100 focus:bg-white transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
            <span className="ml-3 text-slate-500 text-sm">{t('userDashboard.loading')}</span>
          </div>
        )}

        {/* App Grid.
            'Create App' card (Create blank / Create from template /
            Import JSON / API Documentation) retired 2026-04-24 — the
            /dashboard page's primary CTA ('New workflow' button + 'or
            paste YAML' link) + sidebar entries already cover the
            create-a-new-workflow affordances without duplicating a
            card inside the grid. */}
        {!loading && (
          <div className="flex flex-wrap gap-4">
            {/* App Cards — flex-wrap with a fixed width per card means
                a sparse list (1–2 apps) just sits left-aligned with no
                phantom empty grid cells. Dense lists still flow into
                natural rows. */}
            {apps.map((app) => (
              <div
                key={`${app.workflowId}-${listRefreshKey}`}
                className="w-full sm:w-[calc(50%-0.5rem)] lg:w-[20rem]"
              >
                <AppCard
                  app={app}
                  onClick={() => handleAppClick(app)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onPublish={handlePublish}
                  onCancelPublish={handleCancelPublish}
                  onStatusChange={handleStatusChange}
                  onTagsUpdate={handleTagsUpdate}
                  isTagSelectorOpen={tagSelectorApp?.workflowId === app.workflowId}
                  tagSelectorContent={
                    <div
                      className="bg-white border border-slate-200 rounded-lg shadow-lg p-3"
                      onClick={(e) => e.stopPropagation()} // 防止下拉点击触发卡片事件
                    >
                      <TagSelector
                        value={tagSelected}
                        onChange={handleTagsChange}
                        onSubmit={handleTagsSubmit}
                        onRequestClose={() => setTagSelectorApp(null)}
                        placeholder={t('userDashboard.tag.searchOrCreate')}
                        maxTags={10}
                        mode="multiple"
                      />
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && apps.length === 0 && (
          <div className="mt-8 flex flex-col items-center justify-center text-slate-400 py-12 border-2 border-dashed border-slate-200 rounded-xl">
            <Icons.FileUp className="w-6 h-6 mb-2 text-slate-300" />
            <span className="text-xs">{t('userDashboard.empty')}</span>
          </div>
        )}

        {/* Stats */}
        {!loading && apps.length > 0 && (
          <div className="mt-6 text-xs text-slate-400">{t('userDashboard.total', { total })}</div>
        )}

        {/* Community Footer moved to AppLayout on 2026-04-24 so it
            appears on every page, not only the Workflow Builder. */}
      </div>

      {/* Import JSON Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {t('userDashboard.import.title')}
              </h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 p-1 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <label
                className="block"
                onDragEnter={handleImportDragOver}
                onDragOver={handleImportDragOver}
                onDragLeave={handleImportDragLeave}
                onDrop={handleImportDrop}
              >
                <div
                  className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${
                    isDraggingImport
                      ? 'bg-brand-50 border-brand-300'
                      : 'border-slate-200 hover:bg-slate-50 hover:border-brand-300'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3 group-hover:bg-brand-50 transition-colors">
                    <Icons.FileUp className="w-6 h-6 text-slate-400 group-hover:text-brand-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    {t('userDashboard.import.dropHint')}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {t('userDashboard.import.supportHint')}
                  </p>
                </div>
                <input type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
              </label>
            </div>
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {t('dialog.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 工作流编辑弹窗 */}
      {showEditModal && editingWorkflow && (
        <div ref={editModalRef} data-edit-modal>
          <WorkflowEditModal
            isOpen={showEditModal}
            onClose={handleCloseEditModal}
            workflowId={String(editingWorkflow?.workflowId ?? '')}
            onSave={handleWorkflowSave}
          />
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm.show && deleteConfirm.app && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {t('userDashboard.delete.title')}
              </h2>
              <button
                onClick={() => setDeleteConfirm({ show: false, app: null })}
                className="text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 p-1 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                  <Icons.AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">{t('userDashboard.delete.confirm')}</p>
                  <p className="font-medium text-slate-800">
                    {t('userDashboard.delete.confirmName', { name: deleteConfirm.app.name ?? '' })}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500 mb-6 space-y-2">
                <p>{t('userDashboard.delete.notice')}</p>
                <ul className="list-disc pl-5 space-y-1 mt-2">
                  <li>{t('userDashboard.delete.bullet.config')}</li>
                  <li>{t('userDashboard.delete.bullet.workflow')}</li>
                  <li>{t('userDashboard.delete.bullet.market')}</li>
                </ul>
                <p className="mt-3 text-red-600">{t('userDashboard.delete.warning')}</p>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirm({ show: false, app: null })}
                  className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t('dialog.cancel')}
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
                >
                  {t('userDashboard.delete.confirmButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 发布确认弹窗 */}
      {publishConfirm.show && publishConfirm.app && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {t('userDashboard.publish.title')}
              </h2>
              <button
                onClick={() => setPublishConfirm({ show: false, app: null })}
                className="text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 p-1 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                  <Icons.CheckCircle className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">{t('userDashboard.publish.confirm')}</p>
                  <p className="font-medium text-slate-800">
                    {t('userDashboard.publish.confirmName', {
                      name: publishConfirm.app.name ?? '',
                    })}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500 mb-6 space-y-2">
                <p>{t('userDashboard.publish.notice')}</p>
                <ul className="list-disc pl-5 space-y-1 mt-2">
                  <li>{t('userDashboard.publish.bullet.market')}</li>
                  <li>{t('userDashboard.publish.bullet.retry')}</li>
                  <li>{t('userDashboard.publish.bullet.processing')}</li>
                </ul>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setPublishConfirm({ show: false, app: null })}
                  className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t('dialog.cancel')}
                </button>
                <button
                  onClick={confirmPublish}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                >
                  {t('userDashboard.publish.confirmButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 取消发布确认弹窗 */}
      {cancelPublishConfirm.show && cancelPublishConfirm.app && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {t('userDashboard.cancelPublish.title')}
              </h2>
              <button
                onClick={() => setCancelPublishConfirm({ show: false, app: null })}
                className="text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 p-1 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
                  <Icons.XOctagon className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">
                    {t('userDashboard.cancelPublish.confirm')}
                  </p>
                  <p className="font-medium text-slate-800">
                    {t('userDashboard.cancelPublish.confirmName', {
                      name: cancelPublishConfirm.app.name ?? '',
                    })}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500 mb-6">
                {t('userDashboard.cancelPublish.notice')}
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setCancelPublishConfirm({ show: false, app: null })}
                  className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t('dialog.cancel')}
                </button>
                <button
                  onClick={confirmCancelPublish}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
                >
                  {t('userDashboard.cancelPublish.confirmButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 状态变更确认弹窗 */}
      {statusConfirm.show && statusConfirm.app && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {t('userDashboard.statusConfirm.title', {
                  action:
                    statusConfirm.action === 'disable'
                      ? t('userDashboard.action.disable')
                      : t('userDashboard.action.enable'),
                })}
              </h2>
              <button
                onClick={() => setStatusConfirm({ show: false, app: null, action: '' })}
                className="text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 p-1 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center">
                  <Icons.Power className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">
                    {t('userDashboard.statusConfirm.confirm', {
                      action:
                        statusConfirm.action === 'disable'
                          ? t('userDashboard.action.disable')
                          : t('userDashboard.action.enable'),
                    })}
                  </p>
                  <p className="font-medium text-slate-800">
                    {t('userDashboard.statusConfirm.confirmName', {
                      name: statusConfirm.app.name ?? '',
                    })}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500 mb-6 space-y-2">
                <p>{t('userDashboard.statusConfirm.notice')}</p>
                <ul className="list-disc pl-5 space-y-1 mt-2">
                  <li>{t('userDashboard.statusConfirm.bullet.enable')}</li>
                  <li>{t('userDashboard.statusConfirm.bullet.disable')}</li>
                  <li>{t('userDashboard.statusConfirm.bullet.instant')}</li>
                </ul>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setStatusConfirm({ show: false, app: null, action: '' })}
                  className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t('dialog.cancel')}
                </button>
                <button
                  onClick={confirmStatusChange}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
                >
                  {t('userDashboard.statusConfirm.confirmButton', {
                    action:
                      statusConfirm.action === 'disable'
                        ? t('userDashboard.action.disable')
                        : t('userDashboard.action.enable'),
                  })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast通知容器 */}
      {toastContainer()}
    </div>
  );
};

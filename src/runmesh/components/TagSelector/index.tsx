import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useToast } from '@/runmesh/components/Toast';
import { createTag, deleteTag, getAllTags, TagItem, updateTag } from '@/runmesh/api/user/tags';
import { useLanguage } from '@/runmesh/i18n';

export interface Tag {
  id: string;
  name: string;
  code?: string;
  color?: string;
  count?: number;
  // True when the row came from the read-only workflow-types list
  // (runmesh_workflow_type) rather than the user-editable tags table
  // (runmesh_workflow_tag). Write ops (rename/delete) only work for
  // the latter, so the UI hides those controls when system=true.
  system?: boolean;
}

interface TagSelectorProps {
  value: string[];
  onChange: (tags: string[]) => void;
  onSubmit?: (tags: string[]) => void;
  onRequestClose?: () => void;
  placeholder?: string;
  maxTags?: number;
  mode?: 'single' | 'multiple';
  autoSubmitOnOutside?: boolean;
  showManage?: boolean;
  showCreate?: boolean;
}

const STORAGE_KEY = 'workflow_tags_cache';

export const TagSelector: React.FC<TagSelectorProps> = ({
  value,
  onChange,
  onSubmit,
  onRequestClose,
  placeholder,
  maxTags = 10,
  mode = 'multiple',
  autoSubmitOnOutside = true,
  showManage = true,
  showCreate = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string[]>(value || []);
  const [loading, setLoading] = useState(false);
  const [isManaging, setIsManaging] = useState(false);
  const [manageInput, setManageInput] = useState('');
  const [editingMap, setEditingMap] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreateInput, setShowCreateInput] = useState(false);

  useEffect(() => {
    setPending(value || []);
  }, [value]);

  // TagSelector is also used as the workflow-types filter. The backend
  // ships a handful of its type names in zh-CN even when the app is in
  // en-US. Map the well-known ones so the dropdown reads in English.
  // Unknown tag names (user-created) pass through unchanged.
  const translateTagName = (name: string): string => {
    const map: Record<string, string> = {
      全部: 'All',
      工作流: 'Workflow',
      对话流: 'Chatflow',
      智能体: 'Agent',
      文本生成: 'Text generator',
      图像生成: 'Image generator',
      语音: 'Voice',
      问答: 'Q&A',
      聊天机器人: 'Chatbot',
    };
    return map[name] || name;
  };

  const normalizeTags = (list: TagItem[]) =>
    list.map((tag: TagItem, idx: number) => {
      const rawName = tag.name || tag.typeName || tag.typeCode || t('tagSelector.unnamed');
      const name = translateTagName(rawName);
      const code = tag.typeCode || tag.typeName || tag.tagId?.toString();
      const id =
        tag.tagId?.toString() ||
        tag.typeId?.toString() ||
        tag.typeCode ||
        tag.typeName ||
        `type-${idx}`;
      // tagId comes from runmesh_workflow_tag (user-editable); absence
      // of tagId means this row is a workflow-type alias, which the
      // delete/update endpoints can't touch.
      const system = tag.tagId == null;
      return {
        id,
        name,
        code,
        count: tag.count || 0,
        system,
      };
    });

  const cacheTags = (tags: Tag[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
    } catch (error) {
      console.error('Failed to save tags to local cache:', error);
    }
  };

  const loadTags = useCallback(async () => {
    try {
      setLoading(true);
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        // Translate cached names too — the cache may predate the
        // zh→en mapping and would otherwise flash Chinese for a beat
        // before the fresh API response overwrites it.
        const tags: Tag[] = JSON.parse(cached);
        setAllTags(tags.map((t) => ({ ...t, name: translateTagName(t.name) })));
      }

      const apiTags = await getAllTags();
      const normalized = normalizeTags(apiTags);
      setAllTags(normalized);
      cacheTags(normalized);
    } catch (error) {
      console.error('Failed to load tags, using cache:', error);
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const tags: Tag[] = JSON.parse(cached);
        setAllTags(tags.map((t) => ({ ...t, name: translateTagName(t.name) })));
      }
    } finally {
      setLoading(false);
    }
    // translateTagName closes over `t` but is stable enough for our needs;
    // re-declaring as a dep would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const filteredTags = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return allTags;
    return allTags.filter(
      (tag) =>
        tag.name?.toLowerCase().includes(keyword) || tag.code?.toLowerCase().includes(keyword),
    );
  }, [allTags, search]);

  const applyChange = useCallback(
    (next: string[]) => {
      setPending(next);
      onChange(next);
    },
    [onChange],
  );

  const handleSelect = (tagName: string) => {
    if (mode === 'single') {
      applyChange([tagName]);
      return;
    }

    if (pending.includes(tagName)) {
      applyChange(pending.filter((t) => t !== tagName));
      return;
    }

    if (pending.length >= maxTags) {
      showToast({
        type: 'warning',
        message: t('tagSelector.toast.maxTags', { count: maxTags }),
      });
      return;
    }
    applyChange([...pending, tagName]);
  };

  const handleCreateTag = useCallback(
    async (name?: string) => {
      const newName = (name || search).trim();
      if (!newName) return;
      try {
        setSavingId('create');
        const newId = await createTag(newName);
        const newTag: Tag = { id: String(newId), name: newName };
        const updated = [...allTags, newTag];
        setAllTags(updated);
        cacheTags(updated);
        applyChange(mode === 'single' ? [newName] : Array.from(new Set([...pending, newName])));
        showToast({
          type: 'success',
          message: t('tagSelector.toast.createSuccess', { name: newName }),
        });
        setManageInput('');
        setSearch('');
        setShowCreateInput(false);
      } catch (error) {
        console.error('Failed to create tag', error);
        showToast({ type: 'error', message: t('tagSelector.toast.createFailed') });
      } finally {
        setSavingId(null);
      }
    },
    [allTags, applyChange, mode, pending, search, showToast],
  );

  const handleUpdateTag = useCallback(
    async (tagId: string, name: string, originalName?: string) => {
      const newName = name.trim();
      const prevName = originalName || allTags.find((t) => t.id === tagId)?.name || '';
      if (!newName || !prevName) return;
      try {
        setSavingId(tagId);
        await updateTag(Number(tagId), newName);
        const updated = allTags.map((tag) => (tag.id === tagId ? { ...tag, name: newName } : tag));
        setAllTags(updated);
        cacheTags(updated);
        applyChange(pending.map((t) => (t === prevName ? newName : t)));
        showToast({ type: 'success', message: t('tagSelector.toast.updateSuccess') });
      } catch (error) {
        console.error('Failed to update tag', error);
        showToast({ type: 'error', message: t('tagSelector.toast.updateFailed') });
      } finally {
        setSavingId(null);
        setEditingMap((prev) => {
          const next = { ...prev };
          delete next[tagId];
          return next;
        });
      }
    },
    [allTags, applyChange, pending, showToast],
  );

  const handleDeleteTag = useCallback(
    async (tagId: string) => {
      const target = allTags.find((tag) => tag.id === tagId);
      try {
        setDeletingId(tagId);
        await deleteTag(Number(tagId));
        const updated = allTags.filter((tag) => tag.id !== tagId);
        setAllTags(updated);
        cacheTags(updated);
        const toRemove = [target?.name, target?.code, tagId].filter(Boolean) as string[];
        applyChange(pending.filter((t) => !toRemove.includes(t)));
        showToast({ type: 'success', message: t('tagSelector.toast.deleteSuccess') });
      } catch (error) {
        console.error('Failed to delete tag', error);
        showToast({ type: 'error', message: t('tagSelector.toast.deleteFailed') });
      } finally {
        setDeletingId(null);
      }
    },
    [allTags, applyChange, pending, showToast],
  );

  const handleSubmit = useCallback(() => {
    onSubmit?.(pending);
    onRequestClose?.();
  }, [onRequestClose, onSubmit, pending]);

  useEffect(() => {
    if (!autoSubmitOnOutside) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      if (isManaging) return;
      handleSubmit();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [autoSubmitOnOutside, handleSubmit, isManaging]);

  return (
    <div
      ref={containerRef}
      className="w-[320px] bg-white border border-slate-200 rounded-lg shadow-lg p-3"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icons.Search className="w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder ?? t('tagSelector.placeholder')}
          className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        {showCreate && search.trim() && (
          <button
            onClick={() => handleCreateTag()}
            className="flex items-center text-xs text-brand-600 px-2 py-1 rounded border border-brand-200 hover:bg-brand-50"
          >
            <Icons.Plus className="w-3 h-3 mr-1" />
            {t('tagSelector.action.create')}
          </button>
        )}
      </div>

      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {loading && (
          <div className="text-xs text-slate-400 px-2 py-1">{t('tagSelector.loading')}</div>
        )}
        {!loading && filteredTags.length === 0 && (
          <div className="text-xs text-slate-400 px-2 py-1">{t('tagSelector.empty')}</div>
        )}
        {filteredTags.map((tag) => {
          const checked =
            pending.includes(tag.name) ||
            pending.includes(tag.code || '') ||
            pending.includes(tag.id);
          return (
            <label
              key={tag.id}
              className="flex items-center justify-between px-2 py-1 rounded hover:bg-slate-50 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <input
                  type={mode === 'single' ? 'radio' : 'checkbox'}
                  checked={checked}
                  onChange={() => handleSelect(tag.name)}
                  className="text-brand-600 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">{tag.name}</span>
                {tag.count !== undefined && (
                  <span className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    {tag.count}
                  </span>
                )}
              </div>
              {checked && <Icons.Check className="w-3.5 h-3.5 text-brand-600" />}
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-3">
        {showManage ? (
          <button
            onClick={() => setIsManaging(true)}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <Icons.Settings className="w-4 h-4" />
            {t('tagSelector.manage')}
          </button>
        ) : (
          <span className="text-xs text-slate-400">{t('tagSelector.autoSave')}</span>
        )}
        <div className="space-x-2">
          <button
            onClick={() => onRequestClose?.()}
            className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-50"
          >
            {t('tagSelector.action.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-xs text-white bg-brand-600 rounded hover:bg-brand-700"
          >
            {t('tagSelector.action.apply')}
          </button>
        </div>
      </div>

      {isManaging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-slate-800">
                {t('tagSelector.manageTitle')}
              </h3>
              <button
                onClick={() => {
                  setIsManaging(false);
                  setShowCreateInput(false);
                  setManageInput('');
                  setEditingMap({});
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-6">
              {/* 左侧：创建新标签按钮 */}
              <div className="flex-shrink-0">
                {!showCreateInput ? (
                  <button
                    onClick={() => setShowCreateInput(true)}
                    className="px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors"
                  >
                    {t('tagSelector.action.createNew')}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={manageInput}
                      onChange={(e) => setManageInput(e.target.value)}
                      placeholder={t('tagSelector.manage.inputPlaceholder')}
                      className="w-48 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && manageInput.trim()) {
                          handleCreateTag(manageInput);
                        } else if (e.key === 'Escape') {
                          setShowCreateInput(false);
                          setManageInput('');
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (manageInput.trim()) {
                            handleCreateTag(manageInput);
                          }
                        }}
                        disabled={!manageInput.trim() || savingId === 'create'}
                        className="px-3 py-1.5 text-xs text-white bg-brand-600 rounded hover:bg-brand-700 disabled:opacity-50"
                      >
                        {t('tagSelector.action.add')}
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateInput(false);
                          setManageInput('');
                        }}
                        className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded hover:bg-slate-50"
                      >
                        {t('tagSelector.action.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 右侧：标签列表 */}
              <div className="flex-1">
                <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto pr-2">
                  {allTags.map((tag) => {
                    const isEditing = editingMap[tag.id] !== undefined;
                    const displayName = isEditing ? editingMap[tag.id] : tag.name;
                    return (
                      <div
                        key={tag.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        {isEditing ? (
                          <>
                            <input
                              value={displayName}
                              onChange={(e) =>
                                setEditingMap((prev) => ({
                                  ...prev,
                                  [tag.id]: e.target.value,
                                }))
                              }
                              className="text-sm border border-slate-300 rounded px-2 py-0.5 focus:ring-2 focus:ring-brand-500 focus:outline-none bg-white min-w-[80px]"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleUpdateTag(tag.id, displayName, tag.name);
                                } else if (e.key === 'Escape') {
                                  setEditingMap((prev) => {
                                    const next = { ...prev };
                                    delete next[tag.id];
                                    return next;
                                  });
                                }
                              }}
                            />
                            <button
                              onClick={() => handleUpdateTag(tag.id, displayName, tag.name)}
                              disabled={savingId === tag.id || !displayName.trim()}
                              className="text-slate-500 hover:text-brand-600 transition-colors disabled:opacity-50"
                              title={t('tagSelector.action.save')}
                            >
                              <Icons.Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingMap((prev) => {
                                  const next = { ...prev };
                                  delete next[tag.id];
                                  return next;
                                });
                              }}
                              className="text-slate-500 hover:text-slate-700 transition-colors"
                              title={t('tagSelector.action.cancel')}
                            >
                              <Icons.X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-sm text-slate-700">{tag.name}</span>
                            {!tag.system && (
                              <>
                                <button
                                  onClick={() =>
                                    setEditingMap((prev) => ({ ...prev, [tag.id]: tag.name }))
                                  }
                                  className="text-slate-400 hover:text-brand-600 transition-colors"
                                  title={t('tagSelector.action.edit')}
                                >
                                  <Icons.Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTag(tag.id)}
                                  disabled={deletingId === tag.id}
                                  className="text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                  title={t('tagSelector.action.delete')}
                                >
                                  <Icons.Trash className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

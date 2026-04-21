import React, { useState, useEffect, useCallback, useRef } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { Icons } from '@/runmesh/components/Icons';
import { getWorkflowDetail, updateWorkflow } from '@/runmesh/api/user/workflow';
import { WorkflowItem } from '@/runmesh/api/user/workflow';
import { useToast } from '@/runmesh/components/Toast';
import { ConfirmDialog } from '@/runmesh/components/ConfirmDialog';
import { http } from '@/runmesh/utils/axios';
import { useLanguage } from '@/runmesh/i18n';

interface WorkflowEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string;
  onSave?: (updatedWorkflow: WorkflowItem) => void;
}

export const WorkflowEditModal: React.FC<WorkflowEditModalProps> = ({
  isOpen,
  onClose,
  workflowId,
  onSave,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workflowData, setWorkflowData] = useState<WorkflowItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  const [basicInfo, setBasicInfo] = useState({
    name: '',
    description: '',
    appType: 'workflow',
    icon: '',
    tags: '',
    remark: '',
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState({
    show: false,
    type: 'close' as 'close' | 'cancel',
    message: '',
    title: '',
  });

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toastContainer, showError, showSuccess } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const { t, language } = useLanguage();

  // 加载工作流数据
  const loadWorkflow = useCallback(async () => {
    console.log(workflowId);

    if (!workflowId) return;

    setLoading(true);
    setError(null);
    try {
      const workflow = await getWorkflowDetail(workflowId);
      if (workflow) {
        setWorkflowData(workflow);
        setIsActive(workflow.status === '1');
        setBasicInfo({
          name: workflow.name || '',
          description: workflow.description || '',
          appType: workflow.appType || 'workflow',
          icon: workflow.icon || '',
          tags: workflow.tags || '',
          remark: workflow.remark || '',
        });
        setHasUnsavedChanges(false);
      } else {
        setError(t('workflowEdit.toast.notFound'));
      }
    } catch (err) {
      console.error('Failed to load workflow:', err);
      const message = err instanceof Error ? err.message : t('workflowEdit.error.unknown');
      setError(t('workflowEdit.toast.loadFailed', { message }));
    } finally {
      setLoading(false);
    }
  }, [workflowId, t]);

  // 当弹窗打开且有 ID 时加载数据
  useEffect(() => {
    if (isOpen && workflowId) {
      loadWorkflow();
    } else if (!isOpen) {
      // 关闭时重置状态
      setWorkflowData(null);
      setError(null);
      setHasUnsavedChanges(false);
    }
  }, [isOpen, workflowId, loadWorkflow]);

  // 保存工作流
  const handleSave = async () => {
    if (!workflowData || !workflowId) {
      showError(t('workflowEdit.toast.notReady'));
      return;
    }

    setSaving(true);
    try {
      // 构建更新数据，确保包含所有必填字段和原有字段
      const updateData: Partial<WorkflowItem> = {
        ...workflowData, // 先展开原有数据，确保 definitionJson, version 等不丢失
        workflowId: workflowId,
        name: basicInfo.name,
        description: basicInfo.description,
        status: isActive ? '1' : '0',
        remark: basicInfo.remark,
        appType: basicInfo.appType,
        icon: basicInfo.icon,
        tags: basicInfo.tags,
      };

      await updateWorkflow(updateData);

      // 更新后的完整对象
      const updatedWorkflow = {
        ...workflowData,
        ...updateData,
        updateTime: new Date().toISOString(),
      } as WorkflowItem;

      setWorkflowData(updatedWorkflow);
      setHasUnsavedChanges(false);
      showSuccess(t('workflowEdit.toast.saveSuccess'));

      if (onSave) {
        onSave(updatedWorkflow);
      }
    } catch (err) {
      console.error('Failed to save workflow:', err);
      const message = err instanceof Error ? err.message : t('workflowEdit.error.unknown');
      showError(t('workflowEdit.toast.saveFailed', { message }));
    } finally {
      setSaving(false);
    }
  };

  // 点击外部收起 emoji 选择器
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验文件类型和大小
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      showError(t('workflowEdit.toast.upload.invalidType'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showError(t('workflowEdit.toast.upload.tooLarge'));
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await http.upload<{ url: string }>('/resource/oss/upload', formData);
      setBasicInfo((prev) => ({ ...prev, icon: res.url }));
      setHasUnsavedChanges(true);
      showSuccess(t('workflowEdit.toast.upload.success'));
    } catch (err) {
      console.error('Upload failed:', err);
      const message = err instanceof Error ? err.message : t('workflowEdit.error.unknown');
      showError(t('workflowEdit.toast.upload.failed', { message }));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  const handleConfirmClose = () => {
    setShowConfirmDialog({ ...showConfirmDialog, show: false });
    onClose();
  };

  const handleCancelConfirm = () => {
    setShowConfirmDialog({ ...showConfirmDialog, show: false });
  };

  const handleCloseClick = () => {
    if (hasUnsavedChanges) {
      setShowConfirmDialog({
        show: true,
        type: 'close',
        message: t('workflowEdit.confirm.close.message'),
        title: t('workflowEdit.confirm.close.title'),
      });
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg font-semibold text-slate-800">
              {t('workflowEdit.header.title', {
                name: workflowData?.name || t('workflowEdit.header.loadingName'),
              })}
            </h2>
            <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded">
              ID: {workflowId}
            </span>
          </div>
          <div className="flex items-center space-x-3">
            {/* 激活开关 */}
            <div className="flex items-center space-x-2">
              <span
                className={`text-xs font-medium ${isActive ? 'text-green-600' : 'text-slate-400'}`}
              >
                {isActive ? t('workflowEdit.status.active') : t('workflowEdit.status.inactive')}
              </span>
              <button
                disabled={loading}
                onClick={() => {
                  setIsActive(!isActive);
                  setHasUnsavedChanges(true);
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${isActive ? 'bg-green-500' : 'bg-slate-300'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ease-in-out ${isActive ? 'translate-x-5' : 'translate-x-1'}`}
                />
              </button>
            </div>

            <button
              onClick={handleCloseClick}
              className="p-1 hover:bg-slate-100 rounded-full transition-colors"
            >
              <Icons.X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Icons.AlertCircle className="w-8 h-8 text-brand-600 animate-spin mx-auto mb-4" />
                <p className="text-slate-600">{t('workflowEdit.loading')}</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Icons.AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-4" />
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={loadWorkflow}
                  className="px-4 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700 transition-colors"
                >
                  {t('workflowEdit.action.reload')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-white rounded-lg border border-slate-200 p-6">
                <h3 className="font-medium text-slate-800 mb-4">
                  {t('workflowEdit.section.basic')}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('workflowEdit.field.name')} *
                    </label>
                    <input
                      type="text"
                      value={basicInfo.name}
                      onChange={(e) => {
                        setBasicInfo((prev) => ({ ...prev, name: e.target.value }));
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={t('workflowEdit.field.namePlaceholder')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('workflowEdit.field.type')}
                    </label>
                    <select
                      value={basicInfo.appType}
                      onChange={(e) => {
                        setBasicInfo((prev) => ({ ...prev, appType: e.target.value }));
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="workflow">{t('workflowEdit.type.workflow')}</option>
                      <option value="chatflow">{t('workflowEdit.type.chatflow')}</option>
                      <option value="chatbot">{t('workflowEdit.type.chatbot')}</option>
                      <option value="agent">{t('workflowEdit.type.agent')}</option>
                      <option value="text_generator">{t('workflowEdit.type.textGenerator')}</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('workflowEdit.field.description')}
                    </label>
                    <textarea
                      value={basicInfo.description}
                      onChange={(e) => {
                        setBasicInfo((prev) => ({ ...prev, description: e.target.value }));
                        setHasUnsavedChanges(true);
                      }}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={t('workflowEdit.field.descriptionPlaceholder')}
                    />
                  </div>

                  <div className="relative">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('workflowEdit.field.icon')}
                    </label>
                    <div className="flex items-center gap-3">
                      {/* Emoji 选择按钮 */}
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        className="px-3 py-2 border border-slate-300 rounded-md bg-white hover:border-brand-400 focus:ring-2 focus:ring-brand-500 focus:outline-none text-sm min-w-[64px] flex items-center justify-center"
                        title={t('workflowEdit.field.iconPickEmoji')}
                      >
                        {basicInfo.icon && !basicInfo.icon.startsWith('http') ? (
                          <span className="text-xl align-middle">{basicInfo.icon}</span>
                        ) : (
                          <span className="text-slate-400">
                            {t('workflowEdit.field.iconEmoji')}
                          </span>
                        )}
                      </button>

                      {/* 图片上传按钮 */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="px-3 py-2 border border-slate-300 rounded-md bg-white hover:border-brand-400 focus:ring-2 focus:ring-brand-500 focus:outline-none text-sm min-w-[64px] flex items-center justify-center"
                        title={t('workflowEdit.field.iconUpload')}
                      >
                        {isUploading ? (
                          <Icons.RefreshCw className="w-5 h-5 text-brand-600 animate-spin" />
                        ) : basicInfo.icon && basicInfo.icon.startsWith('http') ? (
                          <img src={basicInfo.icon} alt="icon" className="w-6 h-6 object-contain" />
                        ) : (
                          <Icons.Image className="w-5 h-5 text-slate-400" />
                        )}
                      </button>

                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*"
                      />

                      {basicInfo.icon && (
                        <button
                          type="button"
                          onClick={() => {
                            setBasicInfo((prev) => ({ ...prev, icon: '' }));
                            setHasUnsavedChanges(true);
                          }}
                          className="text-xs text-slate-500 hover:text-red-500"
                        >
                          {t('workflowEdit.action.clear')}
                        </button>
                      )}
                    </div>
                    {showEmojiPicker && (
                      <div className="absolute z-40 mt-2" ref={emojiPickerRef}>
                        <Picker
                          data={data}
                          onEmojiSelect={(emoji: { native?: string }) => {
                            const native = emoji.native || '';
                            setBasicInfo((prev) => ({ ...prev, icon: native }));
                            setHasUnsavedChanges(true);
                            setShowEmojiPicker(false);
                          }}
                          locale={language.startsWith('zh') ? 'zh' : 'en'}
                          theme="light"
                        />
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('workflowEdit.field.remark')}
                    </label>
                    <textarea
                      value={basicInfo.remark}
                      onChange={(e) => {
                        setBasicInfo((prev) => ({ ...prev, remark: e.target.value }));
                        setHasUnsavedChanges(true);
                      }}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={t('workflowEdit.field.remarkPlaceholder')}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-slate-200 flex justify-end space-x-3">
          <button
            onClick={handleCloseClick}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
          >
            {t('workflowEdit.action.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !workflowData}
            className="px-4 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('workflowEdit.action.saving') : t('workflowEdit.action.save')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showConfirmDialog.show}
        title={showConfirmDialog.title}
        message={showConfirmDialog.message}
        onConfirm={handleConfirmClose}
        onCancel={handleCancelConfirm}
      />
      {toastContainer()}
    </div>
  );
};

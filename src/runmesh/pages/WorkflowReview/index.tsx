import React, { useState, useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useToast } from '@/runmesh/components/Toast';
import { useEnterpriseTip } from '@/runmesh/components/EnterpriseTip';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import { workflowReviewApi } from '@/runmesh/api/workflowReviewApi';
import { WorkflowReviewItem, WorkflowReviewQuery, AuditStatus } from '@/runmesh/types/workflowReview';
import { useLanguage } from '@/runmesh/i18n';

// 应用详情编辑弹窗组件
const AppDetailModal: React.FC<{
  review: WorkflowReviewItem;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (reviewId: number, workflowId: number, reason?: string) => void;
  onReject: (reviewId: number, workflowId: number, reason: string) => void;
}> = ({ review, isOpen, onClose, onApprove, onReject }) => {
  const { t } = useLanguage();
  const [auditReason, setAuditReason] = useState<string>('');
  const { warning } = useEnterpriseTip();

  // 弹窗打开时重置备注
  useEffect(() => {
    if (isOpen) {
      setAuditReason('');
    }
  }, [isOpen]);

  if (!isOpen || !review) return null;

  const handleApprove = () => {
    onApprove(review.reviewId || 0, review.workflowId || 0, auditReason || undefined);
  };

  const handleReject = () => {
    if (!auditReason.trim()) {
      warning(t('workflowReview.validation.rejectReasonRequired'));
      return;
    }
    onReject(review.reviewId || 0, review.workflowId || 0, auditReason);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800">{t('workflowReview.detail.title')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 基本信息 */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 block">
                {t('workflowReview.detail.appName')}
              </label>
              <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-slate-900">{review.name}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block">
                  {t('workflowReview.detail.appType')}
                </label>
                <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-900">
                    {review.appType === 'workflow'
                      ? t('workflowReview.appType.workflow')
                      : review.appType === 'chatbot'
                        ? t('workflowReview.appType.chatbot')
                        : review.appType === 'agent'
                          ? t('workflowReview.appType.agent')
                          : review.appType === 'text_generator'
                            ? t('workflowReview.appType.textGenerator')
                            : review.appType}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block">
                  {t('workflowReview.detail.version')}
                </label>
                <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-900">v{review.version}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block">
                {t('workflowReview.detail.description')}
              </label>
              <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-slate-900">{review.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block">
                  {t('workflowReview.detail.submitter')}
                </label>
                <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-900">
                    {review.submitterName || t('workflowReview.common.unknown')}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block">
                  {t('workflowReview.detail.submitTime')}
                </label>
                <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-900">
                    {review.submitTime
                      ? new Date(review.submitTime).toLocaleString()
                      : t('workflowReview.common.na')}
                  </p>
                </div>
              </div>
            </div>

            {review.auditStatus !== AuditStatus.PENDING && (
              <>
                <div>
                  <label className="text-sm font-medium text-slate-700 block">
                    {t('workflowReview.detail.reviewer')}
                  </label>
                  <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-slate-900">
                      {review.auditUserName || t('workflowReview.common.na')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700 block">
                      {t('workflowReview.detail.auditTime')}
                    </label>
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="text-slate-900">
                        {review.auditTime
                          ? new Date(review.auditTime).toLocaleString()
                          : t('workflowReview.common.na')}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700 block">
                      {t('workflowReview.detail.auditStatus')}
                    </label>
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <span
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                        bg-slate-100 text-slate-800"
                      >
                        {review.auditStatus === AuditStatus.APPROVED
                          ? t('workflowReview.status.approved')
                          : review.auditStatus === AuditStatus.REJECTED
                            ? t('workflowReview.status.rejected')
                            : t('workflowReview.status.unknown')}
                      </span>
                    </div>
                  </div>
                </div>

                {review.auditReason && (
                  <div>
                    <label className="text-sm font-medium text-slate-700 block">
                      {t('workflowReview.detail.auditReason')}
                    </label>
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="text-slate-900">{review.auditReason}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 审核备注 */}
          {review.auditStatus === AuditStatus.PENDING && (
            <div className="border-t border-slate-200 pt-6">
              <div>
                <label className="text-sm font-medium text-slate-700 block">
                  <span className="text-red-500 ml-1">*</span>
                  {t('workflowReview.detail.auditNote')}
                </label>
                <textarea
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                  placeholder={t('workflowReview.detail.auditNotePlaceholder')}
                  className="w-full mt-2 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  rows={4}
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-sm"
          >
            {t('workflowReview.action.close')}
          </button>
          {review.auditStatus === AuditStatus.PENDING && (
            <div className="flex space-x-3">
              <button
                onClick={handleReject}
                className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                {t('workflowReview.action.reject')}
              </button>
              <button
                onClick={handleApprove}
                className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                {t('workflowReview.action.approve')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 简单的确认对话框组件
const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, type = 'warning', onConfirm, onCancel }) => {
  const { t } = useLanguage();
  const getButtonColor = () => {
    switch (type) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700';
      case 'warning':
        return 'bg-yellow-600 hover:bg-yellow-700';
      default:
        return 'bg-brand-600 hover:bg-brand-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <p className="text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {t('workflowReview.action.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${getButtonColor()}`}
          >
            {t('workflowReview.action.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

const WorkflowReview: React.FC = () => {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<WorkflowReviewItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [pagination, setPagination] = useState({
    pageNum: 1,
    pageSize: 10,
    total: 0,
  });
  const [filters, setFilters] = useState<Partial<WorkflowReviewQuery>>({
    name: '',
    appType: '',
    auditStatus: '',
  });

  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [currentReview, setCurrentReview] = useState<WorkflowReviewItem | null>(null);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // 获取审核列表
  const fetchReviewList = async () => {
    try {
      setLoading(true);
      const result = await workflowReviewApi.getReviewList({
        ...filters,
        pageNum: pagination.pageNum,
        pageSize: pagination.pageSize,
      });
      setReviews(result.rows || []);
      setPagination((prev) => ({
        ...prev,
        total: result.total,
      }));
    } catch (error: any) {
      console.error('Failed to fetch review list:', error);
      showToast({
        type: 'error',
        message: error.message || t('workflowReview.toast.fetchFailed'),
      });
    } finally {
      setLoading(false);
    }
  };

  // 初次加载和过滤条件变化时获取数据
  useEffect(() => {
    fetchReviewList();
  }, [filters, pagination.pageNum, pagination.pageSize]);

  // 处理筛选
  const handleFilterChange = (key: keyof WorkflowReviewQuery, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    // 重置到第一页
    setPagination((prev) => ({
      ...prev,
      pageNum: 1,
    }));
  };

  // 审核操作
  const handleAudit = async (
    reviewId: number,
    workflowId: number,
    status: 'approve' | 'reject',
    reason?: string,
  ) => {
    try {
      await workflowReviewApi.auditReview({
        reviewId: reviewId,
        workflowId: workflowId,
        auditStatus: status === 'approve' ? AuditStatus.APPROVED : AuditStatus.REJECTED,
        auditReason: status === 'reject' ? reason : undefined,
      });

      showToast({
        type: 'success',
        message:
          status === 'approve'
            ? t('workflowReview.toast.approveSuccess')
            : t('workflowReview.toast.rejectSuccess'),
      });

      // 刷新列表
      fetchReviewList();
      setShowDetailModal(false);
      setCurrentReview(null);
    } catch (error: any) {
      console.error('Review action failed:', error);
      showToast({
        type: 'error',
        message: error.message || t('workflowReview.toast.auditFailed'),
      });
    }
  };

  // 打开详情对话框
  const openDetailModal = (review: WorkflowReviewItem) => {
    setCurrentReview(review);
    setShowDetailModal(true);
  };

  // 删除审核记录
  const handleDeleteReview = async (reviewId: number) => {
    try {
      setLoading(true);
      await workflowReviewApi.deleteReview(reviewId);
      showToast({
        type: 'success',
        message: t('workflowReview.toast.deleteSuccess'),
      });
      // 刷新列表
      fetchReviewList();
    } catch (error: any) {
      console.error('Failed to delete review record:', error);
      showToast({
        type: 'error',
        message: error.message || t('workflowReview.toast.deleteFailed'),
      });
    } finally {
      setLoading(false);
    }
  };

  // 获取状态标签
  const getStatusBadge = (status?: string) => {
    if (!status) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
          {t('workflowReview.status.unknown')}
        </span>
      );
    }
    switch (status) {
      case AuditStatus.PENDING:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            {t('workflowReview.status.pending')}
          </span>
        );
      case AuditStatus.APPROVED:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            {t('workflowReview.status.approved')}
          </span>
        );
      case AuditStatus.REJECTED:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            {t('workflowReview.status.rejected')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
            {status}
          </span>
        );
    }
  };

  // 获取应用类型名称
  const getAppTypeName = (appType?: string) => {
    if (!appType) return t('workflowReview.common.unknown');
    switch (appType) {
      case 'workflow':
        return t('workflowReview.appType.workflow');
      case 'chatbot':
        return t('workflowReview.appType.chatbot');
      case 'agent':
        return t('workflowReview.appType.agent');
      case 'text_generator':
        return t('workflowReview.appType.textGenerator');
      default:
        return appType;
    }
  };

  const columns: TableColumn<WorkflowReviewItem>[] = [
    {
      key: 'name',
      title: t('workflowReview.table.name'),
      render: (review) => <div className="text-xs font-medium text-slate-900">{review.name}</div>,
    },
    {
      key: 'appType',
      title: t('workflowReview.table.type'),
      render: (review) => (
        <span className="text-xs text-slate-700">{getAppTypeName(review.appType)}</span>
      ),
    },
    {
      key: 'description',
      title: t('workflowReview.table.description'),
      render: (review) => (
        <div className="text-xs text-slate-700 max-w-xs truncate" title={review.description}>
          {review.description}
        </div>
      ),
    },
    {
      key: 'submitterName',
      title: t('workflowReview.table.submitter'),
      render: (review) => <span className="text-xs text-slate-700">{review.submitterName}</span>,
    },
    {
      key: 'submitTime',
      title: t('workflowReview.table.submitTime'),
      render: (review) => (
        <span className="text-xs text-slate-600">
          {review.submitTime
            ? new Date(review.submitTime).toLocaleString()
            : t('workflowReview.common.na')}
        </span>
      ),
    },
    {
      key: 'auditStatus',
      title: t('workflowReview.table.status'),
      render: (review) => getStatusBadge(review.auditStatus),
    },
  ];

  const rowActions: TableAction<WorkflowReviewItem>[] = [
    {
      key: 'detail',
      label: t('workflowReview.action.view'),
      icon: <Icons.Edit className="w-4 h-4" />,
      onClick: (record) => openDetailModal(record),
      tooltip: t('workflowReview.action.viewDetail'),
      type: 'secondary',
    },
    {
      key: 'delete',
      label: t('workflowReview.action.delete'),
      icon: <Icons.Trash className="w-4 h-4" />,
      onClick: (record) =>
        setConfirmDialog({
          show: true,
          title: t('workflowReview.confirm.delete.title'),
          message: t('workflowReview.confirm.delete.message', { name: record.name ?? '' }),
          type: 'danger',
          onConfirm: async () => {
            await handleDeleteReview(record.reviewId || 0);
            setConfirmDialog((prev) => ({ ...prev, show: false }));
          },
        }),
      tooltip: t('workflowReview.action.delete'),
      type: 'danger',
    },
  ];

  return (
    <div className="flex flex-col h-full max-h-full bg-slate-50 overflow-hidden relative">
      <div className="h-full max-h-full p-2 sm:p-4 border border-slate-200 shadow-sm overflow-hidden min-w-0 flex-1 min-h-0">
        <EnterpriseTable
          title={t('workflowReview.title')}
          description={t('workflowReview.subtitle')}
          columns={columns}
          data={reviews}
          rowKey={(review, index) => review.reviewId ?? `${review.workflowId}-${index}`}
          actions={rowActions}
          loading={loading}
          toolbarActions={[
            {
              key: 'refresh',
              label: t('workflowReview.action.refresh'),
              icon: <Icons.RefreshCw className="w-4 h-4" />,
              type: 'secondary',
              onClick: fetchReviewList,
            },
          ]}
          search={{
            value: filters.name ?? '',
            onChange: (value) => handleFilterChange('name', value),
            placeholder: t('workflowReview.search.placeholder'),
          }}
          filters={
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 w-full">
              <select
                value={filters.appType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  handleFilterChange('appType', e.target.value)
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
              >
                <option value="">{t('workflowReview.filter.typeAll')}</option>
                <option value="workflow">{t('workflowReview.appType.workflow')}</option>
                <option value="chatbot">{t('workflowReview.appType.chatbot')}</option>
                <option value="agent">{t('workflowReview.appType.agent')}</option>
                <option value="text_generator">{t('workflowReview.appType.textGenerator')}</option>
              </select>
              <select
                value={filters.auditStatus}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  handleFilterChange('auditStatus', e.target.value)
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
              >
                <option value="">{t('workflowReview.filter.statusAll')}</option>
                <option value={AuditStatus.PENDING}>{t('workflowReview.status.pending')}</option>
                <option value={AuditStatus.APPROVED}>{t('workflowReview.status.approved')}</option>
                <option value={AuditStatus.REJECTED}>{t('workflowReview.status.rejected')}</option>
              </select>
              <button
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg text-base font-medium"
                onClick={() => {
                  setFilters({
                    name: '',
                    appType: '',
                    auditStatus: '',
                  });
                  setPagination((prev) => ({
                    ...prev,
                    pageNum: 1,
                  }));
                }}
              >
                {t('workflowReview.action.reset')}
              </button>
            </div>
          }
          pagination={{
            pageNum: pagination.pageNum ?? 1,
            pageSize: pagination.pageSize ?? 10,
            total: pagination.total,
            pageSizes: [5, 10, 20, 50],
            onChange: (page) => setPagination((prev) => ({ ...prev, pageNum: page })),
            onPageSizeChange: (size) =>
              setPagination((prev) => ({ ...prev, pageNum: 1, pageSize: size })),
          }}
          empty={{
            title: t('workflowReview.empty.title'),
            description: t('workflowReview.empty.description'),
            icon: <Icons.Box className="w-12 h-12 text-slate-300" />,
          }}
          height="100%"
          width="100%"
        />
      </div>

      {/* 应用详情弹窗 */}
      {currentReview && (
        <AppDetailModal
          review={currentReview}
          isOpen={showDetailModal}
          onClose={() => {
            setShowDetailModal(false);
            setCurrentReview(null);
          }}
          onApprove={(reviewId, workflowId) => handleAudit(reviewId, workflowId, 'approve')}
          onReject={(reviewId, workflowId, reason) =>
            handleAudit(reviewId, workflowId, 'reject', reason)
          }
        />
      )}

      {/* 确认对话框 */}
      {confirmDialog.show && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          type={confirmDialog.type}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog({ ...confirmDialog, show: false })}
        />
      )}
    </div>
  );
};

export default WorkflowReview;

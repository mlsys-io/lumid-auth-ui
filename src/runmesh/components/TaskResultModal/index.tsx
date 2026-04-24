import React, { useEffect, useMemo } from 'react';
import EnterpriseModal from '@/runmesh/components/EnterpriseTable/Modal';
import { Icons } from '@/runmesh/components/Icons';
import type { ITaskWithResult } from '@/runmesh/types/task';
import { useTaskData } from '@/runmesh/components/TaskResultModal/hooks/useTaskData';
import N8nRunDataPanel from '@/runmesh/components/TaskResultModal/N8nRunDataPanel';
import type { RunDataMap } from '@/runmesh/types/nodeExecution';
import { useLanguage } from '@/runmesh/i18n';

export interface TaskResultModalProps {
  visible: boolean;
  taskId?: string;
  workflowId?: string;
  taskData?: ITaskWithResult;
  onClose: () => void;
}

type RunDataPayload = {
  runDataAll?: RunDataMap;
  currentNode?: string;
};

export const TaskResultModal: React.FC<TaskResultModalProps> = ({
  visible,
  taskId,
  taskData,
  onClose,
}) => {
  const { data, loading, refetch } = useTaskData(taskId, taskData);
  const { t } = useLanguage();

  useEffect(() => {
    if (!visible) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, taskId]);

  const title = useMemo(() => {
    if (!data?.task) return t('taskResult.title.default');
    const name =
      data.task.taskNo || data.task.graphNodeName || data.task.taskName || data.task.taskId;
    return t('taskResult.title.detail', { name });
  }, [data?.task, t]);

  const payload = (data?.result?.result ?? undefined) as unknown as RunDataPayload | undefined;
  const runDataAll = payload?.runDataAll;
  const defaultNode = payload?.currentNode;

  return (
    <EnterpriseModal
      open={visible}
      title={title}
      onClose={onClose}
      footer={null}
      width="90vw"
      height="90vh"
      loading={loading}
    >
      <div className="h-full min-h-0 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {data?.task ? (
              <span className="font-mono text-slate-500">
                {t('taskResult.meta.taskId', { id: data.task.taskId })}
              </span>
            ) : (
              <span>{t('taskResult.meta.loadingHint')}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Icons.RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t('taskResult.action.refresh')}
          </button>
        </div>

        {runDataAll ? (
          <div className="flex-1 min-h-0">
            <N8nRunDataPanel runDataAll={runDataAll} defaultNode={defaultNode} />
          </div>
        ) : loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-600">
            <div className="inline-flex items-center gap-2">
              <Icons.RefreshCw className="w-4 h-4 animate-spin" />
              {t('taskResult.loading')}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-600">
            {t('taskResult.empty')}
          </div>
        )}
      </div>
    </EnterpriseModal>
  );
};

export default TaskResultModal;

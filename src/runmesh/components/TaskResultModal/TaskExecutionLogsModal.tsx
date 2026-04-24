import React, { useCallback, useEffect, useMemo, useState } from 'react';
import EnterpriseModal from '@/runmesh/components/EnterpriseTable/Modal';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';
import { getTaskLogs, getWorkflowLogs } from '@/runmesh/api/user/taskApi';

export interface TaskExecutionLogsModalProps {
  visible: boolean;
  taskId?: string;
  workflowId?: string;
  onClose: () => void;
}

type LogItem = {
  time: string;
  level: string;
  message: string;
};

const normalizeLogItem = (entry: unknown): LogItem => {
  if (typeof entry === 'string') {
    return {
      time: '-',
      level: 'INFO',
      message: entry,
    };
  }

  if (!entry || typeof entry !== 'object') {
    return {
      time: '-',
      level: 'INFO',
      message: JSON.stringify(entry ?? ''),
    };
  }

  const obj = entry as Record<string, unknown>;
  const event = (obj.event ?? {}) as Record<string, unknown>;
  const rawTime = obj.timestamp ?? obj.time ?? obj.ts ?? event.ts;
  const rawLevel = obj.level ?? event.level ?? 'INFO';
  const rawMessage = obj.message ?? obj.msg ?? event.message ?? JSON.stringify(obj);

  return {
    time: String(rawTime ?? '-'),
    level: String(rawLevel ?? 'INFO').toUpperCase(),
    message: String(rawMessage ?? ''),
  };
};

const TaskExecutionLogsModal: React.FC<TaskExecutionLogsModalProps> = ({
  visible,
  taskId,
  workflowId,
  onClose,
}) => {
  const { t } = useLanguage();
  const [taskLogs, setTaskLogs] = useState<LogItem[]>([]);
  const [workflowLogs, setWorkflowLogs] = useState<LogItem[]>([]);
  const [logScope, setLogScope] = useState<'task' | 'workflow'>('task');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!taskId && !workflowId) {
      setTaskLogs([]);
      setWorkflowLogs([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [taskLogResp, workflowLogResp] = await Promise.all([
        taskId ? getTaskLogs(taskId) : Promise.resolve([]),
        workflowId ? getWorkflowLogs(workflowId) : Promise.resolve([]),
      ]);

      const normalizedTaskLogs = (Array.isArray(taskLogResp) ? taskLogResp : []).map(
        normalizeLogItem,
      );
      const normalizedWorkflowLogs = (Array.isArray(workflowLogResp) ? workflowLogResp : []).map(
        normalizeLogItem,
      );

      setTaskLogs(normalizedTaskLogs);
      setWorkflowLogs(normalizedWorkflowLogs);
      setLogScope(
        normalizedTaskLogs.length === 0 && normalizedWorkflowLogs.length > 0 ? 'workflow' : 'task',
      );
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? 'Load logs failed');
    } finally {
      setLoading(false);
    }
  }, [taskId, workflowId]);

  useEffect(() => {
    if (!visible) return;
    void fetchLogs();
  }, [visible, fetchLogs]);

  const title = useMemo(() => t('taskResult.logs.title'), [t]);
  const activeLogs = logScope === 'task' ? taskLogs : workflowLogs;

  return (
    <EnterpriseModal
      open={visible}
      title={title}
      onClose={onClose}
      footer={null}
      width="80vw"
      height="80vh"
      loading={loading}
    >
      <div className="h-full min-h-0 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600 font-mono">
            {taskId ? `task: ${taskId}` : workflowId ? `workflow: ${workflowId}` : '-'}
          </div>
          <button
            type="button"
            onClick={() => {
              void fetchLogs();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Icons.RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t('taskResult.action.refresh')}
          </button>
        </div>

        <div className="bg-white text-slate-800 rounded-xl border border-slate-200 overflow-hidden flex-1 min-h-0">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">{t('taskResult.logs.title')}</div>
            <div className="inline-flex items-center rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setLogScope('task')}
                className={`px-3 py-1.5 text-xs ${
                  logScope === 'task'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('taskResult.logs.task')} ({taskLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setLogScope('workflow')}
                className={`px-3 py-1.5 text-xs ${
                  logScope === 'workflow'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('taskResult.logs.workflow')} ({workflowLogs.length})
              </button>
            </div>
          </div>

          <div className="h-full overflow-auto p-4 text-xs font-mono bg-slate-50">
            {loading ? (
              <div className="text-slate-500">{t('taskResult.logs.loading')}</div>
            ) : error ? (
              <div className="text-rose-600">{error}</div>
            ) : activeLogs.length === 0 ? (
              <div className="text-slate-500">{t('taskResult.logs.empty')}</div>
            ) : (
              activeLogs.map((log, index) => (
                <div key={`${log.time}-${index}`} className="mb-1.5 flex gap-2">
                  <span className="text-slate-500 shrink-0 w-44">{log.time}</span>
                  <span
                    className={`shrink-0 w-16 font-semibold ${
                      log.level === 'ERROR'
                        ? 'text-rose-600'
                        : log.level === 'WARN' || log.level === 'WARNING'
                          ? 'text-amber-600'
                          : 'text-sky-700'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-slate-700 break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </EnterpriseModal>
  );
};

export default TaskExecutionLogsModal;

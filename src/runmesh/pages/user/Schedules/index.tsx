import React, { useEffect, useState, useCallback } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useToast } from '@/runmesh/components/Toast';
import { useLanguage } from '@/runmesh/i18n';
import {
  getScheduleList,
  createSchedule,
  activateSchedule,
  pauseSchedule,
  stopSchedule,
  deleteSchedule,
  getScheduleExecutions,
  WorkflowScheduleVo,
  ScheduleExecutionVo,
  ScheduleStatus,
} from '@/runmesh/api/user/scheduleApi';

const STATUS_COLORS: Record<ScheduleStatus, string> = {
  CREATED: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-green-50 text-green-700',
  PAUSED: 'bg-amber-50 text-amber-700',
  EXPIRED: 'bg-red-50 text-red-600',
  STOPPED: 'bg-slate-100 text-slate-500',
};

const FREQUENCY_PRESETS = [
  { label: 'Every 5 min', value: 300 },
  { label: 'Every 15 min', value: 900 },
  { label: 'Every 30 min', value: 1800 },
  { label: 'Hourly', value: 3600 },
  { label: 'Every 6 hours', value: 21600 },
  { label: 'Daily', value: 86400 },
];

const DURATION_PRESETS = [
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '1 day', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
];

const DAY_LABELS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

function formatInterval(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

export const Schedules: React.FC = () => {
  const { t } = useLanguage();
  const { showToast, toastContainer } = useToast();

  const [schedules, setSchedules] = useState<WorkflowScheduleVo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [formWorkflowId, setFormWorkflowId] = useState('');
  const [formName, setFormName] = useState('');
  const [formInterval, setFormInterval] = useState(3600);
  const [formMaxDuration, setFormMaxDuration] = useState(86400);
  const [formMaxExec, setFormMaxExec] = useState<number | ''>('');
  const [formWindowStart, setFormWindowStart] = useState('');
  const [formWindowEnd, setFormWindowEnd] = useState('');
  const [formDays, setFormDays] = useState<number[]>([]);

  // Execution history
  const [execHistory, setExecHistory] = useState<ScheduleExecutionVo[]>([]);
  const [execScheduleId, setExecScheduleId] = useState<number | null>(null);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getScheduleList({ pageNum: 1, pageSize: 100 });
      const data = res as any;
      setSchedules(data?.rows ?? (Array.isArray(data) ? data : []));
    } catch {
      showToast({ type: 'error', message: t('schedules.toast.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadSchedules();
    // Deliberately empty deps — showToast/t from our ported providers
    // aren't memoized, so depending on loadSchedules (which closes over
    // them) triggered an infinite re-render loop at lum.id mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!formWorkflowId.trim()) {
      showToast({ type: 'error', message: t('schedules.toast.workflowRequired') });
      return;
    }
    try {
      setCreating(true);
      await createSchedule({
        workflowId: formWorkflowId.trim(),
        scheduleName: formName.trim() || undefined,
        intervalSeconds: formInterval,
        maxDurationSeconds: formMaxDuration,
        maxExecutions: formMaxExec ? Number(formMaxExec) : undefined,
        timeWindowStart: formWindowStart || undefined,
        timeWindowEnd: formWindowEnd || undefined,
        activeDays: formDays.length > 0 ? formDays.join(',') : undefined,
      });
      showToast({ type: 'success', message: t('schedules.toast.created') });
      setShowCreate(false);
      resetForm();
      await loadSchedules();
    } catch (error: any) {
      showToast({ type: 'error', message: error.message || t('schedules.toast.createFailed') });
    } finally {
      setCreating(false);
    }
  };

  const toastKeys: Record<string, { success: string; fail: string }> = {
    activate: {
      success: 'schedules.toast.activateSuccess',
      fail: 'schedules.toast.activateFailed',
    },
    pause: { success: 'schedules.toast.pauseSuccess', fail: 'schedules.toast.pauseFailed' },
    stop: { success: 'schedules.toast.stopSuccess', fail: 'schedules.toast.stopFailed' },
    delete: { success: 'schedules.toast.deleteSuccess', fail: 'schedules.toast.deleteFailed' },
  };

  const handleAction = async (action: string, scheduleId: number) => {
    try {
      if (action === 'activate') await activateSchedule(scheduleId);
      else if (action === 'pause') await pauseSchedule(scheduleId);
      else if (action === 'stop') await stopSchedule(scheduleId);
      else if (action === 'delete') await deleteSchedule(scheduleId);
      showToast({ type: 'success', message: t(toastKeys[action].success as any) });
      await loadSchedules();
    } catch (error: any) {
      showToast({ type: 'error', message: error.message || t(toastKeys[action].fail as any) });
    }
  };

  const handleViewExecutions = async (scheduleId: number) => {
    if (execScheduleId === scheduleId) {
      setExecScheduleId(null);
      return;
    }
    try {
      const res = await getScheduleExecutions(scheduleId, { pageNum: 1, pageSize: 20 });
      const data = res as any;
      setExecHistory(data?.rows ?? (Array.isArray(data) ? data : []));
      setExecScheduleId(scheduleId);
    } catch {
      showToast({ type: 'error', message: t('schedules.toast.execLoadFailed') });
    }
  };

  const resetForm = () => {
    setFormWorkflowId('');
    setFormName('');
    setFormInterval(3600);
    setFormMaxDuration(86400);
    setFormMaxExec('');
    setFormWindowStart('');
    setFormWindowEnd('');
    setFormDays([]);
  };

  const toggleDay = (day: number) => {
    setFormDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('schedules.title')}</h1>
          <p className="text-slate-500 mt-1">{t('schedules.subtitle')}</p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            resetForm();
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors flex items-center space-x-2"
        >
          <Icons.Plus className="w-4 h-4" />
          <span>{t('schedules.create')}</span>
        </button>
      </div>

      {/* Schedule List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
        </div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <Icons.Clock className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">{t('schedules.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <div key={s.scheduleId}>
              <div className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <Icons.Clock className="w-5 h-5 text-brand-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {s.scheduleName}
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s.status]}`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {s.workflowName || s.workflowId} &middot; {t('schedules.every')}{' '}
                        {formatInterval(s.intervalSeconds)}
                        {s.maxDurationSeconds &&
                          ` \u00b7 ${t('schedules.maxDuration')}: ${formatDuration(s.maxDurationSeconds)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 flex-shrink-0">
                    <div className="text-right text-xs text-slate-400 hidden sm:block">
                      <div>
                        {t('schedules.runs')}: {s.totalExecutions}
                      </div>
                      {s.nextTriggerAt && (
                        <div>
                          {t('schedules.nextRun')}: {new Date(s.nextTriggerAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      {s.status === 'CREATED' && (
                        <button
                          onClick={() => handleAction('activate', s.scheduleId)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                          title={t('schedules.action.activate')}
                        >
                          <Icons.Play className="w-4 h-4" />
                        </button>
                      )}
                      {s.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleAction('pause', s.scheduleId)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"
                          title={t('schedules.action.pause')}
                        >
                          <Icons.Pause className="w-4 h-4" />
                        </button>
                      )}
                      {s.status === 'PAUSED' && (
                        <button
                          onClick={() => handleAction('activate', s.scheduleId)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                          title={t('schedules.action.resume')}
                        >
                          <Icons.Play className="w-4 h-4" />
                        </button>
                      )}
                      {(s.status === 'ACTIVE' || s.status === 'PAUSED') && (
                        <button
                          onClick={() => handleAction('stop', s.scheduleId)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                          title={t('schedules.action.stop')}
                        >
                          <Icons.Square className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleViewExecutions(s.scheduleId)}
                        className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg"
                        title={t('schedules.action.history')}
                      >
                        <Icons.Activity className="w-4 h-4" />
                      </button>
                      {(s.status === 'CREATED' ||
                        s.status === 'STOPPED' ||
                        s.status === 'EXPIRED') && (
                        <button
                          onClick={() => handleAction('delete', s.scheduleId)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"
                          title={t('schedules.action.delete')}
                        >
                          <Icons.Trash className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution history panel */}
              {execScheduleId === s.scheduleId && (
                <div className="ml-6 mt-1 bg-slate-50 rounded-lg border border-slate-100 p-3">
                  <h4 className="text-xs font-semibold text-slate-500 mb-2">
                    {t('schedules.executionHistory')}
                  </h4>
                  {execHistory.length === 0 ? (
                    <p className="text-xs text-slate-400">{t('schedules.noExecutions')}</p>
                  ) : (
                    <div className="space-y-1">
                      {execHistory.map((exec) => (
                        <div
                          key={exec.id}
                          className="flex items-center justify-between text-xs py-1"
                        >
                          <span className="text-slate-500">
                            {new Date(exec.triggeredAt).toLocaleString()}
                          </span>
                          <span
                            className={
                              exec.status === 'FAILED'
                                ? 'text-red-500'
                                : exec.status === 'RUNNING'
                                  ? 'text-blue-500'
                                  : 'text-green-600'
                            }
                          >
                            {exec.status}
                          </span>
                          {exec.errorMessage && (
                            <span
                              className="text-red-400 truncate max-w-[200px]"
                              title={exec.errorMessage}
                            >
                              {exec.errorMessage}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Schedule Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">{t('schedules.createTitle')}</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Workflow ID */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.workflowId')}
                </label>
                <input
                  type="text"
                  value={formWorkflowId}
                  onChange={(e) => setFormWorkflowId(e.target.value)}
                  placeholder={t('schedules.form.workflowIdPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              {/* Schedule Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.name')}
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('schedules.form.namePlaceholder')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              {/* Frequency */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.frequency')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {FREQUENCY_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setFormInterval(p.value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        formInterval === p.value
                          ? 'bg-brand-50 border-brand-300 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Duration */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.maxDuration')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setFormMaxDuration(p.value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        formMaxDuration === p.value
                          ? 'bg-brand-50 border-brand-300 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Executions (optional) */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.maxExecutions')}
                </label>
                <input
                  type="number"
                  min={1}
                  value={formMaxExec}
                  onChange={(e) => setFormMaxExec(e.target.value ? Number(e.target.value) : '')}
                  placeholder={t('schedules.form.maxExecutionsPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              {/* Time Window */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.timeWindow')}
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="time"
                    value={formWindowStart}
                    onChange={(e) => setFormWindowStart(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                  <span className="text-slate-400">—</span>
                  <input
                    type="time"
                    value={formWindowEnd}
                    onChange={(e) => setFormWindowEnd(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* Active Days */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  {t('schedules.form.activeDays')}
                </label>
                <div className="flex gap-1">
                  {DAY_LABELS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => toggleDay(d.value)}
                      className={`w-10 h-8 text-xs rounded-lg border transition-colors ${
                        formDays.includes(d.value)
                          ? 'bg-brand-50 border-brand-300 text-brand-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end space-x-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                {t('dialog.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !formWorkflowId.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                {creating ? t('schedules.creating') : t('schedules.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastContainer()}
    </div>
  );
};

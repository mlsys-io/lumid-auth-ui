import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import TaskResultModal from '@/runmesh/components/TaskResultModal';
import TaskExecutionLogsModal from '@/runmesh/components/TaskResultModal/TaskExecutionLogsModal';
import { getWorkflowSummaryList, getWorkflowTaskList } from '@/runmesh/api/user/taskApi';
import { NebulaTaskVo, NebulaWorkflowSummary } from '@/runmesh/types';
import type { ITaskWithResult } from '@/runmesh/types/task';
import { allowRefresh } from '@/runmesh/utils/apiRateLimiter';
import { useLanguage } from '@/runmesh/i18n';
import type { TranslationKey } from '@/runmesh/i18n/types';

type TaskStatus = 'running' | 'completed' | 'failed' | 'queued';

// 将后端状态映射到前端状态
const mapBackendStatusToFrontend = (backendStatus: string): TaskStatus => {
  switch (backendStatus?.toUpperCase()) {
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'PENDING':
    case 'QUEUED':
      return 'queued';
    default:
      return 'completed';
  }
};

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

const getMockLogs = (t: TranslateFn) => [
  { time: '10:00:01', level: 'INFO', msg: t('taskList.mock.log.init') },
  { time: '10:00:05', level: 'INFO', msg: t('taskList.mock.log.resource') },
  { time: '10:00:10', level: 'INFO', msg: t('taskList.mock.log.loadWeights') },
  { time: '10:00:45', level: 'INFO', msg: t('taskList.mock.log.batchProcessing') },
  { time: '10:01:20', level: 'WARN', msg: t('taskList.mock.log.highMemory', { percent: 92 }) },
  { time: '10:02:00', level: 'ERROR', msg: t('taskList.mock.log.timeout') },
  { time: '10:02:05', level: 'INFO', msg: t('taskList.mock.log.retry') },
];

const getMockPlan = (t: TranslateFn) => [
  {
    name: t('taskList.mock.plan.init.name'),
    status: 'completed',
    time: '10:00:01',
    duration: '200ms',
    node: 'System',
    description: t('taskList.mock.plan.init.desc'),
  },
  {
    name: t('taskList.mock.plan.schedule.name'),
    status: 'completed',
    time: '10:00:02',
    duration: '3s',
    node: 'Scheduler',
    description: t('taskList.mock.plan.schedule.desc'),
  },
  {
    name: t('taskList.mock.plan.pullImage.name'),
    status: 'completed',
    time: '10:00:05',
    duration: '45s',
    node: 'Worker-01',
    description: t('taskList.mock.plan.pullImage.desc', { image: 'python-3.10-cuda-11.7' }),
  },
  {
    name: t('taskList.mock.plan.loadModel.name'),
    status: 'completed',
    time: '10:00:50',
    duration: '12s',
    node: 'GPU-01',
    description: t('taskList.mock.plan.loadModel.desc', { file: 'model.safetensors' }),
  },
  {
    name: t('taskList.mock.plan.preprocess.name'),
    status: 'completed',
    time: '10:01:02',
    duration: '5s',
    node: 'CPU-Worker',
    description: t('taskList.mock.plan.preprocess.desc'),
  },
  {
    name: t('taskList.mock.plan.inference.name'),
    status: 'running',
    time: '10:01:07',
    duration: t('taskList.mock.plan.inference.duration'),
    node: 'GPU-01',
    description: t('taskList.mock.plan.inference.desc'),
  },
  {
    name: t('taskList.mock.plan.upload.name'),
    status: 'pending',
    time: '-',
    duration: '-',
    node: 'Storage',
    description: t('taskList.mock.plan.upload.desc'),
  },
];

const mockChartData = [
  { name: 'Step 10', loss: 2.4 },
  { name: 'Step 20', loss: 1.8 },
  { name: 'Step 30', loss: 1.5 },
  { name: 'Step 40', loss: 1.2 },
  { name: 'Step 50', loss: 0.9 },
  { name: 'Step 60', loss: 0.7 },
  { name: 'Step 70', loss: 0.65 },
];

const formatDuration = (durationSeconds: number | null | undefined, t: TranslateFn) => {
  if (durationSeconds === undefined || durationSeconds === null) {
    return t('taskList.common.na');
  }
  // 只到秒：小于 60 秒显示“X秒”，达到分钟级别显示“X分Y秒”，均为整数
  let totalSeconds = Math.round(durationSeconds);
  if (totalSeconds < 0) totalSeconds = 0;

  // 不到 1 分钟，直接显示秒
  if (totalSeconds < 60) {
    return t('taskList.duration.seconds', { seconds: totalSeconds });
  }

  let minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds % 60;
  // 兜底：四舍五入可能导致 60 秒进位
  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }

  return t('taskList.duration.minutes', { minutes, seconds });
};

const inferTaskType = (task: NebulaTaskVo): 'sft' | 'inference' | 'unknown' => {
  const hint = String(task.taskNo ?? task.taskName ?? '').toLowerCase();
  if (hint.includes('sft')) return 'sft';
  if (hint.includes('infer')) return 'inference';
  return 'unknown';
};

const buildInitialTaskData = (task: NebulaTaskVo): ITaskWithResult => {
  const statusUpper = String(task.status ?? 'UNKNOWN').toUpperCase();
  const completed = statusUpper === 'COMPLETED' || statusUpper === 'DONE';
  const failed = statusUpper === 'FAILED';
  return {
    task: {
      taskId: String(task.taskId),
      taskNo: task.taskNo ?? '',
      taskName: task.taskName ?? '',
      taskType: inferTaskType(task),
      status: statusUpper,
      submitTime: task.submitTime,
      startTime: task.startTime,
      endTime: task.endTime,
      durationSeconds: task.durationSeconds ?? undefined,
      totalRuntimeSec: task.totalRuntimeSec ?? task.durationSeconds ?? undefined,
      externalTaskId: task.externalTaskId ?? '',
      graphNodeName: task.graphNodeName ?? task.taskNo ?? task.taskName ?? '',
      parsed: undefined,
      error: null,
      completed,
      failed,
      appName: task.appName,
      assignedWorker: undefined,
      costAmount: task.costAmount ?? undefined,
      totalCost:
        task.totalCost ?? (typeof task.costAmount === 'number' ? task.costAmount : undefined),
      costCurrency: task.costCurrency,
    },
    result: undefined,
  };
};

const formatAmount = (
  amount: number | string | null | undefined,
  currency: string | undefined,
  t: TranslateFn,
  fallback?: string,
) => {
  if (amount === undefined || amount === null || amount === '') {
    return fallback ?? t('taskList.amount.unbilled');
  }
  // 统一格式化为四位小数
  let numValue: number;
  if (typeof amount === 'string') {
    numValue = parseFloat(amount);
    if (Number.isNaN(numValue)) {
      return t('taskList.amount.invalid');
    }
  } else {
    numValue = amount;
  }
  const formatted = numValue.toFixed(4);
  const cur = currency || 'USD';
  return cur === 'USD' ? `$${formatted}` : `${formatted} ${cur}`;
};

const formatDateTime = (value: string | undefined, t: TranslateFn) =>
  value || t('taskList.common.na');

const StatusBadge = ({ status }: { status: TaskStatus }) => {
  const { t } = useLanguage();
  const styles = {
    running: 'bg-blue-50 text-blue-700 border-blue-200',
    completed: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    queued: 'bg-slate-50 text-slate-600 border-slate-200',
  };

  const icons = {
    running: <Icons.Activity className="w-3 h-3 mr-1 animate-spin" />,
    completed: <Icons.Check className="w-3 h-3 mr-1" />,
    failed: <Icons.XOctagon className="w-3 h-3 mr-1" />,
    queued: <Icons.Clock className="w-3 h-3 mr-1" />,
  };

  const statusLabels = {
    running: t('taskList.status.running'),
    completed: t('taskList.status.completed'),
    failed: t('taskList.status.failed'),
    queued: t('taskList.status.queued'),
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}
    >
      {icons[status]}
      {statusLabels[status]}
    </span>
  );
};

const getWorkflowTaskColumns = (t: TranslateFn): TableColumn<NebulaTaskVo>[] => [
  {
    key: 'taskName',
    title: t('taskList.table.task.title'),
    render: (task) => (
      <div className="flex flex-col">
        <span className="text-sm font-medium text-slate-900">
          {task.graphNodeName || t('taskList.task.unnamed')}
        </span>
        <span className="text-xs text-slate-400 font-mono mt-0.5">{String(task.taskId)}</span>
      </div>
    ),
  },
  {
    key: 'status',
    title: t('taskList.table.task.status'),
    render: (task) => (
      <StatusBadge status={mapBackendStatusToFrontend(task.status || 'COMPLETED')} />
    ),
  },
  {
    key: 'startTime',
    title: t('taskList.table.task.startTime'),
    render: (task) => (
      <span className="text-sm text-slate-500">{formatDateTime(task.startTime, t)}</span>
    ),
  },
  {
    key: 'endTime',
    title: t('taskList.table.task.endTime'),
    render: (task) => (
      <span className="text-sm text-slate-500">{formatDateTime(task.endTime, t)}</span>
    ),
  },
  {
    key: 'duration',
    title: t('taskList.table.task.duration'),
    render: (task) => (
      <span className="text-sm text-slate-500 font-mono">
        {formatDuration(task.totalRuntimeSec ?? task.durationSeconds, t)}
      </span>
    ),
  },
  {
    key: 'cost',
    title: t('taskList.table.task.cost'),
    render: (task) => (
      <span className="text-sm text-slate-600 font-medium">
        {formatAmount(
          task.totalCost ??
            (typeof task.costAmount === 'number' ? task.costAmount : task.costAmount),
          task.costCurrency,
          t,
        )}
      </span>
    ),
  },
];

interface TaskDetailModalProps {
  task: NebulaTaskVo;
  workflowTasks: NebulaTaskVo[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

// 旧版详情弹窗（展示 workflow 级别信息），当前页面已切换到新的“单任务结果弹窗”。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  workflowTasks,
  loading,
  error,
  onClose,
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'result' | 'logs' | 'plan'>('result');
  const [logFilter, setLogFilter] = useState('');
  const status = mapBackendStatusToFrontend(task.status || 'COMPLETED');
  const mockLogs = getMockLogs(t);
  const mockPlan = getMockPlan(t);

  const filteredLogs = mockLogs.filter(
    (log) =>
      log.msg.toLowerCase().includes(logFilter.toLowerCase()) ||
      log.level.toLowerCase().includes(logFilter.toLowerCase()),
  );
  const taskDisplayName = task.taskName || task.taskNo || t('taskList.task.unnamed');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center">
              {t('taskList.detail.title', { name: taskDisplayName })}
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{String(task.taskId)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0">
          <button
            onClick={() => setActiveTab('result')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'result'
                ? 'border-brand-600 text-brand-600 bg-brand-50/30'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('taskList.detail.tab.result')}
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'logs'
                ? 'border-brand-600 text-brand-600 bg-brand-50/30'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('taskList.detail.tab.logs')}
          </button>
          <button
            onClick={() => setActiveTab('plan')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'plan'
                ? 'border-brand-600 text-brand-600 bg-brand-50/30'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('taskList.detail.tab.plan')}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'result' && (
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-500">{t('taskList.detail.status')}</p>
                  <div className="mt-2">
                    <StatusBadge status={status} />
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-500">{t('taskList.detail.cost')}</p>
                  <p className="text-sm font-semibold text-slate-800 mt-2">
                    {formatAmount(task.costAmount, task.costCurrency, t)}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-500">{t('taskList.detail.startTime')}</p>
                  <p className="text-sm font-semibold text-slate-800 mt-2">
                    {formatDateTime(task.startTime, t)}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-500">{t('taskList.detail.endTime')}</p>
                  <p className="text-sm font-semibold text-slate-800 mt-2">
                    {formatDateTime(task.endTime, t)}
                  </p>
                </div>
              </div>

              {/* File Outputs */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center">
                  <Icons.FileText className="w-4 h-4 mr-2 text-slate-500" />
                  {t('taskList.detail.files.title')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-slate-200 rounded-lg flex items-center justify-between hover:border-brand-300 transition-colors group">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded">
                        <Icons.File className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">model_weights.bin</p>
                        <p className="text-xs text-slate-500">
                          {t('taskList.detail.files.generated', { size: '1.2 GB', minutes: 10 })}
                        </p>
                      </div>
                    </div>
                    <button className="p-2 text-slate-400 hover:text-brand-600 group-hover:bg-slate-50 rounded-full">
                      <Icons.DownloadCloud className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-4 border border-slate-200 rounded-lg flex items-center justify-between hover:border-brand-300 transition-colors group">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-green-50 text-green-600 rounded">
                        <Icons.Image className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">preview_sample.png</p>
                        <p className="text-xs text-slate-500">
                          {t('taskList.detail.files.generated', { size: '2.4 MB', minutes: 12 })}
                        </p>
                      </div>
                    </div>
                    <button className="p-2 text-slate-400 hover:text-brand-600 group-hover:bg-slate-50 rounded-full">
                      <Icons.DownloadCloud className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Data Visualization */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-800 flex items-center">
                  <Icons.BarChart className="w-4 h-4 mr-2 text-slate-500" />
                  {t('taskList.detail.metrics')}
                </h3>
                <div className="h-64 w-full bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mockChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#64748b' }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#64748b' }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="loss"
                        stroke="#0ea5e9"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 2, stroke: '#fff' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <EnterpriseTable
                title={t('taskList.detail.workflowTable.title')}
                description={t('taskList.detail.workflowTable.description')}
                columns={getWorkflowTaskColumns(t)}
                data={workflowTasks}
                rowKey={(record) => String(record.taskId)}
                loading={loading}
                empty={{
                  title: error ? t('taskList.error.loadFailed') : t('taskList.empty.noTasks'),
                  description: error ?? t('taskList.empty.noTasksDesc'),
                  icon: error ? (
                    <Icons.AlertCircle className="w-12 h-12 text-red-300" />
                  ) : (
                    <Icons.Box className="w-12 h-12 text-slate-300" />
                  ),
                }}
                stickyHeader={false}
                height="auto"
                width="100%"
              />
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="flex-1 flex flex-col">
              <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex space-x-2">
                <div className="relative flex-1">
                  <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t('taskList.detail.logs.placeholder')}
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-50">
                  {t('taskList.detail.logs.download')}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 bg-slate-900 font-mono text-xs text-slate-300">
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`mb-1.5 flex ${log.level === 'ERROR' ? 'bg-red-900/20 -mx-4 px-4 py-0.5' : ''}`}
                    >
                      <span className="text-slate-500 w-20 shrink-0 select-none">[{log.time}]</span>
                      <span
                        className={`w-16 shrink-0 font-bold ${
                          log.level === 'INFO'
                            ? 'text-blue-400'
                            : log.level === 'WARN'
                              ? 'text-yellow-400'
                              : 'text-red-500'
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className={log.level === 'ERROR' ? 'text-red-200' : ''}>{log.msg}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 text-center mt-10">
                    {t('taskList.detail.logs.empty')}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'plan' && (
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
              <div className="max-w-2xl mx-auto">
                <div className="border-l-2 border-slate-200 ml-3 space-y-0 py-2">
                  {mockPlan.map((step, idx) => (
                    <div key={idx} className="relative pl-8 pb-10 last:pb-0">
                      <div
                        className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center z-10 ${
                          step.status === 'completed'
                            ? 'border-green-500'
                            : step.status === 'running'
                              ? 'border-brand-500'
                              : 'border-slate-300'
                        }`}
                      >
                        {step.status === 'completed' && (
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        )}
                        {step.status === 'running' && (
                          <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse"></div>
                        )}
                        {step.status === 'pending' && (
                          <div className="w-1.5 h-1.5 bg-slate-300 rounded-full"></div>
                        )}
                      </div>

                      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4
                              className={`text-sm font-bold ${step.status === 'pending' ? 'text-slate-400' : 'text-slate-800'}`}
                            >
                              {step.name}
                            </h4>
                            {step.node && (
                              <p className="text-xs text-slate-500 mt-1 flex items-center">
                                <Icons.Server className="w-3 h-3 mr-1" />
                                {step.node}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="block text-xs font-mono text-slate-400">
                              {step.time}
                            </span>
                            <span
                              className={`text-xs font-medium ${step.status === 'running' ? 'text-brand-600' : 'text-slate-500'}`}
                            >
                              {step.duration}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 border-t border-slate-100 pt-2 mt-2">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const TaskList: React.FC = () => {
  const location = useLocation();
  const { t } = useLanguage();
  const [workflows, setWorkflows] = useState<NebulaWorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<string[]>([]);
  const [workflowTasksById, setWorkflowTasksById] = useState<Record<string, NebulaTaskVo[]>>({});
  const [workflowTasksLoading, setWorkflowTasksLoading] = useState<Record<string, boolean>>({});
  const [workflowTasksError, setWorkflowTasksError] = useState<Record<string, string>>({});
  const [taskResultVisible, setTaskResultVisible] = useState(false);
  const [taskResultTaskId, setTaskResultTaskId] = useState<string>('');
  const [taskResultInitialData, setTaskResultInitialData] = useState<ITaskWithResult | undefined>();
  const [taskLogsVisible, setTaskLogsVisible] = useState(false);
  const [taskLogsTaskId, setTaskLogsTaskId] = useState<string>('');
  const [taskLogsWorkflowId, setTaskLogsWorkflowId] = useState<string>('');
  const [workflowIdFilter, setWorkflowIdFilter] = useState(
    () => new URLSearchParams(location.search).get('workflowId') ?? '',
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  // 二级列表分页状态（每个工作流独立的分页）
  const [taskPageByWorkflowId, setTaskPageByWorkflowId] = useState<Record<string, number>>({});
  const [taskPageSizeByWorkflowId, setTaskPageSizeByWorkflowId] = useState<Record<string, number>>(
    {},
  );

  // 从后端API获取工作流列表
  const fetchWorkflowSummaries = async (
    overrides?: Partial<{ pageNum: number; pageSize: number; workflowId: string }>,
  ) => {
    try {
      setLoading(true);
      setError(null);

      const queryWorkflowId = overrides?.workflowId ?? workflowIdFilter;
      const pageNum = overrides?.pageNum ?? currentPage;
      const size = overrides?.pageSize ?? pageSize;

      // 使用 /runmesh/task/list 接口，传入 workflowId 参数查询
      const result = await getWorkflowSummaryList(queryWorkflowId, {
        pageNum,
        pageSize: size,
      });

      setWorkflows(result.rows ?? []);
      setTotalItems(result.total ?? 0);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('获取工作流列表失败:', error);
      setError(err?.message || t('taskList.error.workflowListFailed'));
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  };

  // 初次加载和依赖项变化时获取数据
  useEffect(() => {
    fetchWorkflowSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowIdFilter, currentPage, pageSize]);

  useEffect(() => {
    setExpandedWorkflowIds([]);
    setWorkflowTasksById({});
    setWorkflowTasksLoading({});
    setWorkflowTasksError({});
  }, [workflowIdFilter]);

  // 监听URL参数变化，当URL包含时间戳参数时重新加载数据
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const workflowIdFromUrl = searchParams.get('workflowId');
    if (workflowIdFromUrl && workflowIdFromUrl !== workflowIdFilter) {
      setWorkflowIdFilter(workflowIdFromUrl);
      setCurrentPage(1);
    }
    if (searchParams.get('t')) fetchWorkflowSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // 刷新任务列表的函数
  const refreshTaskList = async () => {
    // 允许绕过API频率限制
    allowRefresh('/task/list');

    setCurrentPage(1); // 重置到第一页
    await fetchWorkflowSummaries(); // 直接调用获取数据函数

    // 同步刷新已展开的二级任务列表
    const expandedIds = [...expandedWorkflowIds];
    if (expandedIds.length === 0) return;

    setWorkflowTasksLoading((prev) => {
      const next = { ...prev };
      expandedIds.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
    setWorkflowTasksError((prev) => {
      const next = { ...prev };
      expandedIds.forEach((id) => {
        next[id] = '';
      });
      return next;
    });

    const results = await Promise.all(
      expandedIds.map(async (workflowId) => {
        try {
          const result = await getWorkflowTaskList(workflowId);
          return { workflowId, result };
        } catch (workflowError: unknown) {
          const err = workflowError as { message?: string };
          console.error('刷新工作流任务列表失败:', workflowError);
          setWorkflowTasksError((prev) => ({
            ...prev,
            [workflowId]: err?.message || t('taskList.error.workflowTasksFailed'),
          }));
          return { workflowId, result: [] as NebulaTaskVo[] };
        }
      }),
    );

    setWorkflowTasksById((prev) => {
      const next = { ...prev };
      results.forEach(({ workflowId, result }) => {
        next[workflowId] = result ?? [];
      });
      return next;
    });
    setWorkflowTasksLoading((prev) => {
      const next = { ...prev };
      expandedIds.forEach((id) => {
        next[id] = false;
      });
      return next;
    });
  };

  const openTaskDetail = async (task: NebulaTaskVo) => {
    setTaskResultTaskId(String(task.taskId));
    setTaskResultInitialData(buildInitialTaskData(task));
    setTaskResultVisible(true);
  };

  const openTaskExecutionLogs = async (task: NebulaTaskVo) => {
    setTaskLogsTaskId(String(task.taskId));
    setTaskLogsWorkflowId(String(task.workflowId ?? ''));
    setTaskLogsVisible(true);
  };

  const toggleWorkflowExpand = async (workflow: NebulaWorkflowSummary) => {
    const workflowId = workflow.workflowId;
    const isExpanded = expandedWorkflowIds.includes(workflowId);

    if (isExpanded) {
      setExpandedWorkflowIds((prev) => prev.filter((id) => id !== workflowId));
      return;
    }

    setExpandedWorkflowIds((prev) => [...prev, workflowId]);

    // 如果新接口已经返回了二级列表数据（workflow.tasks），直接使用，不需要再调用接口
    if (workflow.tasks && workflow.tasks.length > 0) {
      // 新接口已经返回了二级列表数据，直接使用
      return;
    }

    // 只有当新接口没有返回二级列表数据时，才调用旧接口作为备用方案
    setWorkflowTasksLoading((prev) => ({ ...prev, [workflowId]: true }));
    setWorkflowTasksError((prev) => ({ ...prev, [workflowId]: '' }));

    try {
      const result = await getWorkflowTaskList(workflowId);
      setWorkflowTasksById((prev) => ({ ...prev, [workflowId]: result ?? [] }));
    } catch (workflowError: unknown) {
      const err = workflowError as { message?: string };
      console.error('获取工作流任务列表失败:', workflowError);
      setWorkflowTasksError((prev) => ({
        ...prev,
        [workflowId]: err?.message || t('taskList.error.workflowTasksFailed'),
      }));
      setWorkflowTasksById((prev) => ({ ...prev, [workflowId]: [] }));
    } finally {
      setWorkflowTasksLoading((prev) => ({ ...prev, [workflowId]: false }));
    }
  };

  const columns: TableColumn<NebulaWorkflowSummary>[] = [
    {
      key: 'name',
      title: t('taskList.table.workflow.title'),
      render: (workflow) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-slate-900">
            {workflow.name || t('taskList.workflow.unnamed')}
          </span>
          <span className="text-xs text-slate-400 font-mono mt-0.5">{workflow.workflowId}</span>
        </div>
      ),
    },
    {
      key: 'lastTaskExecuteTime',
      title: t('taskList.table.workflow.lastRun'),
      render: (workflow) => (
        <span className="text-sm text-slate-500">
          {formatDateTime(workflow.lastTaskExecuteTime, t)}
        </span>
      ),
    },
    {
      key: 'totalCostAmount',
      title: t('taskList.table.workflow.totalCost'),
      render: (workflow) => (
        <span className="text-sm text-slate-600 font-medium">
          {formatAmount(workflow.totalCostAmount, workflow.costCurrency, t)}
        </span>
      ),
    },
    {
      key: 'taskCount',
      title: t('taskList.table.workflow.taskCount'),
      render: (workflow) => (
        <span className="text-sm text-slate-600 font-mono">
          {workflow.taskCount ?? t('taskList.common.na')}
        </span>
      ),
    },
  ];

  const rowActions: TableAction<NebulaWorkflowSummary>[] = [
    {
      key: 'expand',
      label: t('taskList.action.expand'),
      icon: <Icons.ChevronDown className="w-4 h-4" />,
      onClick: (record) => toggleWorkflowExpand(record),
      tooltip: (record) =>
        expandedWorkflowIds.includes(record.workflowId)
          ? t('taskList.action.collapseTasks')
          : t('taskList.action.expandTasks'),
      type: 'secondary',
    },
  ];

  const workflowTaskActions: TableAction<NebulaTaskVo>[] = [
    {
      key: 'executionLogs',
      label: t('taskList.action.viewExecutionLogs'),
      icon: <Icons.List className="w-4 h-4" />,
      onClick: (record) => openTaskExecutionLogs(record),
      tooltip: t('taskList.action.viewExecutionLogs'),
      type: 'secondary',
    },
    {
      key: 'detail',
      label: t('taskList.action.viewDetails'),
      icon: <Icons.FileText className="w-4 h-4" />,
      onClick: (record) => openTaskDetail(record),
      tooltip: t('taskList.action.viewDetails'),
      type: 'secondary',
    },
  ];

  const renderWorkflowTasks = (workflow: NebulaWorkflowSummary) => {
    const workflowId = workflow.workflowId;

    // 优先使用 workflow.tasks（从新接口返回的，带分页信息）
    // 如果没有，则使用 workflowTasksById（从旧接口获取的）
    const tasksFromWorkflow = workflow.tasks ?? [];
    const tasksFromApi = workflowTasksById[workflowId] ?? [];
    const hasFetchedTasks = Object.prototype.hasOwnProperty.call(workflowTasksById, workflowId);
    const hasTasksFromWorkflow = tasksFromWorkflow.length > 0;

    const loadingTasks = workflowTasksLoading[workflowId] ?? false;
    const errorMessage = workflowTasksError[workflowId];

    // 分页信息：优先使用 workflow 中的分页信息，否则使用本地状态
    const taskPageNum = workflow.taskPageNum ?? taskPageByWorkflowId[workflowId] ?? 1;
    const taskPageSize = workflow.taskPageSize ?? taskPageSizeByWorkflowId[workflowId] ?? 10;

    // 计算总数和显示的任务列表
    // 优先级：新接口返回的数据 > 旧接口获取的数据
    let displayTasks: NebulaTaskVo[] = [];
    let displayTotal = 0;

    if (hasTasksFromWorkflow) {
      // 优先使用新接口返回的数据：后端返回所有任务，前端进行分页
      const allTasks = tasksFromWorkflow;
      displayTotal = workflow.taskTotal ?? workflow.taskCount ?? allTasks.length;
      // 前端分页
      const start = (taskPageNum - 1) * taskPageSize;
      const end = start + taskPageSize;
      displayTasks = allTasks.slice(start, end);
    } else if (hasFetchedTasks) {
      // 如果没有新接口数据，使用旧接口获取的数据
      displayTotal = tasksFromApi.length;
      const start = (taskPageNum - 1) * taskPageSize;
      const end = start + taskPageSize;
      displayTasks = tasksFromApi.slice(start, end);
    }

    // 分页切换处理
    const handleTaskPageChange = (page: number) => {
      setTaskPageByWorkflowId((prev) => ({ ...prev, [workflowId]: page }));
    };

    const handleTaskPageSizeChange = (size: number) => {
      setTaskPageSizeByWorkflowId((prev) => ({ ...prev, [workflowId]: size }));
      setTaskPageByWorkflowId((prev) => ({ ...prev, [workflowId]: 1 }));
    };

    // 始终显示分页（即使总数 <= 每页大小，也显示分页信息）
    return (
      <EnterpriseTable
        columns={getWorkflowTaskColumns(t)}
        data={displayTasks}
        rowKey={(record) => String(record.taskId)}
        actions={workflowTaskActions}
        loading={loadingTasks}
        pagination={
          displayTotal > 0
            ? {
                pageNum: taskPageNum,
                pageSize: taskPageSize,
                total: displayTotal,
                pageSizes: [5, 10, 20, 50],
                onChange: handleTaskPageChange,
                onPageSizeChange: handleTaskPageSizeChange,
              }
            : undefined
        }
        empty={{
          title: errorMessage ? t('taskList.error.loadFailed') : t('taskList.empty.noTasks'),
          description: errorMessage ?? t('taskList.empty.noWorkflowTasks'),
          icon: errorMessage ? (
            <Icons.AlertCircle className="w-12 h-12 text-red-300" />
          ) : (
            <Icons.Box className="w-12 h-12 text-slate-300" />
          ),
        }}
        stickyHeader={false}
        height="auto"
        width="100%"
      />
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-auto">
      {/* <header className="px-8 py-6 bg-white border-b border-slate-100 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">任务管理</h1>
          <p className="text-sm text-slate-500 mt-1">监控任务状态、查看执行结果及调试日志。</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={refreshTaskList}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            刷新列表
          </button>
        </div>
      </header> */}

      <div className="p-4 h-full mx-auto w-full">
        {/* {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-center text-red-700">
              <Icons.AlertCircle className="w-4 h-4 mr-2" />
              <span>错误: {error}</span>
              <button
                onClick={() => fetchTasks()}
                className="ml-auto px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
              >
                重试
              </button>
            </div>
          </div>
        )} */}

        <EnterpriseTable
          title={t('taskList.title')}
          description={t('taskList.subtitle')}
          columns={columns}
          data={workflows}
          rowKey={(workflow) => workflow.workflowId}
          actions={rowActions}
          loading={loading}
          expandedRowKeys={expandedWorkflowIds}
          expandedRowRender={renderWorkflowTasks}
          toolbarActions={[
            {
              key: 'refresh',
              label: t('taskList.action.refresh'),
              icon: <Icons.RefreshCw className="w-4 h-4" />,
              type: 'secondary',
              onClick: refreshTaskList,
            },
          ]}
          search={{
            value: workflowIdFilter,
            onChange: (value) => {
              setWorkflowIdFilter(value);
              setCurrentPage(1);
            },
            placeholder: t('taskList.search.placeholder'),
          }}
          pagination={{
            pageNum: currentPage,
            pageSize,
            total: totalItems,
            pageSizes: [5, 10, 20, 50],
            onChange: (page) => setCurrentPage(page),
            onPageSizeChange: (size) => {
              setPageSize(size);
              setCurrentPage(1);
            },
          }}
          empty={{
            title: error ? t('taskList.error.loadFailed') : t('taskList.empty.noTasks'),
            description: error ? error : t('taskList.empty.noWorkflows'),
            icon: error ? (
              <Icons.AlertCircle className="w-12 h-12 text-red-300" />
            ) : (
              <Icons.Box className="w-12 h-12 text-slate-300" />
            ),
          }}
          height="100%"
          width="100%"
        />
      </div>

      <TaskResultModal
        visible={taskResultVisible}
        taskId={taskResultTaskId}
        taskData={taskResultInitialData}
        onClose={() => {
          setTaskResultVisible(false);
          setTaskResultTaskId('');
          setTaskResultInitialData(undefined);
        }}
      />

      <TaskExecutionLogsModal
        visible={taskLogsVisible}
        taskId={taskLogsTaskId}
        workflowId={taskLogsWorkflowId}
        onClose={() => {
          setTaskLogsVisible(false);
          setTaskLogsTaskId('');
          setTaskLogsWorkflowId('');
        }}
      />
    </div>
  );
};

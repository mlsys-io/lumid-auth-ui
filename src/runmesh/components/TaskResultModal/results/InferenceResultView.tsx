import React, { useMemo, useState } from 'react';
import type { IInferenceResult, ITaskConfig, ITaskDetail } from '@/runmesh/types/task';
import { Icons } from '@/runmesh/components/Icons';
import JsonPanel from '@/runmesh/components/TaskResultModal/ui/JsonPanel';
import { useLanguage } from '@/runmesh/i18n';

function downloadJson(filename: string, value: any) {
  const dataStr = JSON.stringify(value ?? null, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface InferenceResultViewProps {
  task: ITaskDetail;
  result: IInferenceResult;
  config: ITaskConfig | null;
}

export const InferenceResultView: React.FC<InferenceResultViewProps> = ({
  task,
  result,
  config,
}) => {
  const { t } = useLanguage();
  const [showAll, setShowAll] = useState(false);
  const spec = config?.spec;
  const runData = (result as any)?.runData;

  const total = result.total_count ?? result.responses?.length ?? 0;
  const success = result.success_count ?? result.responses?.length ?? 0;
  const failed = Math.max(0, total - success);
  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : 'N/A';

  const responses = result.responses ?? [];
  const rows = useMemo(() => (showAll ? responses : responses.slice(0, 10)), [responses, showAll]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">
          {t('taskResult.inference.stats.title')}
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{t('taskResult.inference.stats.total')}</div>
            <div className="text-lg font-semibold text-slate-900">{total}</div>
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{t('taskResult.inference.stats.success')}</div>
            <div className="text-lg font-semibold text-green-700">{success}</div>
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{t('taskResult.inference.stats.failed')}</div>
            <div className="text-lg font-semibold text-red-700">{failed}</div>
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">
              {t('taskResult.inference.stats.successRate')}
            </div>
            <div className="text-lg font-semibold text-brand-700">
              {successRate === 'N/A' ? 'N/A' : `${successRate}%`}
            </div>
          </div>
        </div>
      </div>

      {responses.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">
              {t('taskResult.inference.results.title')}
            </div>
            <button
              type="button"
              onClick={() => downloadJson(`inference-results-${task.taskId}.json`, responses)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Icons.Download className="w-4 h-4" />
              {t('taskResult.inference.results.export')}
            </button>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 w-16">
                    {t('taskResult.inference.results.index')}
                  </th>
                  <th className="text-left px-4 py-2 w-[40%]">
                    {t('taskResult.inference.results.question')}
                  </th>
                  <th className="text-left px-4 py-2">
                    {t('taskResult.inference.results.answer')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-slate-800">
                      <div className="whitespace-pre-wrap break-words max-h-24 overflow-auto">
                        {r.question}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <div className="whitespace-pre-wrap break-words max-h-24 overflow-auto">
                        {r.answer}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {responses.length > 10 && (
            <div className="p-3 text-center">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? t('common.collapse')
                  : t('taskResult.inference.results.showAll', { count: responses.length })}
                <Icons.ChevronDown
                  className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
          {t('taskResult.inference.empty')}
        </div>
      )}

      {spec?.inference && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">
            {t('taskResult.inference.config.title')}
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">
                {t('taskResult.inference.config.maxTokens')}
              </div>
              <div className="text-slate-800">{spec.inference.max_tokens ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t('taskResult.inference.config.temperature')}
              </div>
              <div className="text-slate-800">{spec.inference.temperature ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Top K</div>
              <div className="text-slate-800">{spec.inference.top_k ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Top P</div>
              <div className="text-slate-800">{spec.inference.top_p ?? '-'}</div>
            </div>
            {spec.inference.system_prompt && (
              <div className="md:col-span-2">
                <div className="text-xs text-slate-500 mb-1">
                  {t('taskResult.inference.config.systemPrompt')}
                </div>
                <pre className="text-xs leading-5 font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-auto whitespace-pre-wrap break-words">
                  {spec.inference.system_prompt}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {spec?.model && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">
            {t('taskResult.inference.model.title')}
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">
                {t('taskResult.inference.model.identifier')}
              </div>
              <div className="font-mono text-slate-800 break-all">
                {spec.model.source?.identifier ?? '-'}
              </div>
            </div>
            {spec.model.vllm?.gpu_memory_utilization != null && (
              <div>
                <div className="text-xs text-slate-500">
                  {t('taskResult.inference.model.gpuMemory')}
                </div>
                <div className="text-slate-800">
                  {Math.round(spec.model.vllm.gpu_memory_utilization * 100)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {runData && (
        <JsonPanel
          title={t('taskResult.inference.runDataTitle')}
          filename={`task-runData-${task.taskId}.json`}
          value={runData}
          collapsedLines={24}
        />
      )}
    </div>
  );
};

export default InferenceResultView;

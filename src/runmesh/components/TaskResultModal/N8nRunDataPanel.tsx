import React, { useMemo, useState } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import JsonPanel from '@/runmesh/components/TaskResultModal/ui/JsonPanel';
import type { RunDataMap, INodeExecutionData } from '@/runmesh/types/nodeExecution';
import { useLanguage } from '@/runmesh/i18n';

function formatMs(ms?: number) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

function formatTs(ms?: number) {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function statusPill(status?: string) {
  const s = String(status ?? '').toLowerCase();
  if (s === 'success' || s === 'done') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'running') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s === 'error' || s === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function safeString(v: unknown) {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

function flattenNodeItems(nodeRuns?: INodeExecutionData[]) {
  const firstRun = nodeRuns?.[0];
  const items = firstRun?.data?.main?.[0] ?? [];
  return { firstRun, items };
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function downloadJson(filename: string, value: unknown) {
  const dataStr = JSON.stringify(value ?? null, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface N8nRunDataPanelProps {
  runDataAll: RunDataMap;
  defaultNode?: string;
}

export const N8nRunDataPanel: React.FC<N8nRunDataPanelProps> = ({ runDataAll, defaultNode }) => {
  const { t } = useLanguage();
  const nodes = useMemo(() => Object.keys(runDataAll ?? {}), [runDataAll]);
  const initialNode = defaultNode && runDataAll?.[defaultNode] ? defaultNode : nodes[0];

  const [selectedNode, setSelectedNode] = useState<string>(initialNode);
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const [itemIndex, setItemIndex] = useState(0);

  const selectedRuns = runDataAll?.[selectedNode];
  const { firstRun, items } = useMemo(() => flattenNodeItems(selectedRuns), [selectedRuns]);
  const totalItems = items.length;
  const currentItem = items[itemIndex]?.json ?? null;

  const executionStatus = firstRun?.executionStatus ?? firstRun?.metadata?.runmesh?.status;

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Left: node list */}
      <div className="w-56 shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700 bg-slate-50">
          {t('taskResult.runData.nodes')}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {nodes.map((n) => {
            const active = n === selectedNode;
            const run = runDataAll?.[n]?.[0];
            const st = String(
              run?.executionStatus ?? run?.metadata?.runmesh?.status ?? '',
            ).toLowerCase();
            return (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setSelectedNode(n);
                  setItemIndex(0);
                }}
                className={[
                  'w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-b border-slate-100 hover:bg-slate-50',
                  active ? 'bg-brand-50/40' : 'bg-white',
                ].join(' ')}
              >
                <span className="text-sm text-slate-800 truncate">{n}</span>
                {st ? (
                  <span
                    className={[
                      'text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap',
                      statusPill(st),
                    ].join(' ')}
                  >
                    {st}
                  </span>
                ) : null}
              </button>
            );
          })}
          {nodes.length === 0 && (
            <div className="p-4 text-xs text-slate-500">{t('taskResult.runData.empty')}</div>
          )}
        </div>
      </div>

      {/* Right: content */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-3">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col min-h-0 flex-1">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 shrink-0">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{selectedNode}</div>
              <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <Icons.Clock className="w-3 h-3" />
                  {formatMs(firstRun?.executionTime)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Icons.Clock className="w-3 h-3" />
                  {formatTs(firstRun?.startTime)}
                </span>
                {executionStatus ? (
                  <span
                    className={[
                      'inline-flex items-center px-2 py-0.5 rounded-full border',
                      statusPill(String(executionStatus)),
                    ].join(' ')}
                  >
                    {String(executionStatus)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={[
                  'px-3 py-2 text-xs rounded-lg border transition-colors',
                  viewMode === 'table'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
                ].join(' ')}
              >
                {t('taskResult.runData.table')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('json')}
                className={[
                  'px-3 py-2 text-xs rounded-lg border transition-colors',
                  viewMode === 'json'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
                ].join(' ')}
              >
                JSON
              </button>
            </div>
          </div>

          {/* Item navigation + actions */}
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>{t('taskResult.runData.item')}</span>
              <button
                type="button"
                onClick={() => setItemIndex((v) => Math.max(0, v - 1))}
                disabled={itemIndex <= 0}
                className="p-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                title={t('taskResult.runData.prevItem')}
              >
                <Icons.ChevronRight className="w-4 h-4 rotate-180" />
              </button>
              <span className="font-mono">
                {totalItems === 0 ? '0 / 0' : `${itemIndex + 1} / ${totalItems}`}
              </span>
              <button
                type="button"
                onClick={() => setItemIndex((v) => Math.min(totalItems - 1, v + 1))}
                disabled={itemIndex >= totalItems - 1}
                className="p-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                title={t('taskResult.runData.nextItem')}
              >
                <Icons.ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(JSON.stringify(currentItem ?? null, null, 2));
                }}
                disabled={!currentItem}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Icons.Copy className="w-4 h-4" />
                {t('common.copy')}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadJson(`${selectedNode}-item-${itemIndex + 1}.json`, currentItem)
                }
                disabled={!currentItem}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Icons.Download className="w-4 h-4" />
                {t('common.download')}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-3 flex-1 min-h-0 overflow-hidden flex flex-col">
            {viewMode === 'json' ? (
              <div className="flex-1 min-h-0 overflow-auto">
                <JsonPanel
                  title={t('taskResult.runData.currentItemJson')}
                  filename={`${selectedNode}-item-${itemIndex + 1}.json`}
                  value={currentItem}
                  collapsedLines={32}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-xl">
                {/* 用 grid 模拟 n8n 表格，可真正撑满高度 */}
                <div className="min-w-[1600px] h-full flex flex-col">
                  <div className="grid grid-cols-[28%_32%_64px_112px_18%_18%] bg-slate-50 text-slate-600 text-xs border-b border-slate-200 shrink-0">
                    <div className="text-left px-3 py-2 font-semibold">output</div>
                    <div className="text-left px-3 py-2 font-semibold">prompt</div>
                    <div className="text-left px-3 py-2 font-semibold">index</div>
                    <div className="text-left px-3 py-2 font-semibold">finish_reason</div>
                    <div className="text-left px-3 py-2 font-semibold">metadata</div>
                    <div className="text-left px-3 py-2 font-semibold">usage</div>
                  </div>

                  <div className="grid grid-cols-[28%_32%_64px_112px_18%_18%] bg-white flex-1 min-h-0">
                    <div className="px-3 py-2 border-r border-slate-100 min-h-0">
                      <div className="whitespace-pre-wrap break-words h-full overflow-auto">
                        {safeString(currentItem?.output)}
                      </div>
                    </div>
                    <div className="px-3 py-2 border-r border-slate-100 min-h-0">
                      <div className="whitespace-pre-wrap break-words h-full overflow-auto font-mono">
                        {safeString(currentItem?.prompt)}
                      </div>
                    </div>
                    <div className="px-3 py-2 border-r border-slate-100 text-slate-700 font-mono">
                      {String(currentItem?.index ?? 0)}
                    </div>
                    <div className="px-3 py-2 border-r border-slate-100 text-slate-700">
                      {String(currentItem?.finish_reason ?? '-')}
                    </div>
                    <div className="px-3 py-2 border-r border-slate-100 min-h-0">
                      <JsonPanel value={currentItem?.metadata ?? null} collapsedLines={0} fill />
                    </div>
                    <div className="px-3 py-2 min-h-0">
                      <JsonPanel value={currentItem?.usage ?? null} collapsedLines={0} fill />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default N8nRunDataPanel;

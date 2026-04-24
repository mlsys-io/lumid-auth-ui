import React, { useMemo, useState } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

function downloadJson(filename: string, value: any) {
  const dataStr = JSON.stringify(value, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export interface JsonPanelProps {
  title?: string;
  filename?: string;
  value: any;
  collapsedLines?: number;
  /**
   * 是否尝试撑满父容器高度（用于弹窗表格单元格等场景）
   * - true：面板使用 flex 布局，内容区 flex-1，并在内部滚动
   * - false：按内容自然高度（默认）
   */
  fill?: boolean;
}

export const JsonPanel: React.FC<JsonPanelProps> = ({
  title,
  filename = 'data.json',
  value,
  collapsedLines = 0,
  fill = false,
}) => {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(collapsedLines <= 0);
  const text = useMemo(() => JSON.stringify(value ?? null, null, 2), [value]);

  const showToggle = collapsedLines > 0;
  const maxHeight = !expanded && collapsedLines > 0 ? `${collapsedLines * 18 + 24}px` : undefined;

  return (
    <div
      className={[
        'bg-white border border-slate-200 rounded-xl overflow-hidden',
        fill ? 'h-full min-h-0 flex flex-col' : '',
      ].join(' ')}
    >
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-800">{title ?? t('common.json')}</div>
        <div className="flex items-center gap-2">
          {showToggle && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              {expanded ? t('common.collapse') : t('common.expand')}
              <Icons.ChevronDown
                className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await copyToClipboard(text);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Icons.Copy className="w-4 h-4" />
            {t('common.copy')}
          </button>
          <button
            type="button"
            onClick={() => downloadJson(filename, value)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Icons.Download className="w-4 h-4" />
            {t('common.download')}
          </button>
        </div>
      </div>
      <div className={['bg-slate-50', fill ? 'flex-1 min-h-0' : ''].join(' ')}>
        <pre
          className={[
            'text-xs leading-5 text-slate-800 font-mono p-4 overflow-auto whitespace-pre-wrap break-words',
            fill ? 'h-full min-h-0' : '',
          ].join(' ')}
          style={{ maxHeight }}
        >
          {text}
        </pre>
      </div>
    </div>
  );
};

export default JsonPanel;

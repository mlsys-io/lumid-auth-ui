import React from 'react';
import type { ITaskDetail } from '@/runmesh/types/task';
import JsonPanel from '@/runmesh/components/TaskResultModal/ui/JsonPanel';
import { useLanguage } from '@/runmesh/i18n';

export interface GenericResultViewProps {
  task: ITaskDetail;
  result: Record<string, any>;
}

export const GenericResultView: React.FC<GenericResultViewProps> = ({ task, result }) => {
  const { t } = useLanguage();
  return (
    <JsonPanel
      title={t('taskResult.result.genericTitle')}
      filename={`task-result-${task.taskId}.json`}
      value={result ?? null}
      collapsedLines={32}
    />
  );
};

export default GenericResultView;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ITaskWithResult } from '@/runmesh/types/task';
import { getTaskDetail } from '@/runmesh/api/user/taskApi';
import { getFallbackMock, mockTaskDataById } from '@/runmesh/components/TaskResultModal/mock';
import { useLanguage } from '@/runmesh/i18n';
import type { TranslationKey } from '@/runmesh/i18n/types';

type TimeoutHandle = ReturnType<typeof setTimeout>;
type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

function safeParseJson<T = any>(value?: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isRunningStatus(status?: string) {
  const s = (status ?? '').toUpperCase();
  return s === 'RUNNING' || s === 'DISPATCHED' || s === 'PENDING' || s === 'QUEUED';
}

function normalizeId(value: unknown) {
  if (value == null) return '';
  return String(value);
}

function extractRunTaskId(nodeRuns: any) {
  const run = Array.isArray(nodeRuns) ? nodeRuns[0] : undefined;
  const meta = run?.metadata?.runmesh ?? {};
  return normalizeId(meta?.task_id ?? meta?.taskId ?? run?.task_id ?? run?.taskId);
}

function toIdArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeId).filter(Boolean);
  return [normalizeId(value)].filter(Boolean);
}

function collectIdsFromObject(value: any, out: Set<string>, depth = 0) {
  if (value == null || depth > 6) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectIdsFromObject(item, out, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  Object.entries(value).forEach(([key, v]) => {
    const k = key.toLowerCase();
    if (k.includes('task_id') || k === 'taskid' || k.includes('externaltaskid')) {
      toIdArray(v).forEach((id) => out.add(id));
      return;
    }
    if (
      k.includes('parenttaskid') ||
      k.includes('mergedparentid') ||
      k.includes('dependson') ||
      k.includes('mergedchildren')
    ) {
      toIdArray(v).forEach((id) => out.add(id));
      return;
    }
    collectIdsFromObject(v, out, depth + 1);
  });
}

function collectRelatedIdsFromRun(nodeRuns: any) {
  const ids = new Set<string>();
  const run = Array.isArray(nodeRuns) ? nodeRuns[0] : undefined;
  const meta = run?.metadata?.runmesh ?? {};
  collectIdsFromObject(meta, ids);
  collectIdsFromObject(run?.data, ids);
  return ids;
}

function filterRunDataByTaskId(
  runDataAll: Record<string, any[]> | undefined,
  targetTaskId: string,
) {
  if (!runDataAll || Object.keys(runDataAll).length === 0) return runDataAll;
  const target = normalizeId(targetTaskId);
  if (!target) return {};

  const matchedNodes = new Set<string>();
  const queue: string[] = [target];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    Object.entries(runDataAll).forEach(([nodeName, nodeRuns]) => {
      const runTaskId = extractRunTaskId(nodeRuns);
      if (runTaskId && runTaskId === currentId) {
        if (!matchedNodes.has(nodeName)) {
          matchedNodes.add(nodeName);
          const relatedIds = collectRelatedIdsFromRun(nodeRuns);
          relatedIds.forEach((id) => {
            if (id && !visited.has(id)) queue.push(id);
          });
        }
      }
    });
  }

  const filtered: Record<string, any[]> = {};
  Object.entries(runDataAll).forEach(([nodeName, nodeRuns]) => {
    if (matchedNodes.has(nodeName)) {
      filtered[nodeName] = nodeRuns;
    }
  });
  return filtered;
}

function collectJsonItems(value: any, out: any[]) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const v of value) collectJsonItems(v, out);
    return;
  }
  if (typeof value === 'object') {
    if ('json' in value && (value as any).json) {
      out.push((value as any).json);
      return;
    }
    return;
  }
}

function buildInferenceResultFromRunData(nodeRuns: any, t: TranslateFn) {
  const jsonItems: any[] = [];
  collectJsonItems(nodeRuns, jsonItems);

  const responses = jsonItems
    .map((j) => {
      const question = String(j?.question ?? j?.prompt ?? j?.input ?? '').trim();
      const answerRaw = j?.answer ?? j?.output ?? j?.result;
      const answer =
        typeof answerRaw === 'string'
          ? answerRaw
          : answerRaw == null
            ? ''
            : JSON.stringify(answerRaw, null, 2);
      return {
        question: question || t('taskResult.inference.fallback.prompt'),
        answer: answer || t('taskResult.inference.fallback.output'),
        _raw: j,
      };
    })
    .filter(Boolean);

  return {
    responses,
    total_count: responses.length,
    success_count: responses.length,
    // 单节点 runData（你提到的 data.resultData.runData.Synthesis）
    runData: nodeRuns,
  };
}

export function useTaskData(taskId?: string, initialData?: ITaskWithResult) {
  const { t } = useLanguage();
  const [data, setData] = useState<ITaskWithResult | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pollTimerRef = useRef<TimeoutHandle | null>(null);

  const stopPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const mergeWithInitial = useCallback(
    (next: ITaskWithResult): ITaskWithResult => {
      if (!initialData) return next;
      return {
        task: { ...next.task, ...initialData.task },
        result: next.result ?? initialData.result,
      };
    },
    [initialData],
  );

  const refetch = useCallback(async () => {
    if (!taskId && !initialData) return;
    stopPoll();
    setLoading(true);
    setError(null);

    try {
      // 优先走 mock，确保接口未通时也能展示
      if (taskId && mockTaskDataById[taskId]) {
        const next = mergeWithInitial(mockTaskDataById[taskId]);
        setData(next);
        if (isRunningStatus(next.task.status)) {
          pollTimerRef.current = setTimeout(refetch, 3000);
        }
        return;
      }

      // 如果外部直接传了完整数据，直接使用
      if (!taskId && initialData) {
        setData(initialData);
        if (isRunningStatus(initialData.task.status)) {
          pollTimerRef.current = setTimeout(refetch, 3000);
        }
        return;
      }

      // 尝试真实接口（目前可能未完成），失败则回退到 mock
      if (taskId) {
        // taskId 可能是 UUID 格式的字符串（n8n的task_id），不能转换为 Number
        const raw = await getTaskDetail(taskId);
        const rawAny = raw as any;

        // 兼容：接口返回的是“工作流运行详情”（包含 tasks[] + data.resultData.runData）
        if (rawAny?.data?.resultData?.runData && Array.isArray(rawAny?.tasks)) {
          const tasks = rawAny.tasks as any[];
          const current =
            tasks.find((task) => String(task?.taskId ?? task?.externalTaskId) === String(taskId)) ??
            tasks.find((task) => String(task?.externalTaskId) === String(taskId)) ??
            tasks.find((task) => String(task?.taskId) === String(taskId)) ??
            null;

          const graphNodeName =
            current?.graphNodeName ?? current?.taskName ?? current?.taskNo ?? rawAny?.graphNodeName;
          const runDataAll = rawAny?.data?.resultData?.runData;
          const filteredRunDataAll = filterRunDataByTaskId(runDataAll, String(taskId));
          const nodeRuns = graphNodeName
            ? (filteredRunDataAll?.[graphNodeName] ?? runDataAll?.[graphNodeName])
            : undefined;
          const inferenceResult = buildInferenceResultFromRunData(nodeRuns, t);
          const parsedConfig = safeParseJson<any>(
            current?.parsed ?? current?.parsedConfig ?? rawAny?.parsedConfig,
          );

          const taskTypeGuess = String(current?.taskType ?? 'inference').toLowerCase();

          const next = mergeWithInitial({
            task: {
              taskId: String(current?.taskId ?? current?.externalTaskId ?? taskId),
              taskNo: current?.taskNo ?? '',
              taskName: current?.taskName ?? '',
              taskType: (taskTypeGuess as any) || 'inference',
              status: (current?.status ?? rawAny?.status ?? 'UNKNOWN') as any,
              submitTime: current?.submitTime,
              startTime: current?.startTime,
              endTime: current?.endTime,
              durationSeconds: current?.durationSeconds,
              externalTaskId: current?.externalTaskId ?? current?.taskId ?? taskId,
              graphNodeName,
              parsed: typeof current?.parsed === 'string' ? current.parsed : undefined,
              parsedConfig: parsedConfig ?? undefined,
              error: current?.error ?? null,
              completed:
                Boolean(current?.completed) ||
                String(current?.status ?? '').toUpperCase() === 'DONE',
              failed:
                Boolean(current?.failed) ||
                String(current?.status ?? '').toUpperCase() === 'FAILED',
              appName: current?.appName,
              assignedWorker: current?.assignedWorker,
              costAmount: current?.costAmount,
              costCurrency: current?.costCurrency,
            },
            result: {
              task_id: String(current?.taskId ?? current?.externalTaskId ?? taskId),
              // 额外挂载 runDataAll / 当前节点名，给 n8n 风格弹窗渲染用
              result: {
                ...inferenceResult,
                runDataAll: filteredRunDataAll,
                currentNode: graphNodeName,
              } as any,
            },
          });

          setData(next);
          if (isRunningStatus(next.task.status)) {
            pollTimerRef.current = setTimeout(refetch, 3000);
          }
          return;
        }

        const parsed = safeParseJson<any>(rawAny?.parsed ?? rawAny?.parsedConfig);
        const taskTypeGuess = String(
          rawAny?.taskType ?? rawAny?.taskNo ?? rawAny?.taskName ?? 'unknown',
        ).toLowerCase();

        const next: ITaskWithResult = mergeWithInitial({
          task: {
            taskId: String(rawAny?.taskId ?? taskId),
            taskNo: rawAny?.taskNo ?? '',
            taskName: rawAny?.taskName ?? '',
            taskType: (taskTypeGuess as any) || 'unknown',
            status: (rawAny?.status ?? 'UNKNOWN') as any,
            submitTime: rawAny?.submitTime,
            startTime: rawAny?.startTime,
            endTime: rawAny?.endTime,
            durationSeconds: rawAny?.durationSeconds,
            externalTaskId: rawAny?.externalTaskId,
            graphNodeName: rawAny?.graphNodeName,
            parsed: typeof rawAny?.parsed === 'string' ? rawAny.parsed : undefined,
            parsedConfig: parsed ?? undefined,
            error: rawAny?.error ?? null,
            completed:
              Boolean(rawAny?.completed) || String(rawAny?.status ?? '').toUpperCase() === 'DONE',
            failed:
              Boolean(rawAny?.failed) || String(rawAny?.status ?? '').toUpperCase() === 'FAILED',
            appName: rawAny?.appName,
            assignedWorker: rawAny?.assignedWorker,
            costAmount: rawAny?.costAmount,
            costCurrency: rawAny?.costCurrency,
          },
        });

        setData(next);
        if (isRunningStatus(next.task.status)) {
          pollTimerRef.current = setTimeout(refetch, 3000);
        }
        return;
      }
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e?.message ?? e)));
      if (taskId) {
        const fallback = mergeWithInitial(mockTaskDataById[taskId] ?? getFallbackMock(taskId));
        setData(fallback);
        if (isRunningStatus(fallback.task.status)) {
          pollTimerRef.current = setTimeout(refetch, 3000);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [initialData, mergeWithInitial, stopPoll, taskId, t]);

  const parsedConfig = useMemo(() => {
    const fromState = data?.task?.parsedConfig;
    if (fromState) return fromState;
    const parsed = safeParseJson<any>(data?.task?.parsed);
    return parsed ?? null;
  }, [data?.task?.parsed, data?.task?.parsedConfig]);

  useEffect(() => {
    // 弹窗首次打开时调用方会触发 refetch；这里用来处理 taskId/initialData 变化
    setData(initialData ?? null);
  }, [initialData, taskId]);

  useEffect(() => {
    return () => stopPoll();
  }, [stopPoll]);

  return { data, loading, error, refetch, parsedConfig };
}

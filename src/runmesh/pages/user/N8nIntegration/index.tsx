import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { N8nEditor, N8nEditorHandle } from '@/runmesh/components/N8nEditor';
import { Icons } from '@/runmesh/components/Icons';
import { createWorkflow, getWorkflowDetail } from '@/runmesh/api/user/workflow';
import { useWorkflowTransferStore } from '@/runmesh/stores/useWorkflowTransferStore';
import { useLanguage } from '@/runmesh/i18n';
type LogEntry = {
  id: string;
  direction: 'in' | 'out';
  payload: unknown;
  timestamp: string;
};

const defaultPayload = JSON.stringify(
  {
    type: 'N8N_ACTION',
    action: 'openWorkflow',
    data: { workflowId: 'demo-workflow' },
  },
  null,
  2,
);

export const N8nIntegration: React.FC<{
  workflowIdOverride?: string;
  isVisible?: boolean;
}> = ({ workflowIdOverride, isVisible = true }) => {
  const location = useLocation();
  const { t } = useLanguage();

  const workflowId = useMemo(() => {
    if (workflowIdOverride) return workflowIdOverride;
    const pathnameMatch = location.pathname.match(/\/app\/n8n\/([^/?]+)/);
    return pathnameMatch?.[1];
  }, [location.pathname, workflowIdOverride]);

  const editorRef = useRef<N8nEditorHandle>(null);
  const viteN8nUrl = import.meta.env.VITE_N8N_URL || 'http://127.0.0.1:8080';
  const baseN8nUrl = useRef(viteN8nUrl);
  const [n8nUrl, setN8nUrl] = useState(viteN8nUrl);
  const [payload, setPayload] = useState(defaultPayload);
  const [status, setStatus] = useState(t('n8nIntegration.status.waiting'));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [canLoadEditor, setCanLoadEditor] = useState(false);
  const [editorKey, setEditorKey] = useState('new');
  const currentLoadKeyRef = useRef<string | null>(null);
  const isVisibleRef = useRef(isVisible);
  const consumeTransferData = useWorkflowTransferStore((s) => s.consumeTransferData);
  const transferredDataRef = useRef<{
    definitionJson: string | null;
    name: string | null;
    description: string | null;
  } | null>(null);
  const lastSentDataRef = useRef<{
    definitionJson: string | null;
    name: string | null;
    description: string | null;
  } | null>(null);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  const buildWorkflowUrl = useCallback((id?: string) => {
    const base = baseN8nUrl.current;
    return id ? `${base}/workflow/${id}` : `${base}/workflow/new`;
  }, []);

  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    setLogs((prev) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toLocaleTimeString(),
      },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const handleReady = useCallback(() => {
    setStatus(t('n8nIntegration.status.ready'));
    setError(null);
    setIsReady(true);
  }, [t]);

  const handleMessage = useCallback(
    (data: unknown) => {
      addLog({ direction: 'in', payload: data });
      setStatus(t('n8nIntegration.status.receivedMessage'));
    },
    [addLog, t],
  );

  const sendMessage = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
      setError(null);
    } catch {
      setError(t('n8nIntegration.error.invalidJson'));
      return;
    }

    editorRef.current?.sendMessage(parsed);
    addLog({ direction: 'out', payload: parsed });
    setStatus(t('n8nIntegration.status.sentMessage'));
  }, [payload, addLog, t]);

  const sendPing = useCallback(() => {
    const ping = {
      type: 'N8N_ACTION',
      action: 'ping',
      data: { source: 'NUS-FLOW', time: Date.now() },
    };
    editorRef.current?.sendMessage(ping);
    addLog({ direction: 'out', payload: ping });
    setStatus(t('n8nIntegration.status.sentPing'));
  }, [addLog, t]);

  const simulateInbound = useCallback(() => {
    const fakeMessage = {
      type: 'N8N_EVENT',
      event: 'workflowSaved',
      data: { workflowId: 'demo-workflow', savedAt: new Date().toISOString() },
      __fromN8nMock: true,
    };
    window.postMessage(fakeMessage, window.location.origin);
  }, []);

  const prettyLogs = useMemo(
    () =>
      logs.map((log) => ({
        ...log,
        text: JSON.stringify(log.payload, null, 2),
      })),
    [logs],
  );

  // 如果有 workflowId，先获取工作流详情并修改 n8nUrl，然后才加载编辑器
  // 没有 workflowId，直接正常加载编辑器
  useEffect(() => {
    if (!isVisibleRef.current) return;

    const nextLoadKey = workflowId ? `id:${workflowId}` : 'new';
    if (currentLoadKeyRef.current === nextLoadKey) {
      return;
    }
    currentLoadKeyRef.current = nextLoadKey;
    setEditorKey(nextLoadKey);

    const nextUrl = buildWorkflowUrl(workflowId);
    setStatus(
      workflowId ? t('n8nIntegration.status.loadingWorkflow') : t('n8nIntegration.status.creating'),
    );
    setError(null);
    setIsReady(false);
    setCanLoadEditor(false);
    setN8nUrl(nextUrl);

    if (!workflowId) {
      setCanLoadEditor(true);
      return;
    }

    const workflowIdNum = Number(workflowId);
    if (Number.isNaN(workflowIdNum)) {
      setError(t('n8nIntegration.error.invalidWorkflowId', { id: workflowId }));
      setCanLoadEditor(true);
      return;
    }

    const loadWorkflowData = async () => {
      try {
        await getWorkflowDetail(workflowIdNum);
        setStatus(t('n8nIntegration.status.workflowLoaded'));
      } catch (err) {
        console.error('加载工作流失败:', err);
        setError(
          t('n8nIntegration.error.loadFailed', {
            reason: err instanceof Error ? err.message : t('n8nIntegration.error.unknown'),
          }),
        );
      } finally {
        setCanLoadEditor(true);
      }
    };

    loadWorkflowData();
  }, [workflowId, buildWorkflowUrl, t]);

  // 拉取待传递的 definitionJson（从工作流市场存入的临时 store），本地缓存后清空 store
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldInject =
      searchParams.get('waitDefinition') === 'true' ||
      searchParams.get('usePostMessage') === 'true';

    if (!shouldInject) {
      // BUG 修复：如果当前不是注入模式（例如创建空白应用），主动清空传输 store，防止数据污染
      consumeTransferData();
      transferredDataRef.current = null;
      return;
    }

    if (transferredDataRef.current !== null) return;
    const data = consumeTransferData();
    if (data.definitionJson) {
      transferredDataRef.current = data;
    }
  }, [consumeTransferData, location.search]);

  // 监听来自 n8n iframe 的 postMessage（直接发送到 window 的消息）
  useEffect(() => {
    const handleWindowMessage = async (event: MessageEvent) => {
      // 验证消息来源（可选：可以根据需要添加 origin 验证）
      if (typeof event.data !== 'string') return;

      try {
        const message = JSON.parse(event.data);

        // 处理 AI 生成工作流成功的消息
        if (message.command === 'aiWorkflowCreated' && message.workflowId) {
          addLog({
            direction: 'in',
            payload: {
              type: 'N8N_EVENT',
              event: 'aiWorkflowCreated',
              workflowId: message.workflowId,
            },
          });
          setStatus(t('n8nIntegration.status.aiCreated', { id: message.workflowId }));

          // 调用 createWorkflow 接口，传入 n8n 的 workflowId
          try {
            const createdWorkflowId = await createWorkflow({
              id: message.workflowId, // 传入 n8n 的 workflowId
              name: message.name,
              appType: 'workflow',
              description: t('n8nIntegration.aiWorkflowDescription'),
            });
            setStatus(t('n8nIntegration.status.synced', { id: createdWorkflowId }));

            // 更新 URL：移除 create=true，改为使用 workflowId
            // navigate(`/app/n8n/${message.workflowId}`, { replace: true });
          } catch (error) {
            console.error('同步工作流失败:', error);
            setStatus(t('n8nIntegration.status.syncFailed'));
          }
        }
        // 处理 AI 生成工作流失败的消息
        else if (message.command === 'aiWorkflowError') {
          addLog({
            direction: 'in',
            payload: {
              type: 'N8N_EVENT',
              event: 'aiWorkflowError',
              error: message.error,
            },
          });
          setStatus(t('n8nIntegration.status.aiFailed', { reason: message.error }));
        }
        // 处理 n8n 已接收到定义的通知
        else if (message.command === 'definitionReceived') {
          consumeTransferData(); // 消费并清空 store，防止数据重复使用
          transferredDataRef.current = null;
          lastSentDataRef.current = null;
        }
      } catch {
        // 忽略无法解析的消息（可能是其他来源的消息）
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [addLog, consumeTransferData, t]);

  // iframe 就绪后把待复用的 definitionJson 通过 postMessage 发给 n8n
  useEffect(() => {
    if (!isReady || !editorRef.current) return;
    if (!transferredDataRef.current) return;

    const data = transferredDataRef.current;
    transferredDataRef.current = null;
    lastSentDataRef.current = data;

    const message = {
      command: 'injectDefinition',
      definitionJson: data.definitionJson,
      name: data.name,
      description: data.description,
      source: 'NUS-FLOW',
    };
    // 通过 editorRef -> N8nEditor -> postMessage
    editorRef.current.sendMessage(message);
    addLog({ direction: 'out', payload: message });
    setStatus(t('n8nIntegration.status.sentTemplate'));
  }, [isReady, addLog, t]);

  // 监听 iframe 请求重发 definitionJson
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      const msg = event.data as { command?: string };
      if (msg.command !== 'requestDefinition') return;

      const data = lastSentDataRef.current || transferredDataRef.current || consumeTransferData();

      if (!data || !data.definitionJson) {
        return;
      }

      // 若重新取到了新值，更新引用
      if (!lastSentDataRef.current) {
        lastSentDataRef.current = data;
      }

      const message = {
        command: 'injectDefinition',
        definitionJson: data.definitionJson,
        name: data.name,
        description: data.description,
        source: 'NUS-FLOW',
      };
      editorRef.current?.sendMessage(message);
      addLog({ direction: 'out', payload: message });
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [consumeTransferData, addLog]);

  // 当 workflowId 存在且 n8n 就绪时，自动发送 openWorkflow 消息
  useEffect(() => {
    if (workflowId && isReady && editorRef.current) {
      const openWorkflowMessage = {
        type: 'N8N_ACTION',
        action: 'openWorkflow',
        data: { workflowId },
      };
      editorRef.current.sendMessage(openWorkflowMessage);
      addLog({ direction: 'out', payload: openWorkflowMessage });
      setStatus(t('n8nIntegration.status.autoOpened', { id: workflowId }));
    }
  }, [workflowId, isReady, addLog, t]);

  const content = (
    <div className="h-full w-full p-6 overflow-auto space-y-6">
      <section
        className={`grid gap-6 ${
          isPanelVisible ? 'grid-cols-1 xl:grid-cols-[1.4fr_0.45fr]' : 'grid-cols-1'
        }`}
      >
        <div className="space-y-4">
          {/* {!isPanelVisible && (
            <div className="flex items-center justify-end">
              <button
                onClick={() => setIsPanelVisible(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors shadow-sm"
                title="显示面板"
              >
                <Icons.Eye className="w-3.5 h-3.5" />
                显示面板
              </button>
            </div>
          )} */}
          {/* <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">n8n 访问地址</p>
              <p className="text-xs text-slate-500">需要保证该地址可在浏览器访问</p>
            </div>
            <input
              value={n8nUrl}
              onChange={(e) => setN8nUrl(e.target.value)}
              className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="http://localhost:5678"
            />
          </div> */}

          {canLoadEditor ? (
            <N8nEditor
              key={editorKey}
              ref={editorRef}
              n8nUrl={n8nUrl}
              onReady={handleReady}
              onMessage={handleMessage}
              height="97vh"
              workflowId={workflowId}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="spinner mb-4" />
                <p className="text-slate-600">{status}</p>
                {error && <p className="text-rose-600 mt-2">{error}</p>}
              </div>
            </div>
          )}
        </div>

        {isPanelVisible && (
          <div className="space-y-4">
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={() => setIsPanelVisible(false)}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"
                title={t('n8nIntegration.panel.hide')}
              >
                <Icons.X className="w-3.5 h-3.5" />
                {t('n8nIntegration.panel.hide')}
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {t('n8nIntegration.panel.title')}
                  </p>
                  <p className="text-xs text-slate-500">{status}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={sendPing}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors"
                  >
                    <Icons.Send className="w-3.5 h-3.5" />
                    {t('n8nIntegration.panel.sendPing')}
                  </button>
                  <button
                    onClick={simulateInbound}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"
                  >
                    <Icons.Activity className="w-3.5 h-3.5" />
                    {t('n8nIntegration.panel.simulateInbound')}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  {t('n8nIntegration.panel.jsonLabel')}
                </label>
                <textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  className="w-full h-40 rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {error && <p className="text-xs text-rose-600">{error}</p>}
                <button
                  onClick={sendMessage}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
                >
                  <Icons.Play className="w-3.5 h-3.5" />
                  {t('n8nIntegration.panel.sendToN8n')}
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-800">
                  {t('n8nIntegration.log.title')}
                </p>
                <p className="text-xs text-slate-500">{t('n8nIntegration.log.hint')}</p>
              </div>
              <div className="h-[280px] overflow-auto space-y-2">
                {prettyLogs.length === 0 && (
                  <p className="text-xs text-slate-400">{t('n8nIntegration.log.waiting')}</p>
                )}
                {prettyLogs.map((log) => (
                  <div key={log.id} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                          log.direction === 'in'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {log.direction === 'in'
                          ? t('n8nIntegration.log.directionIn')
                          : t('n8nIntegration.log.directionOut')}
                      </span>
                      <span>{log.timestamp}</span>
                    </div>
                    <pre className="text-[11px] leading-5 text-slate-800 overflow-auto">
                      {log.text}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  return content;
};

export default N8nIntegration;

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import './N8nEditor.css';
import { useAuthStore } from '@/runmesh/stores/useAuthStore';
import { useLanguage } from '@/runmesh/i18n';

export type N8nEditorHandle = {
  /** 发送消息到 n8n iframe */
  sendMessage: (data: unknown) => void;
};

export interface N8nEditorProps {
  /** n8n 前端地址 */
  n8nUrl?: string;
  /** iframe 加载完成回调 */
  onReady?: () => void;
  /** 收到 n8n postMessage 时的回调 */
  onMessage?: (data: unknown, event: MessageEvent) => void;
  /** 容器 className，可自定义高度等样式 */
  className?: string;
  /** iframe 高度，默认 100vh */
  height?: string;
  /** 工作流 ID，当此值变化时会重新加载 iframe */
  workflowId?: string;
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export const N8nEditor = forwardRef<N8nEditorHandle, N8nEditorProps>(
  (
    {
      n8nUrl = `${import.meta.env.VITE_N8N_URL}/workflow/new`,
      onReady,
      onMessage,
      className,
      height = '100vh',
    },
    ref,
  ) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<LoadStatus>('loading');
    const [error, setError] = useState<string | null>(null);
    const [resolvedUrl, setResolvedUrl] = useState<string>(n8nUrl);
    const { user, token, hasHydrated } = useAuthStore();
    const { language, t } = useLanguage();
    const lastSentTokenRef = useRef<string | null>(null);
    const lastSentAuthInfoRef = useRef<string | null>(null);
    const n8nReadyRef = useRef<boolean>(false);
    const targetOrigin = useMemo(() => {
      try {
        // Handle protocol-relative URLs (e.g. //kv.run:8081/workflow/new)
        const url = n8nUrl.startsWith('//')
          ? new URL(`${window.location.protocol}${n8nUrl}`)
          : new URL(n8nUrl);
        return url.origin;
      } catch {
        return '';
      }
    }, [n8nUrl]);

    const handleLoad = useCallback(() => {
      setStatus('ready');
      setError(null);
      onReady?.();
    }, [onReady]);

    const handleError = useCallback(() => {
      setStatus('error');
      setError(t('n8nEditor.error.loadFailed'));
    }, [t]);

    const sendMessage = useCallback(
      (data: unknown) => {
        if (!iframeRef.current?.contentWindow || !targetOrigin) return;
        iframeRef.current.contentWindow.postMessage(data, targetOrigin);
      },
      [targetOrigin],
    );

    const sendAuthInfo = useCallback(() => {
      if (!hasHydrated) return;
      if (!user?.id) return;
      if (!iframeRef.current?.contentWindow || !targetOrigin) return;

      const authInfo = {
        type: 'AUTH_INFO' as const,
        userId: user.id,
        userName: user.name ?? '',
        userEmail: user.email ?? '',
        userRole: user.role ?? '',
        source: 'NUS-FLOW',
      };

      const fingerprint = JSON.stringify(authInfo);
      if (lastSentAuthInfoRef.current === fingerprint) return;

      iframeRef.current.contentWindow.postMessage(authInfo, targetOrigin);
      lastSentAuthInfoRef.current = fingerprint;
    }, [hasHydrated, user, targetOrigin]);

    useImperativeHandle(
      ref,
      () => ({
        sendMessage,
      }),
      [sendMessage],
    );

    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (!targetOrigin) return;

        // 验证来源；同时允许本地同源的模拟消息（以便开发调试）
        const eventData = event.data as { __fromN8nMock?: boolean };
        const isTrustedOrigin =
          event.origin === targetOrigin ||
          (event.origin === window.location.origin && eventData?.__fromN8nMock === true);

        if (!isTrustedOrigin) return;

        if (event.data && typeof event.data === 'object' && 'type' in event.data) {
          const data = event.data as { type?: string; event?: string };
          if (data.type === 'N8N_EVENT' && data.event === 'ready') {
            n8nReadyRef.current = true;
            sendAuthInfo();
            return;
          }
          if (data.type === 'TOKEN_REQUEST') {
            if (token && event.source && targetOrigin) {
              const bearerToken = `Bearer ${token}`;
              (event.source as Window).postMessage(bearerToken, targetOrigin);
            }
            return;
          }
        }

        onMessage?.(event.data, event);
      };

      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }, [onMessage, sendAuthInfo, targetOrigin, token]);

    useEffect(() => {
      if (status !== 'ready') return;
      if (!token) return;
      if (!iframeRef.current?.contentWindow || !targetOrigin) return;

      const bearerToken = `Bearer ${token}`;
      if (lastSentTokenRef.current === bearerToken) return;

      iframeRef.current.contentWindow.postMessage(bearerToken, targetOrigin);
      lastSentTokenRef.current = bearerToken;
    }, [status, token, targetOrigin]);

    // n8n ready 后，把父应用的用户信息通过 postMessage 传给 n8n
    useEffect(() => {
      if (status !== 'ready') return;
      if (!n8nReadyRef.current) return;
      sendAuthInfo();
    }, [status, sendAuthInfo, user, hasHydrated]);

    // 监听语言变化，动态同步到 n8n
    useEffect(() => {
      if (status !== 'ready' || !targetOrigin || !iframeRef.current?.contentWindow) return;

      const lang = language.startsWith('zh') ? 'zh' : 'en';
      const message = {
        type: 'N8N_ACTION',
        action: 'setLocale',
        data: { locale: lang },
      };

      iframeRef.current.contentWindow.postMessage(message, targetOrigin);
    }, [status, language, targetOrigin]);

    // 在地址层面透传 React Router 查询参数（如 create）
    useEffect(() => {
      if (!hasHydrated) return; // 等待本地存储恢复

      try {
        // 直接使用父组件传入的 n8nUrl（父组件已经根据 workflowId 调整好了）
        const url = new URL(n8nUrl);
        // 移除可能存在的旧 token 参数，确保使用最新的 token
        url.searchParams.delete('authToken');
        url.searchParams.delete('token');

        // 从 BrowserRouter 的 search 中获取 create 参数
        // BrowserRouter 的 URL 格式：http://localhost:3000/app/n8n?create=true
        // 查询参数在 search 部分
        const searchParams = new URLSearchParams(window.location.search);

        const createParam = searchParams.get('create');
        const definitionParam = searchParams.get('definitionJson');
        const waitDefinitionParam = searchParams.get('waitDefinition');
        const usePostMessageParam = searchParams.get('usePostMessage');

        if (createParam) {
          url.searchParams.set('create', createParam);
        }
        if (definitionParam) {
          url.searchParams.set('definitionJson', definitionParam);
        }
        if (waitDefinitionParam) {
          url.searchParams.set('waitDefinition', waitDefinitionParam);
        }
        if (usePostMessageParam) {
          url.searchParams.set('usePostMessage', usePostMessageParam);
        }

        // 添加语言参数
        const lang = language.startsWith('zh') ? 'zh' : 'en';
        url.searchParams.set('lang', lang);

        setResolvedUrl(url.toString());
      } catch {
        setResolvedUrl(n8nUrl);
      }
    }, [hasHydrated, n8nUrl, language]);

    // 预加载 resolvedUrl 页面
    useEffect(() => {
      if (!resolvedUrl) return;

      // 创建 prefetch link 元素来预加载页面
      const linkId = 'n8n-editor-prefetch';
      let linkElement = document.getElementById(linkId) as HTMLLinkElement;

      if (!linkElement) {
        linkElement = document.createElement('link');
        linkElement.id = linkId;
        linkElement.rel = 'prefetch';
        linkElement.as = 'document';
        document.head.appendChild(linkElement);
      }

      linkElement.href = resolvedUrl;

      // 清理函数：组件卸载时移除 prefetch link
      return () => {
        const existingLink = document.getElementById(linkId);
        if (existingLink) {
          document.head.removeChild(existingLink);
        }
      };
    }, [resolvedUrl]);

    return (
      <div className={`n8n-editor-container ${className || ''}`} style={{ height }}>
        {status === 'loading' && (
          <div className="n8n-editor-loading">
            <div className="spinner" />
            <p>{t('n8nEditor.loading')}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="n8n-editor-error">
            <p className="mb-2">{error}</p>
            <button onClick={() => window.location.reload()}>{t('n8nEditor.retry')}</button>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={resolvedUrl}
          title="n8n Workflow Editor"
          className="n8n-editor-iframe"
          style={{ display: status === 'ready' ? 'block' : 'none', height }}
          onLoad={handleLoad}
          onError={handleError}
          allow="clipboard-read; clipboard-write"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        />
      </div>
    );
  },
);

N8nEditor.displayName = 'N8nEditor';

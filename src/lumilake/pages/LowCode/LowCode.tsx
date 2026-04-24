import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import Icon from '../../components/ui/Icon';
import PreviewSampleModal from '../../components/ui/PreviewSampleModal';
import SubmitJobModal from '../../components/ui/SubmitJobModal';
import Table from '../../components/ui/Table';
import { SqlUploadPluginResponse } from '@/lumilake/types/sql';
import { ModelingUploadResponse } from '@/lumilake/types/modeling';
import { PythonDeployJobResponse } from '@/lumilake/types/python';
import ScatterPreviewChart from '../../components/ui/ScatterPreviewChart';

const N8N_URL = import.meta.env.VITE_N8N_URL || 'http://127.0.0.1:5678';
const API_KEY = import.meta.env.VITE_API_KEY || '';

const n8nOrigin = (() => {
  try {
    return new URL(N8N_URL).origin;
  } catch {
    return '';
  }
})();

export const LowCode: React.FC = () => {
  const { user } = useAuthStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  // Second section state
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<SqlUploadPluginResponse | ModelingUploadResponse | PythonDeployJobResponse | null>(null);
  const [previewType, setPreviewType] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; title: string; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', title: string, message: string) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 4000);
  };

  const sendToken = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(`Bearer ${API_KEY}`, n8nOrigin);
  }, []);

  const sendAuthInfo = useCallback(() => {
    if (!user) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'AUTH_INFO',
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role.toUpperCase(),
        source: 'AI4S-APP',
      },
      n8nOrigin
    );
  }, [user]);

  // Listen for messages from N8N
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== n8nOrigin) return;
      const { data } = event;
      if (data?.type === 'N8N_EVENT' && data?.event === 'ready') {
        sendToken();
        sendAuthInfo();
      }
      if (data?.type === 'TOKEN_REQUEST') {
        sendToken();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendToken, sendAuthInfo]);


  // Send token once iframe loads
  useEffect(() => {
    if (iframeReady) {
      sendToken();
      sendAuthInfo();
    }
  }, [iframeReady, sendToken, sendAuthInfo]);

  const handleRetry = () => {
    setIframeError(false);
    setIframeReady(false);
    if (iframeRef.current) {
      iframeRef.current.src = `${N8N_URL}/workflow/new?create=true`;
    }
  };

  const updatePreviewSection = (data: SqlUploadPluginResponse | ModelingUploadResponse | PythonDeployJobResponse, type: string) => {
    setPreviewType(type);
    setPreviewData(data);
    setIsPreviewModalOpen(false);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="bg-white px-6 py-3 flex items-center justify-between border-b border-gray-200">
        <h1 className="text-3xl font-bold text-blue-0">Low Code</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg ${
          toast.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5 mt-0.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 mt-0.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <div>
            <p className="font-semibold text-sm">{toast.title}</p>
            <p className="text-sm">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="ml-auto text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* N8N iframe area */}
      <div className="relative" style={{ height: '75vh' }}>
        {/* Loading overlay */}
        {!iframeReady && !iframeError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-50 z-10">
            <div className="w-9 h-9 border-4 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-slate-500 text-sm font-medium">Loading N8N Editor...</p>
          </div>
        )}

        {/* Error state */}
        {iframeError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-50 z-10">
            <p className="text-red-600 text-sm">
              Failed to load N8N Editor. Is the server running at{' '}
              <code className="bg-gray-100 px-1 rounded">{N8N_URL}</code>?
            </p>
            <button
              onClick={handleRetry}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={`${N8N_URL}/workflow/new?create=true`}
          title="N8N Workflow Editor"
          allow="clipboard-read; clipboard-write"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-top-navigation"
          className="w-full h-full border-0 block transition-opacity duration-300"
          style={{ opacity: iframeReady ? 1 : 0 }}
          onLoad={() => setTimeout(() => setIframeReady(true), 500)}
          onError={() => setIframeError(true)}
        />
      </div>

      {/* Second Section: Actions */}
      <div className="bg-white border-t p-6">
        {/* Action Buttons */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setIsPreviewModalOpen(true)}
            className="flex-1 py-3 px-6 bg-white border-2 border-blue text-blue font-medium rounded-lg hover:bg-blue hover:text-white transition-colors"
          >
            Preview Sample
          </button>
          <button
            onClick={() => setIsDeployModalOpen(true)}
            className="flex-1 py-3 px-6 bg-blue text-white font-medium rounded-lg hover:bg-blue/90 transition-colors"
          >
            Submit Job
          </button>
        </div>
      </div>

      {/* Sample Preview Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 pt-2.5 mt-6">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-3xl font-bold text-blue">Sample Preview</h2>
          <button className="p-1 hover:bg-gray-100 rounded">
            <Icon name="expand-alt" className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-6">
          {previewData && previewType === 'table' && 'preview' in previewData && !Array.isArray(previewData.preview) ? (
            <Table header={(previewData as SqlUploadPluginResponse).preview.columns} data={(previewData as SqlUploadPluginResponse).preview.rows} />
          ) : (
            <ScatterPreviewChart />
          )}
        </div>
      </div>

      <PreviewSampleModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        updatePreviewSection={updatePreviewSection}
        apiType="sql"
      />

      <SubmitJobModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        apiType="low-code"
        handleDeployJobSubmit={(jobId) => {
          setIsDeployModalOpen(false);
          showToast('success', 'Job Submitted', `Job ${jobId} has been successfully submitted.`);
        }}
      />
    </div>
  );
};

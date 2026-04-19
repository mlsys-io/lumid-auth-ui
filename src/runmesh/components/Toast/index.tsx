import React, { useState, useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastProps {
  id?: string;
  message: string;
  type: ToastType;
  title?: string;
  duration?: number;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const Toast: React.FC<ToastProps> = ({
  id: _id,
  message,
  type,
  title,
  duration = 3000,
  onClose,
  action,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);

    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        onClose?.();
      }, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <Icons.CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <Icons.AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <Icons.AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'info':
        return <Icons.AlertCircle className="w-5 h-5 text-blue-500" />;
      case 'loading':
        return <Icons.Activity className="w-5 h-5 text-brand-500 animate-spin" />;
      default:
        return null;
    }
  };

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'info':
        return 'bg-blue-50 border-blue-200';
      case 'loading':
        return 'bg-slate-50 border-slate-200';
      default:
        return 'bg-white border-slate-200';
    }
  };

  const getTextColor = () => {
    switch (type) {
      case 'success':
        return 'text-green-800';
      case 'error':
        return 'text-red-800';
      case 'warning':
        return 'text-yellow-800';
      case 'info':
        return 'text-blue-800';
      case 'loading':
        return 'text-slate-800';
      default:
        return 'text-slate-800';
    }
  };

  return (
    <div
      className={`
        fixed top-4 right-4 z-50 flex items-start space-x-3
        px-4 py-3 rounded-lg shadow-lg border
        ${getBackgroundColor()} ${getTextColor()}
        transition-all duration-300 transform
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        min-w-[300px] max-w-[400px]
      `}
    >
      {getIcon()}
      <div className="flex-1 min-w-0">
        {title && <p className="text-sm font-semibold">{title}</p>}
        <p className="text-sm font-medium break-words">{message}</p>
        {action && (
          <div className="mt-2">
            <button
              onClick={action.onClick}
              className="text-sm font-medium text-brand-600 hover:text-brand-800 hover:underline"
            >
              {action.label}
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onClose?.(), 300);
        }}
        className="text-slate-400 hover:text-slate-600 transition-colors mt-0.5"
      >
        <Icons.X className="w-4 h-4" />
      </button>
    </div>
  );
};

// Toast管理器Hook
export const useToast = () => {
  const [toasts, setToasts] = useState<Array<{ id: string; props: ToastProps }>>([]);

  const showToast = (props: Omit<ToastProps, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, props }]);
  };

  const showSuccess = (message: string, title?: string, action?: ToastProps['action']) => {
    showToast({ type: 'success', message, title, action });
  };

  const showError = (message: string, title?: string, action?: ToastProps['action']) => {
    showToast({ type: 'error', message, title, action });
  };

  const showWarning = (message: string, title?: string, action?: ToastProps['action']) => {
    showToast({ type: 'warning', message, title, action });
  };

  const showInfo = (message: string, title?: string, action?: ToastProps['action']) => {
    showToast({ type: 'info', message, title, action });
  };

  const showLoading = (message: string, title?: string) => {
    showToast({ type: 'loading', message, title, duration: 0 }); // loading toast不会自动消失
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const toastContainer = () => (
    <>
      {toasts.map(({ id, props }) => (
        <Toast key={id} {...props} onClose={() => removeToast(id)} />
      ))}
    </>
  );

  return {
    showToast,
    toastContainer,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
  };
};

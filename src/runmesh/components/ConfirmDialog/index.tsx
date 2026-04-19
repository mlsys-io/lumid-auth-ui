import React, { useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  const { t } = useLanguage();
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const resolvedTitle = title ?? t('dialog.title.confirm');
  const resolvedConfirmText = confirmText ?? t('dialog.confirm');
  const resolvedCancelText = cancelText ?? t('dialog.cancel');
  const badgeText = variant === 'danger' ? t('dialog.badge.risk') : t('dialog.badge.notice');

  const variantStyles = {
    default: {
      icon: <Icons.AlertCircle className="w-6 h-6 text-blue-500" />,
      button: 'bg-brand-600 hover:bg-brand-700',
      badge: 'bg-blue-50 text-blue-600',
    },
    danger: {
      icon: <Icons.AlertTriangle className="w-6 h-6 text-red-500" />,
      button: 'bg-red-600 hover:bg-red-700',
      badge: 'bg-red-50 text-red-600',
    },
  };

  const currentVariant = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-auto z-10 overflow-hidden border border-slate-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="inline-flex items-center space-x-2 text-sm font-medium px-3 py-1 rounded-full shadow-sm bg-white border border-slate-200">
            {currentVariant.icon}
            <span className={`text-xs font-semibold ${currentVariant.badge}`}>{badgeText}</span>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 transition-colors"
            onClick={onCancel}
            aria-label={t('common.close')}
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-2">
          <h3 className="text-xl font-semibold text-slate-900 leading-7">{resolvedTitle}</h3>
          <p className="text-sm text-slate-600 leading-6">{message}</p>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end space-x-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-200 transition-colors"
            onClick={onCancel}
          >
            {resolvedCancelText}
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors ${currentVariant.button}`}
            onClick={onConfirm}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

export interface EnterpriseModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  confirmText?: string;
  cancelText?: string;
  width?: number | string;
  height?: number | string;
  loading?: boolean;
  /**
   * 自定义 footer。
   * - 不传（undefined）：使用默认 footer（取消/确认）
   * - 传入 ReactNode：使用自定义 footer
   * - 传入 null：隐藏 footer
   */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const EnterpriseModal: React.FC<EnterpriseModalProps> = ({
  open,
  title,
  onClose,
  onSubmit,
  confirmText,
  cancelText,
  width,
  height,
  loading,
  footer,
  children,
}) => {
  const { t } = useLanguage();
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open && !loading) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, loading, onClose]);

  if (!open) return null;

  const resolvedWidth = width ?? '90vw';
  const resolvedHeight = height ?? '90vh';
  const resolvedConfirmText = confirmText ?? t('dialog.save');
  const resolvedCancelText = cancelText ?? t('dialog.cancel');
  const bodyStyle: React.CSSProperties = {
    width: resolvedWidth,
    maxWidth: resolvedWidth,
    height: resolvedHeight,
    maxHeight: resolvedHeight,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
      />
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full overflow-hidden flex flex-col"
        style={bodyStyle}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>

        {footer !== null && (
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-end space-x-3 shrink-0">
            {footer !== undefined ? (
              footer
            ) : (
              <>
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-sm disabled:opacity-50"
                >
                  {resolvedCancelText}
                </button>
                {onSubmit && (
                  <button
                    onClick={onSubmit}
                    disabled={loading}
                    className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm disabled:opacity-70"
                  >
                    {resolvedConfirmText}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EnterpriseModal;

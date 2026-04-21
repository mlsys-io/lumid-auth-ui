import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  style
}) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const defaultStyle: React.CSSProperties = { width: '1304px', height: '908px', maxHeight: '90vh', maxWidth: '95vw' };
  let combinedStyle = { ...defaultStyle };
  if (style && Object.keys(style).length > 0) {
    combinedStyle = { ...defaultStyle, ...style };
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div 
          className={`relative bg-[#EAEAEA] rounded-lg shadow-xl transform transition-all flex flex-col`}
          style={combinedStyle}
        >
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between p-6">
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
          
          {/* Content */}
          <div className="px-6 pb-6 flex-1 min-h-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal; 
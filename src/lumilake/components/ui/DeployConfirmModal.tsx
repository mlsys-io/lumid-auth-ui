import React from 'react';

interface DeployConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deployData: {
    resourceGroup: string;
    resultDestination: string;
  };
}

const DeployConfirmModal: React.FC<DeployConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  deployData
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Deploy Full Job</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <p className="text-gray-600 mb-6">
          Are you sure you want to deploy the job below?
        </p>

        {/* Resource Group */}
        <div className="mb-4">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            Resource Group
          </span>
          <p className="text-gray-600">
            {deployData.resourceGroup || 'Lorem ipsum dolor sit amet'}
          </p>
        </div>

        {/* Result Destination */}
        <div className="mb-6">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            Result Destination
          </span>
          <p className="text-gray-600">
            {deployData.resultDestination || 'Lorem ipsum dolor sit amet'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-white border border-blue text-blue rounded-lg hover:bg-gray-50 transition-colors"
          >
            No, I'll change the details
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 px-4 bg-blue text-white rounded-lg hover:bg-blue/90 transition-colors"
          >
            Yes, I'd like to deploy
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeployConfirmModal; 
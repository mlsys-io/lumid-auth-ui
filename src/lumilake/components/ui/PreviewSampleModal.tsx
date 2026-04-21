import React, {useRef, useState} from 'react';
import { sqlService } from "@/lumilake/services/sqlService.ts";
import { modelingService } from "@/lumilake/services/modelingService.ts";
import { SqlUploadPluginResponse} from "@/lumilake/types/sql.ts";
import  {ModelingUploadResponse } from "@/lumilake/types/modeling.ts";
import {PythonDeployJobResponse} from "@/lumilake/types/python.ts";
import {pythonService} from "@/lumilake/services/pythonService.ts";

interface PreviewSampleModalProps {
  isOpen: boolean;
  onClose: () => void;
  updatePreviewSection: (
      data: SqlUploadPluginResponse | ModelingUploadResponse | PythonDeployJobResponse,
      type: string,
  ) => void;
  apiType: 'sql' | 'modeling' | 'python'
}

const PreviewSampleModal: React.FC<PreviewSampleModalProps> = ({
  isOpen,
  onClose,
  updatePreviewSection,
  apiType = 'sql'
}) => {
  const [visualizationType, setVisualizationType] = useState('default');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        setFile(e.target.files[0]);
      }
  };

  const openUploadPlugin = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!file) {
      alert('Please select a file to import.');
      return;
    }

    let data;
    if (apiType == 'sql') {
      data = await sqlService.sqlUploadPlugin(file)
    } else if (apiType == 'modeling') {
      data = await modelingService.modelingUploadPlugin(file)
    } else {
      data = await pythonService.pythonUploadPlugin(file)
    }

    updatePreviewSection(data, 'table');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Preview Sample</h2>
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
          Select your preferred visualisation type below.
        </p>

        {/* Visualization Type */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Visualisation Type
          </label>
          <select
            value={visualizationType}
            onChange={(e) => setVisualizationType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
          >
            <option value="default">Default visualisation</option>
            <option value="bar">Bar Chart</option>
            <option value="line">Line Chart</option>
            <option value="pie">Pie Chart</option>
            <option value="scatter">Scatter Plot</option>
          </select>
        </div>

        {/* Import Plugin */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Import Plugin
          </label>
          <div className="flex gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
            />
            <button
              className="px-4 py-2 bg-white border border-blue text-blue rounded-lg hover:bg-gray-50 transition-colors"
              onClick={openUploadPlugin}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-white border border-blue text-blue rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2 px-4 bg-blue text-white rounded-lg hover:bg-blue/90 transition-colors"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreviewSampleModal; 
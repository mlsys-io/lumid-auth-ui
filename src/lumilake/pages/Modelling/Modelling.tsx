import React, { useState } from "react";
import Icon from "../../components/ui/Icon";
import PreviewSampleModal from "../../components/ui/PreviewSampleModal";
import SubmitJobModal from '../../components/ui/SubmitJobModal';
import {SqlUploadPluginResponse} from "@/lumilake/types/sql.ts";
import Table from "@/lumilake/components/ui/Table.tsx";

export const Modelling: React.FC = () => {
  const [selectedResourceGroup, setSelectedResourceGroup] =
    useState("Lorem ipsum");
  const [selectedConfig, setSelectedConfig] = useState("Lorem ipsum");
  const [selectedDataset, setSelectedDataset] = useState("Table");

  const [previewData, setPreviewData] = useState<SqlUploadPluginResponse | null>(null);
  const [previewType, setPreviewType] = useState('');
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);

  const handlePreviewSample = () => {
    setIsPreviewModalOpen(true);
  };

  const handleDeployFullJob = () => {
    setIsDeployModalOpen(true);
  };

  const updatePreviewSection = (data: SqlUploadPluginResponse, type = 'table') => {
    setPreviewType(type);
    setPreviewData(data);
    setIsPreviewModalOpen(false);
  }

  const handleDeployJobSubmit = (_status: string) => {
    setIsDeployModalOpen(false);
  }

  return (
    <div className="p-6 bg-gray-50 rounded-lg">
      <div className="max-w-7xl mx-auto h-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-blue">Modelling</h1>
        </div>

        {/* Configuration Section */}
        <div className="mb-6">
          {/* Resource Group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Resource Group
            </label>
            <div className="relative">
              <select
                value={selectedResourceGroup}
                onChange={(e) => setSelectedResourceGroup(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
              >
                <option value="Lorem ipsum">Lorem ipsum</option>
                <option value="Option 2">Option 2</option>
                <option value="Option 3">Option 3</option>
              </select>
            </div>
          </div>
        </div>

        {/* Dataset Selection and Upload */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Choose Dataset
            </label>
            <div className="flex gap-3">
              <select
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
              >
                <option value="Table">Table</option>
                <option value="Dataset 1">Dataset 1</option>
                <option value="Dataset 2">Dataset 2</option>
              </select>
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-blue rounded-lg hover:bg-gray-50 transition-colors">
                <Icon name="upload" className="w-4 h-4" />
                <span className="text-blue font-medium">Upload</span>
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={handlePreviewSample}
            className="flex-1 py-3 px-6 bg-white border-2 border-blue text-blue font-medium rounded-lg hover:bg-blue hover:text-white transition-colors"
          >
            Preview Sample
          </button>
          <button
            onClick={handleDeployFullJob}
            className="flex-1 py-3 px-6 bg-blue text-white font-medium rounded-lg hover:bg-blue/90 transition-colors"
          >
            Deploy Full Job
          </button>
        </div>

        {/* Sample Preview Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-blue">Sample Preview</h2>
            <button className="p-1 hover:bg-gray-100 rounded">
              <Icon name="expand-alt" className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-8 text-center">
            {previewData ? (
                <>
                  {previewType === 'table'
                      ?
                      <Table header={previewData.preview.columns} data={previewData.preview.rows}/>
                      : (<></>)}
                </>
            ) : <p className="text-gray-400 text-lg">No preview yet</p>}
          </div>
        </div>

        {/* Preview Sample Modal */}
        <PreviewSampleModal
            isOpen={isPreviewModalOpen}
            onClose={() => setIsPreviewModalOpen(false)}
            updatePreviewSection={updatePreviewSection}
            apiType='modeling'
        />

        <SubmitJobModal
            isOpen={isDeployModalOpen}
            onClose={() => setIsDeployModalOpen(false)}
            handleDeployJobSubmit={handleDeployJobSubmit}
            apiType='modeling'
        />
      </div>
    </div>
  );
};

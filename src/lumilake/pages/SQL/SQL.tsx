import React, { useState } from 'react';
import Icon from '../../components/ui/Icon';
import PreviewSampleModal from '../../components/ui/PreviewSampleModal';
import SubmitJobModal from '../../components/ui/SubmitJobModal';
import AIAssistantModal from "../../components/ui/AIAssistantModal.tsx";
import ThirdPartyFunctionImportModal from "@/lumilake/components/ui/ThirdPartyFunctionImportModal.tsx";
import SQLQueryImportModal from "@/lumilake/components/ui/SQLQueryImportModal.tsx";
import {SqlUploadPluginResponse} from "@/lumilake/types/sql.ts";
import Table from "@/lumilake/components/ui/Table.tsx";

export const SQL: React.FC = () => {
  const [sqlQuery, setSqlQuery] = useState('');
  const [selectedDataset, setSelectedDataset] = useState('');
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isAssistantModalOpen, setIsAssistantModalOpen] = useState(false);
  const [isThirdPartyFunctionModalOpen, setIsThirdPartyFunctionModalOpen] = useState(false);
  const [isSQLQueryImportModalOpen, setIsSQLQueryImportModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<SqlUploadPluginResponse | null>(null);
  const [previewType, setPreviewType] = useState('');

  const handlePreviewSample = () => {
    setIsPreviewModalOpen(true);
  };

  const handleDeployFullJob = () => {
    setIsDeployModalOpen(true);
  };

  const handleAIModalSubmit = async (answer: string) => {
    if (answer.trim() !== "") {
      setSqlQuery(answer);
    }
    setIsAssistantModalOpen(false);
  }

  const handleFunctionImportSubmit = () => {
    // Show success alert
    setIsThirdPartyFunctionModalOpen(false);
  }

  const handleSQLQueryImportSubmit = (linePreview: string) => {
    if (linePreview.trim() !== "") {
      setSqlQuery(linePreview);
    }
    setIsSQLQueryImportModalOpen(false);
  }

  const updatePreviewSection = (data: SqlUploadPluginResponse, type = 'table') => {
    setPreviewType(type);
    setPreviewData(data);
    setIsPreviewModalOpen(false);
  }

  const handleDeployJobSubmit = () => {
    setIsDeployModalOpen(false);
  }

  return (
    <div className="p-6 bg-gray-50 rounded-lg">
      <div className="max-w-7xl mx-auto h-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-blue">SQL Editor</h1>
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-blue rounded-lg hover:bg-gray-50 transition-colors"
                onClick={() => setIsAssistantModalOpen(true)}
            >
              <Icon name="robot" className="w-5 h-5" />
              <span className="text-blue font-medium">AI Assistant</span>
            </button>
            <button className="px-4 py-2 bg-white border border-blue rounded-lg text-blue font-medium hover:bg-gray-50 transition-colors"
              onClick={() => setIsThirdPartyFunctionModalOpen(true)}>
              Import 3rd Party Function/Model
            </button>
            <button className="px-4 py-2 bg-white border border-blue rounded-lg text-blue font-medium hover:bg-gray-50 transition-colors"
                onClick={() => setIsSQLQueryImportModalOpen(true)}
            >
              Import SQL
            </button>
          </div>
        </div>

        {/* SQL Editor */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <textarea
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            className="w-full h-48 p-4 font-mono text-sm border-none resize-none focus:outline-none focus:ring-0"
            placeholder="-- Use the editor to create new tables, insert data and all other SQL operations."
          />
        </div>

        {/* Dataset Selection and Actions */}
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
                <option value="">Select one</option>
                <option value="dataset1">Dataset 1</option>
                <option value="dataset2">Dataset 2</option>
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
            { previewData ? (
                <>
                  { previewType === 'table'
                      ?
                      <Table header={previewData.preview.columns} data={previewData.preview.rows} />
                      : (<></>)}
                </>
            ) : <p className="text-gray-400 text-lg">No preview yet</p>}
          </div>
        </div>

        <PreviewSampleModal
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          updatePreviewSection={updatePreviewSection}
          apiType='sql'
        />

        <SubmitJobModal
          isOpen={isDeployModalOpen}
          onClose={() => setIsDeployModalOpen(false)}
          handleDeployJobSubmit={handleDeployJobSubmit}
        />

        <AIAssistantModal
          isOpen={isAssistantModalOpen}
          onClose={() => setIsAssistantModalOpen(false)}
          handleAIModalSubmit={handleAIModalSubmit}
        />
        <ThirdPartyFunctionImportModal
            isOpen={isThirdPartyFunctionModalOpen}
            onClose={() => setIsThirdPartyFunctionModalOpen(false)}
            handleFunctionImportSubmit={handleFunctionImportSubmit}
        />
        <SQLQueryImportModal
            isOpen={isSQLQueryImportModalOpen}
            onClose={() => setIsSQLQueryImportModalOpen(false)}
            handleSQLQueryImportSubmit={handleSQLQueryImportSubmit}
          />
      </div>
    </div>
  );
}; 
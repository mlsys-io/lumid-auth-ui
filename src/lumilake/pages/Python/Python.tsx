import React, { useState } from "react";
import Icon from "../../components/ui/Icon";
import PreviewSampleModal from "../../components/ui/PreviewSampleModal";
import SubmitJobModal from '../../components/ui/SubmitJobModal';
import {SqlUploadPluginResponse} from "@/lumilake/types/sql.ts";
import Table from "@/lumilake/components/ui/Table.tsx";

interface CodeCell {
  id: string;
  type: "code" | "markdown";
  content: string;
  output?: string;
  isExecuting?: boolean;
}

export const Python: React.FC = () => {
  const [cells, setCells] = useState<CodeCell[]>([
    {
      id: "1",
      type: "code",
      content: "import sample",
      output: "",
    },
    {
      id: "2",
      type: "code",
      content: 'print ("sample")',
      output: "",
    },
    {
      id: "3",
      type: "code",
      content: 'print ("sample")',
      output: "sample",
    },
  ]);

  const [selectedDataset, setSelectedDataset] = useState("Table");
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: string;
  } | null>({
    name: "Lorem dolor ipsum.xls",
    size: "512kb",
  });

  const [previewData, setPreviewData] = useState<SqlUploadPluginResponse | null>(null);
  const [previewType, setPreviewType] = useState('');
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("File");

  const addCell = (type: "code" | "markdown" = "code") => {
    const newCell: CodeCell = {
      id: Date.now().toString(),
      type,
      content: "",
      output: "",
    };
    setCells([...cells, newCell]);
  };

  const updateCellContent = (cellId: string, content: string) => {
    setCells(
      cells.map((cell) => (cell.id === cellId ? { ...cell, content } : cell))
    );
  };

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

  const renderCell = (cell: CodeCell, index: number) => (
    <div key={cell.id} className="border border-gray-300 rounded-md mb-4">
      <div className="flex">
        {/* Cell number */}
        <div className="w-16 flex-shrink-0 text-right pr-2 pt-3 bg-gray-50 border-r border-gray-300">
          <span className="text-sm text-gray-600 font-mono">
            [{index + 1}]:
          </span>
        </div>

        {/* Cell content */}
        <div className="flex-1">
          <textarea
            value={cell.content}
            onChange={(e) => updateCellContent(cell.id, e.target.value)}
            className="w-full p-3 font-mono text-sm border-0 resize-none focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
            rows={Math.max(1, cell.content.split("\n").length)}
            placeholder="Enter Python code..."
            style={{ minHeight: "45px" }}
          />

          {/* Cell output */}
          {cell.output && (
            <div className="border-t border-gray-300 bg-gray-50 p-3">
              <div className="text-sm text-gray-600 font-mono">
                {cell.output}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-6 bg-gray-50 rounded-lg">
      <div className="max-w-7xl mx-auto h-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-blue">
            Python (Jupyter Notebook)
          </h1>
          <div className="flex items-center space-x-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-blue rounded-lg hover:bg-gray-50 transition-colors">
              <Icon name="robot" className="w-5 h-5" />
              <span className="text-blue font-medium">AI Assistant</span>
            </button>
            <button className="px-4 py-2 bg-white border border-blue rounded-lg text-blue font-medium hover:bg-gray-50 transition-colors">
              Import 3rd Party Function/Model
            </button>
          </div>
        </div>

        {/* Toolbar - Horizontal Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8">
              {["File", "Edit", "View", "Run", "Kernel"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab
                      ? "border-blue text-blue"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>
          
          {/* Tab Content */}
          <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
            {activeTab === "File" && (
              <div className="space-y-2">
                {/* TODO: will be implement later */}
              </div>
            )}
            
            {activeTab === "Edit" && (
              <div className="space-y-2">
                {/* TODO: will be implement later */}
              </div>
            )}
            
            {activeTab === "View" && (
              <div className="space-y-2">
                {/* TODO: will be implement later */}
              </div>
            )}
            
            {activeTab === "Run" && (
              <div className="space-y-2">
                {/* TODO: will be implement later */}
              </div>
            )}
            
            {activeTab === "Kernel" && (
              <div className="space-y-2">
                {/* TODO: will be implement later */}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center space-x-2 ml-auto mb-6">
          <button className="p-2 hover:bg-gray-100 rounded" title="Save">
            <Icon name="file-alt" className="w-4 h-4" />
          </button>
          <button
            onClick={() => addCell("code")}
            className="p-2 hover:bg-gray-100 rounded"
            title="Add cell"
          >
            <Icon name="plus" className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded" title="Cut">
            <Icon name="copy" className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded" title="Copy">
            <Icon name="copy" className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded" title="Run">
            <Icon name="python" className="w-4 h-4" />
          </button>
          <select className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent">
            <option>Code</option>
            <option>Markdown</option>
          </select>
        </div>

        {/* Notebook cells */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="p-4">
            <div className="space-y-0">
              {cells.map((cell, index) => renderCell(cell, index))}
            </div>

            {/* Empty cell for new input */}
            <div className="border border-gray-300 rounded-md">
              <div className="flex">
                <div className="w-16 flex-shrink-0 text-right pr-2 pt-3 bg-gray-50 border-r border-gray-300">
                  <span className="text-sm text-gray-600 font-mono">[]:</span>
                </div>
                <div className="flex-1">
                  <textarea
                    className="w-full p-3 font-mono text-sm border-0 resize-none focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
                    rows={1}
                    placeholder=""
                    style={{ minHeight: "45px" }}
                  />
                </div>
              </div>
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
            apiType='python'
        />

        {/* Deploy Full Job Modal */}
        <SubmitJobModal
            isOpen={isDeployModalOpen}
            onClose={() => setIsDeployModalOpen(false)}
            handleDeployJobSubmit={handleDeployJobSubmit}
            apiType='python'
        />
      </div>
    </div>
  );
};

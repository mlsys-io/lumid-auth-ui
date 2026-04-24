import React, { useRef, useState } from 'react';
import { RunningJobService } from "@/lumilake/services/runningJobService.ts";

interface SubmitJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  handleDeployJobSubmit: (jobId: string) => void;
  apiType: 'sql' | 'modeling' | 'python' | 'low-code';
}

const SubmitJobModal: React.FC<SubmitJobModalProps> = ({
  isOpen,
  onClose,
  handleDeployJobSubmit,
  apiType = 'sql',
}) => {
  const [jobName, setJobName] = useState('');
  const [inputString, setInputString] = useState('');
  const [inputFileName, setInputFileName] = useState('');
  const [outputString, setOutputString] = useState('');
  const [outputFileName, setOutputFileName] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');

  const [workflowJson, setWorkflowJson] = useState('');

  const inputFileRef = useRef<HTMLInputElement>(null);
  const outputFileRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, target: 'input' | 'output') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (target === 'input') {
      setInputFileName(file.name);
      if (apiType === 'low-code') {
        const reader = new FileReader();
        reader.onload = (ev) => setWorkflowJson(ev.target?.result as string ?? '');
        reader.readAsText(file);
      }
    } else {
      setOutputFileName(file.name);
    }
  };

  const parseInputs = (): Record<string, unknown[]> | null => {
    if (!inputString.trim()) return {};
    try { return JSON.parse(inputString); } catch { return null; }
  };

  const parseOutputLocation = (): { type: string; table?: string; column?: string; prefix?: string } | null => {
    if (!outputString.trim()) return { type: 'db' };
    try { return JSON.parse(outputString); } catch { return null; }
  };

  const handleSubmit = async () => {
    if (apiType !== 'low-code') {
      handleDeployJobSubmit('submitted');
      return;
    }

    if (!workflowJson) {
      setError('Please upload a workflow JSON file.');
      return;
    }
    try {
      const parsed = JSON.parse(workflowJson);
      if (!parsed.nodes || !parsed.connections) {
        setError('Invalid workflow file. Please upload an n8n workflow JSON (exported from N8N editor), not a workload definition file.');
        return;
      }
    } catch {
      setError('Workflow file is not valid JSON.');
      return;
    }
    if (!jobName.trim()) {
      setError('Job name is required.');
      return;
    }

    const inputs = parseInputs();
    if (inputs === null) {
      setError('Invalid JSON in the Inputs field.');
      return;
    }
    const output_location = parseOutputLocation();
    if (output_location === null) {
      setError('Invalid JSON in the Output Location field.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await RunningJobService.submitJob({
        data: [{
          workflow: workflowJson,
          inputs,
          output_location,
          input_batch_size: 1,
          name: jobName.trim(),
        }],
        priority,
      }, 'n8n');
      handleDeployJobSubmit(result.data.job_id);
    } catch {
      setError('Failed to submit job. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-lg font-bold text-gray-900">Submit Job</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto max-h-[80vh]">
          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Job Information */}
          <div className="mb-5">
            <h3 className="text-base font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">
              Job Information
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Name</label>
              <input
                type="text"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g. Linear Regression"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          {/* Input */}
          <div className="mb-5">
            <h3 className="text-base font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">
              Input
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">JSON Inputs</label>
              <textarea
                value={inputString}
                onChange={(e) => setInputString(e.target.value)}
                placeholder={'{"Stock": ["NVDA", "MSFT", "AAPL"]}'}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Upload File
              </label>
              <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                <span className="flex-1 px-3 py-2 text-sm text-gray-400 truncate">
                  {inputFileName || 'No file selected'}
                </span>
                <input
                  ref={inputFileRef}
                  type="file"
                  accept={apiType === 'low-code' ? '.json' : undefined}
                  className="hidden"
                  onChange={(e) => handleFileChange(e, 'input')}
                />
                <button
                  onClick={() => inputFileRef.current?.click()}
                  className="mx-1 px-2 py-0.5 text-blue text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors border border-blue"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>

          {/* Output */}
          <div className="mb-6">
            <h3 className="text-base font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">
              Output Location
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">JSON Output Location</label>
              <textarea
                value={outputString}
                onChange={(e) => setOutputString(e.target.value)}
                placeholder={'{\n  "type": "s3",\n  "prefix": "toy/my-output.txt"\n}'}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Upload File
              </label>
              <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                <span className="flex-1 px-3 py-2 text-sm text-gray-400 truncate">
                  {outputFileName || 'No file selected'}
                </span>
                <input ref={outputFileRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'output')} />
                <button
                  onClick={() => outputFileRef.current?.click()}
                  className="mx-1 px-2 py-0.5 text-blue text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors border border-blue"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 bg-[#1e3a8a] text-white rounded-lg text-sm font-medium hover:bg-[#1e3a8a]/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubmitJobModal;

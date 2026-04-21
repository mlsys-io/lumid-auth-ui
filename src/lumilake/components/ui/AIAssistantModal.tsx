import React, { useState } from 'react';
import {sqlService} from "@/lumilake/services/sqlService.ts";

interface AIAssistantModalProps {
    isOpen: boolean;
    onClose: () => void;
    handleAIModalSubmit: (prompt: string) => void;
}

const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
    isOpen,
    onClose,
   handleAIModalSubmit
}) => {
    if (!isOpen) return null;

    const [prompt, setPrompt] = useState("")
    const [previewData, setPreviewData] = useState("");

    const onConfirm = () => {
        handleAIModalSubmit(previewData);
    }

    const getAIResponse = async () => {
        if (prompt.trim() === "") {
            return;
        }

        const answer = await sqlService.submitAIPrompt(prompt);
        setPreviewData(answer);
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">AI Assistant</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                <div className="flex gap-3">
                  <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="flex-1 h-32 p-3 border rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="please put your prompt here"
                  ></textarea>

                    <button
                        onClick={getAIResponse }
                        className="w-24 h-32 bg-blue text-white rounded-2xl hover:bg-blue-600 transition-colors"
                    >
                        Ask
                    </button>
                </div>
                { previewData != "" ? <div className="my-4 border rounded-lg bg-gray-50 p-3 max-h-40 overflow-y-auto">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Preview:</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">
                        {previewData}
                    </p>
                </div> : <></>}
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2 px-4 bg-white border border-blue text-blue rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 py-2 px-4 bg-blue text-white rounded-lg hover:bg-blue/90 transition-colors"
                    >
                        Submit
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AIAssistantModal;
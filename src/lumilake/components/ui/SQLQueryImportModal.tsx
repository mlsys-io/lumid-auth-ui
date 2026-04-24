import React, { useState } from 'react';
import { sqlService } from "@/lumilake/services/sqlService.ts";
import Modal from "@/lumilake/components/ui/Modal.tsx";

interface SQLQueryImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    handleSQLQueryImportSubmit: (previewContent: string) => void;
}

const SQLQueryImportModal: React.FC<SQLQueryImportModalProps> = ({
    isOpen,
    onClose,
    handleSQLQueryImportSubmit
}) => {
    if (!isOpen) return null;

    const [file, setFile] = useState<File | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const onConfirm = async () => {
        if (file) {
            const linePreview = await sqlService.importSQLQuery(file);
            if (linePreview) {
                handleSQLQueryImportSubmit(linePreview);
            }
        }
    }

    return (
        <Modal
            title={"Import SQL Query"}
            onClose={onClose}
            isOpen={isOpen}
            style={{ maxHeight: 'auto', height: 'auto' }}
        >
            <div
                className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-blue-500 transition-colors">
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    onChange={handleFileChange}
                />
                <label
                    htmlFor="file-upload"
                    className="text-sm text-gray-600 cursor-pointer"
                >
                    {file ? (
                        <span className="text-blue-600 font-medium">{file.name}</span>
                    ) : (
                        "Click to choose a file"
                    )}
                </label>
            </div>

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
        </Modal>
    );
}

export default SQLQueryImportModal;
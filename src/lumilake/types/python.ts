export type PythonAIAssistantResponse = {
    answer: string;
}

export type PythonImportFunctionResponse = {
    file_received: boolean
}

interface UploadPreviewType {
    columns: string[];
    rows: (string | number)[][];
}

export type PythonUploadPluginResponse = {
    ok: boolean,
    file_received: boolean,
    plugin_received: boolean,
    preview:  UploadPreviewType
}

export interface FolderItem {
    id?: string;
    name: string;
}

export type PythonDeployFolderResponse = {
    "items": FolderItem[];
}

export type PythonDeployJobRequest = {
    name: string
    folder_id?: string
    resources?: Record<string, any>
    params?: Record<string, any>
}

export interface Job {
    "id": number,
    "name": string,
    "type": "sql",
    "status": string,
    "submitted_at": string,
    "payload": Record<string, string>,
}

export type PythonDeployJobResponse = {
    ok: boolean
    job: Job
}
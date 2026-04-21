export type SqlAIAssistantResponse = {
    answer: string;
}

export type SqlImportFunctionResponse = {
    file_received: boolean
}

export type SqlImportQueryResponse = {
    "lines_preview": string,
}

interface UploadPreviewType {
    columns: string[];
    rows: (string | number)[][];
}

export type SqlUploadPluginResponse = {
    ok: boolean,
    file_received: boolean,
    plugin_received: boolean,
    preview:  UploadPreviewType
}

export interface FolderItem {
    id?: string;
    name: string;
}

export type SqlDeployFolderResponse = {
    "items": FolderItem[];
}

export type SqlDeployJobRequest = {
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

export type SqlDeployJobResponse = {
    ok: boolean
    job: Job
}
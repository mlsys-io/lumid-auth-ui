export interface ModelingItem {
    columns: string[];
    rows: (string | number) [];
}

export type ModelingUploadResponse = {
    ok: boolean;
    plugin_received: boolean;
    dataset_received: boolean;
    preview: ModelingItem[];
}

export interface ModelingDeployJob {
    "id": number,
    "name": string,
    "type": "modeling",
    "status": "queued" | "running" | "failed" | "completed",
    "submitted_at": string,
    "payload": Record<string, string | number | boolean>,
}

export type ModelingDeployJobRequest = {
    name: string
    folder_id?: string
    resources?: Record<string, any>
    params?: Record<string, any>
}

export type ModelingDeployResponse = {
    ok: boolean;
    job: ModelingDeployJob;
}
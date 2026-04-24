export type DataLabelFilter = {
    page: number;
    pageSize: number;
    search?: string;
}

export interface DataLabel {
    id: number;
    label: string;
    value: string;
    created_at: Date;
}

export type DataLabelListResponse = {
    "total": number;
    "page": number;
    "page_size": number;
    "total_page": number;
    "items": DataLabel[];
}

export type DataLabelImportResponse = {
    ok: boolean; added: DataLabel[]
}

export type DataLabelExportResponse = Blob;

export type DataLabelBatchDeleteResponse = {
    ok: boolean;
    deleted_count: number;
    missing: string[]
}

export type DataLabelDeleteOneResponse = {
    ok: boolean;
    deleted: DataLabel
}
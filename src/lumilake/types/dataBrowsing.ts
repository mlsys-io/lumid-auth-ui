export interface ApiResponse<T> {
  ok: boolean;
  stale: boolean;
  data: T;
}

export interface DBColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  ordinal_position: number;
}

export interface DBPreview {
  schema: string;
  table: string;
  columns: DBColumn[];
  rows: Record<string, any>[];
  captured_at: string;
}

export interface S3File {
  path: string;
  size_bytes: number;
}

export interface S3FilesResponse {
  files: S3File[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface S3FoldersResponse {
  sub_folders: string[];
  files: S3File[];
  file_count: number;
}

export interface S3DownloadResponse {
  url?: string;
  download_url?: string;
  presigned_url?: string;
  path?: string;
}
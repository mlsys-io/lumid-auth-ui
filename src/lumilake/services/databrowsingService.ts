import { apiService } from "@/lumilake/services/api";
import {
  ApiResponse,
  DBColumn,
  DBPreview,
  S3DownloadResponse,
  S3FilesResponse,
  S3FoldersResponse,
} from "@/lumilake/types/dataBrowsing";

export class DataBrowsingService {
  static async getSchemas(): Promise<string[]> {
    try {
      const res = await apiService.get<ApiResponse<string[]>>("/db/schemas");
      return Array.isArray(res?.data) ? res.data : [];
    } catch (error) {
      console.error("getSchemas error:", error);
      return [];
    }
  }

  static async getTables(schema: string): Promise<string[]> {
    try {
      const res = await apiService.get<ApiResponse<string[]>>("/db/tables", {
        params: { schema },
      });
      return Array.isArray(res?.data) ? res.data : [];
    } catch (error) {
      console.error("getTables error:", error);
      return [];
    }
  }

  static async getColumns(schema: string, table: string): Promise<DBColumn[]> {
    try {
      const res = await apiService.get<ApiResponse<DBColumn[]>>("/db/columns", {
        params: { schema, table },
      });
      return Array.isArray(res?.data) ? res.data : [];
    } catch (error) {
      console.error("getColumns error:", error);
      return [];
    }
  }

  static async getTablePreview(
    schema: string,
    table: string,
    limit: number = 10
  ): Promise<DBPreview | null> {
    try {
      const res = await apiService.get<ApiResponse<DBPreview>>("/db/preview", {
        params: { schema, table, limit },
      });
      return res?.data ?? null;
    } catch (error) {
      console.error("getTablePreview error:", error);
      return null;
    }
  }

  static async getS3Files(
    path: string,
    page: number = 1
  ): Promise<S3FilesResponse | null> {
    try {
      const res = await apiService.get<ApiResponse<S3FilesResponse>>("/s3/files", {
        params: { path, page },
      });
      return res?.data ?? null;
    } catch (error) {
      console.error("getS3Files error:", error);
      return null;
    }
  }

  static async getS3Folders(path: string): Promise<S3FoldersResponse | null> {
    try {
      const res = await apiService.get<ApiResponse<S3FoldersResponse>>("/s3/folders", {
        params: { path },
      });
      return res?.data ?? null;
    } catch (error) {
      console.error("getS3Folders error:", error);
      return null;
    }
  }

  static async getS3DownloadUrl(path: string): Promise<string | null> {
    try {
      const res = await apiService.get<ApiResponse<S3DownloadResponse>>(
        "/s3/files/download",
        {
          params: { path },
        }
      );

      return (
        res?.data?.url ??
        res?.data?.download_url ??
        res?.data?.presigned_url ??
        null
      );
    } catch (error) {
      console.error("getS3DownloadUrl error:", error);
      return null;
    }
  }
}

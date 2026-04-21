import {
    DataLabel, DataLabelBatchDeleteResponse, DataLabelDeleteOneResponse,
    DataLabelExportResponse,
    DataLabelFilter,
    DataLabelImportResponse,
    DataLabelListResponse
} from "@/lumilake/types/dataLabel.ts";
import { apiService } from "@/lumilake/services/api.ts";

export const dataLabelService = {
    getDataLabelList: async (filter: DataLabelFilter): Promise<DataLabelListResponse> => {
        const query = new URLSearchParams();
        query.append('page', filter.page.toString());
        query.append('page_size', filter.pageSize.toString());

        return await apiService.get<DataLabelListResponse>(`/data-labels?${query.toString()}`);
    },
    importDataLabels: async (items: DataLabel[]): Promise<DataLabelImportResponse> => {
        return await apiService.post<DataLabelImportResponse>(`/data-labels/import`, items);
    },
    exportDataLabels: async (): Promise<DataLabelExportResponse> => {
        return await apiService.get<DataLabelExportResponse>(`/data-labels/export`, {
            responseType: "blob", // ensure file download
        });
    },
    deleteBatch: async (ids: number[]): Promise<DataLabelBatchDeleteResponse> => {
        return await apiService.delete<DataLabelBatchDeleteResponse>(`/data-labels`, {
            ids,
        });
    },
    deleteOne: async (id: number): Promise<DataLabelDeleteOneResponse> => {
        return await apiService.delete<DataLabelDeleteOneResponse>(`/data-labels/${id}`);
    },
}
import { apiService } from "@/lumilake/services/api.ts";
import {
    SqlAIAssistantResponse, SqlDeployFolderResponse, SqlDeployJobResponse, SqlDeployJobRequest,
    SqlImportFunctionResponse,
    SqlImportQueryResponse, SqlUploadPluginResponse,
} from "@/lumilake/types/sql.ts";

export const sqlService = {
    submitAIPrompt: async (prompt: string): Promise<string> => {
        const res = await apiService.post<SqlAIAssistantResponse>
        ("/sql/ai-assistant",
            { query: prompt }
        );

        return res.answer;
    },
    importFunction: async (file: File): Promise<boolean> => {
        const formData = new FormData();
        formData.append("name", file.name);
        formData.append("version", "1.0.0");
        formData.append("file", file);

        const res = await apiService.upload<SqlImportFunctionResponse>
        ("/sql/import-function-model",
            formData
        );

        return res.file_received;
    },
    importSQLQuery: async (file: File): Promise<string> => {
        const formData = new FormData();
        formData.append("name", file.name);
        formData.append("sql_file", file);

        const res = await apiService.upload<SqlImportQueryResponse>
        ("/sql/import",
            formData
        );

        return res.lines_preview;
    },
    sqlUploadPlugin: async (pluginFile: File, datasetFile?: File): Promise<SqlUploadPluginResponse> => {
        const formData = new FormData();
        formData.append("name", pluginFile.name);
        formData.append("plugin", pluginFile);
        if (datasetFile) {
            formData.append("dataset", datasetFile);
        }

        const res = await apiService.upload<SqlUploadPluginResponse>
        ("/sql/upload",
            formData
        );

        return res;
    },
    getDeployFolder: async (): Promise<SqlDeployFolderResponse> => {
        return await apiService.get<SqlDeployFolderResponse>("/sql/folders");
    },
    submitDeployJob: async (payload: SqlDeployJobRequest): Promise<SqlDeployJobResponse> => {
        return await apiService.post<SqlDeployJobResponse>("/sql/deploy", payload);
    }
}
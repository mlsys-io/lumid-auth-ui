import { apiService } from "@/lumilake/services/api.ts";
import {
    PythonAIAssistantResponse,
    PythonDeployJobRequest,
    PythonDeployJobResponse,
    PythonImportFunctionResponse,
    PythonUploadPluginResponse
} from "@/lumilake/types/python.ts";

export const pythonService = {
    submitAIPrompt: async (prompt: string): Promise<string> => {
        const res = await apiService.post<PythonAIAssistantResponse>
        ("/python/ai-assistant",
            { query: prompt }
        );

        return res.answer;
    },
    importFunction: async (file: File): Promise<boolean> => {
        const formData = new FormData();
        formData.append("name", file.name);
        formData.append("version", "1.0.0");
        formData.append("file", file);

        const res = await apiService.upload<PythonImportFunctionResponse>
        ("/python/import-function-model",
            formData
        );

        return res.file_received;
    },
    pythonUploadPlugin: async (pluginFile: File, datasetFile?: File): Promise<PythonUploadPluginResponse> => {
        const formData = new FormData();
        formData.append("name", pluginFile.name);
        formData.append("plugin", pluginFile);
        if (datasetFile) {
            formData.append("dataset", datasetFile);
        }

        const res = await apiService.upload<PythonUploadPluginResponse>
        ("/python/upload",
            formData
        );

        return res;
    },
    submitDeployJob: async (payload: PythonDeployJobRequest): Promise<PythonDeployJobResponse> => {
        return await apiService.post<PythonDeployJobResponse>("/python/deploy", payload);
    }
}
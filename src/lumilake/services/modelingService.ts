import { apiService } from "@/lumilake/services/api.ts";
import { ModelingDeployJobRequest, ModelingDeployResponse, ModelingUploadResponse } from "@/lumilake/types/modeling.ts";

export const modelingService = {
    modelingUploadPlugin: async (pluginFile: File, datasetFile?: File): Promise<ModelingUploadResponse> => {
        const formData = new FormData();
        formData.append("name", pluginFile.name);
        formData.append("plugin", pluginFile);
        if (datasetFile) {
            formData.append("dataset", datasetFile);
        }

        const res = await apiService.upload<ModelingUploadResponse>
        ("/modeling/upload",
            formData
        );

        return res;
    },
    submitDeployJob: async (payload: ModelingDeployJobRequest): Promise<ModelingDeployResponse> => {
        return await apiService.post<ModelingDeployResponse>("/modeling/deploy", payload);
    }
}
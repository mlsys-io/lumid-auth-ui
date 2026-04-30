import apiClient, { ApiError } from './client';
import type {
	CreateFlowMeshJobRequest,
	GetFlowMeshJobListResponse,
	GetFlowMeshJobExecutionsResponse,
	PaginatedResponse,
	PaginationParams,
	DataResponse,
} from './types';

export { ApiError };

export async function getFlowMeshJobList(
	params: PaginationParams
): Promise<PaginatedResponse<GetFlowMeshJobListResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetFlowMeshJobListResponse>>('/api/v1/flowmesh-jobs', {
		params,
	});
	return response.data;
}

export async function createFlowMeshJob(data: CreateFlowMeshJobRequest): Promise<DataResponse<null>> {
	const response = await apiClient.post<DataResponse<null>>('/api/v1/flowmesh-jobs', data);
	return response.data;
}

export async function pauseFlowMeshJob(id: number): Promise<DataResponse<null>> {
	const response = await apiClient.put<DataResponse<null>>(`/api/v1/flowmesh-jobs/${id}/pause`);
	return response.data;
}

export async function resumeFlowMeshJob(id: number): Promise<DataResponse<null>> {
	const response = await apiClient.put<DataResponse<null>>(`/api/v1/flowmesh-jobs/${id}/resume`);
	return response.data;
}

export async function stopFlowMeshJob(id: number): Promise<DataResponse<null>> {
	const response = await apiClient.put<DataResponse<null>>(`/api/v1/flowmesh-jobs/${id}/stop`);
	return response.data;
}

export async function getFlowMeshJobExecutions(
	id: number
): Promise<DataResponse<GetFlowMeshJobExecutionsResponse>> {
	const response = await apiClient.get<DataResponse<GetFlowMeshJobExecutionsResponse>>(
		`/api/v1/flowmesh-jobs/${id}/executions`
	);
	return response.data;
}

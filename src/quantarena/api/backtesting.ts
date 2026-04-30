import apiClient from './client';
import type {
	BacktestingTasksParams,
	CreateBacktestingTaskRequest,
	CreateBacktestingTaskResponse,
	GetBacktestingTasksResponse,
	BacktestingTaskResultData,
	CancelBacktestingTaskResponse,
	PaginatedResponse,
	DataResponse,
} from './types';

/**
 * Get backtesting tasks
 * GET /api/v1/backtesting-tasks
 */
export async function getBacktestingTasks(
	params?: BacktestingTasksParams
): Promise<PaginatedResponse<GetBacktestingTasksResponse>> {
	const response = await apiClient.get<PaginatedResponse<GetBacktestingTasksResponse>>('/api/v1/backtesting-tasks', {
		params: {
			...params,
			status: params?.status?.join(','),
		},
	});
	return response.data;
}

/**
 * Create backtesting task
 * POST /api/v1/backtesting-tasks
 */
export async function createBacktestingTask(
	data: CreateBacktestingTaskRequest
): Promise<CreateBacktestingTaskResponse> {
	const response = await apiClient.post<DataResponse<CreateBacktestingTaskResponse>>(
		'/api/v1/backtesting-tasks',
		data
	);
	return response.data.data;
}

/**
 * Get backtesting task result
 * GET /api/v1/backtesting-tasks/{task_id}
 */
export async function getBacktestingTaskResult(taskId: number): Promise<BacktestingTaskResultData> {
	const response = await apiClient.get<DataResponse<BacktestingTaskResultData>>(
		`/api/v1/backtesting-tasks/${taskId}`
	);
	return response.data.data;
}

/**
 * Cancel backtesting task
 * PUT /api/v1/backtesting-tasks/{task_id}/cancel
 */
export async function cancelBacktestingTask(taskId: number): Promise<CancelBacktestingTaskResponse> {
	const response = await apiClient.put<DataResponse<CancelBacktestingTaskResponse>>(
		`/api/v1/backtesting-tasks/${taskId}/cancel`
	);
	return response.data.data;
}

/**
 * Delete backtesting task
 * DELETE /api/v1/backtesting-tasks/{task_id}
 */
export async function deleteBacktestingTask(taskId: number): Promise<void> {
	await apiClient.delete(`/api/v1/backtesting-tasks/${taskId}`);
}

/**
 * Export backtesting result file
 * GET /api/v1/backtesting-tasks/{task_id}/export
 */
export async function exportBacktestingResult(taskId: number, fileType: 'csv' | 'pdf' | 'json'): Promise<Blob> {
	const response = await apiClient.get(`/api/v1/backtesting-tasks/${taskId}/export`, {
		params: { file_type: fileType },
		responseType: 'blob',
	});
	return response.data;
}

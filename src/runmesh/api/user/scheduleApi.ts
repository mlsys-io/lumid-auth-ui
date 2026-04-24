import { http } from '@/runmesh/utils/axios';

export type ScheduleStatus = 'CREATED' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'STOPPED';

export interface WorkflowScheduleVo {
  scheduleId: number;
  workflowId: string;
  scheduleName: string;
  intervalSeconds: number;
  cronExpression?: string;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  activeDays?: string;
  timezone: string;
  maxDurationSeconds?: number;
  maxExecutions?: number;
  startedAt?: string;
  expiresAt?: string;
  status: ScheduleStatus;
  lastTriggeredAt?: string;
  nextTriggerAt?: string;
  totalExecutions: number;
  totalCost: number;
  createTime: string;
  remark?: string;
  workflowName?: string;
}

export interface ScheduleExecutionVo {
  id: number;
  scheduleId: number;
  userId: number;
  submitId?: string;
  nWorkflowId?: string;
  status: string;
  triggeredAt: string;
  completedAt?: string;
  costAmount: number;
  errorMessage?: string;
}

export interface CreateScheduleParams {
  workflowId: string;
  scheduleName?: string;
  intervalSeconds: number;
  cronExpression?: string;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  activeDays?: string;
  timezone?: string;
  maxDurationSeconds?: number;
  maxExecutions?: number;
  remark?: string;
}

/** Create a new schedule (status=CREATED). */
export const createSchedule = (data: CreateScheduleParams) =>
  http.post<WorkflowScheduleVo>('/runmesh/schedules', data);

/** List current user's schedules (paginated). */
export const getScheduleList = (params?: { pageNum?: number; pageSize?: number }) =>
  http.get<{ rows: WorkflowScheduleVo[]; total: number }>('/runmesh/schedules/list', { params });

/** Get schedule details. */
export const getScheduleDetail = (scheduleId: number) =>
  http.get<WorkflowScheduleVo>(`/runmesh/schedules/${scheduleId}`);

/** Activate a CREATED or PAUSED schedule. */
export const activateSchedule = (scheduleId: number) =>
  http.put<void>(`/runmesh/schedules/${scheduleId}/activate`);

/** Pause an ACTIVE schedule. */
export const pauseSchedule = (scheduleId: number) =>
  http.put<void>(`/runmesh/schedules/${scheduleId}/pause`);

/** Resume a PAUSED schedule. */
export const resumeSchedule = (scheduleId: number) =>
  http.put<void>(`/runmesh/schedules/${scheduleId}/resume`);

/** Stop a schedule permanently. */
export const stopSchedule = (scheduleId: number) =>
  http.put<void>(`/runmesh/schedules/${scheduleId}/stop`);

/** Delete a schedule (must be stopped first). */
export const deleteSchedule = (scheduleId: number) =>
  http.delete<void>(`/runmesh/schedules/${scheduleId}`);

/** Update schedule configuration (only when CREATED or PAUSED). */
export const updateScheduleConfig = (scheduleId: number, data: Partial<CreateScheduleParams>) =>
  http.put<void>(`/runmesh/schedules/${scheduleId}`, data);

/** List execution history for a schedule. */
export const getScheduleExecutions = (
  scheduleId: number,
  params?: { pageNum?: number; pageSize?: number },
) =>
  http.get<{ rows: ScheduleExecutionVo[]; total: number }>(
    `/runmesh/schedules/${scheduleId}/executions`,
    { params },
  );

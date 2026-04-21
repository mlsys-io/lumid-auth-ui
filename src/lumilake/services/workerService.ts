import { apiService } from "@/lumilake/services/api";
import { Worker, GPUInfo } from "@/lumilake/types/worker";

export const WorkerService = {
  getWorkers: async (): Promise<Worker[]> => {
    try {
      
      const res = await apiService.get<any>("workers");
      const rawData = res;
    
      
      const items = Array.isArray(rawData) ? rawData : rawData?.items || [];

      return items.map((w: any): Worker => ({
        id: w.id,
        alias: w.alias,
        namespace: w.namespace,
        cluster: w.cluster,
        guardian_id: w.guardian_id,
        guardian_alias: w.guardian_alias,
        status: (w.status || 'OFFLINE').toUpperCase() as Worker['status'],
        pid: w.pid,
        started_at: w.started_at,
        last_seen: w.last_seen,
        stale: w.stale ?? false,
        hardware: {
          cpu: {
            logical_cores: w.hardware?.cpu?.logical_cores ?? 0,
            model: w.hardware?.cpu?.model ?? "Unknown"
          },
          memory: {
            total_bytes: w.hardware?.memory?.total_bytes ?? 0
          },
          gpu: {
            driver_version: w.hardware?.gpu?.driver_version ?? null,
            cuda_version: w.hardware?.gpu?.cuda_version ?? null,
            gpus: (w.hardware?.gpu?.gpus || []).map((gpu: any): GPUInfo => ({
              index: gpu.index,
              name: gpu.name,
              uuid: gpu.uuid,
              memory_total_bytes: gpu.memory_total_bytes
            }))
          },
          network: {
            ip: w.hardware?.network?.ip ?? null,
            bandwidth_bytes_per_sec: w.hardware?.network?.bandwidth_bytes_per_sec ?? null
          }
        },
        env: w.env || {},
        tags: w.tags || [],
        cached_models: w.cached_models || [],
        cached_datasets: w.cached_datasets || [],
        cache_updated_ts: w.cache_updated_ts || null,
        cost_per_hour: w.cost_per_hour || 0,
        elastic_disabled: w.elastic_disabled ?? true
      }));
    } catch (error) {
      console.error("WorkerService getWorkers error:", error);
      return [];
    }
  },

  rebootWorker: async (workerId: string): Promise<any> => {
    try {
      return await apiService.post(`/api/v1/workers/${workerId}/reboot`);
    } catch (error) {
      console.error(`WorkerService rebootWorker error:`, error);
      throw error;
    }
  }
};
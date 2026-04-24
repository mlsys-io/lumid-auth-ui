export interface GPUInfo {
  index: number;
  name: string;
  uuid: string;
  memory_total_bytes: number;
}

export interface WorkerHardware {
  cpu: {
    logical_cores: number;
    model: string;
  };
  memory: {
    total_bytes: number;
  };
  gpu: {
    driver_version: string | null;
    cuda_version: string | null;
    gpus: GPUInfo[];
  };
  network: {
    ip: string | null;
    bandwidth_bytes_per_sec: number | null;
  };
}

export interface Worker {
  id: string;
  alias: string;
  namespace: string;
  cluster: string;
  guardian_id: string;
  guardian_alias: string;
  status: 'IDLE' | 'BUSY' | 'UNKNOWN' | 'STARTING' | 'OFFLINE';
  pid: number;
  started_at: string;
  last_seen: string;
  stale: boolean;
  hardware: WorkerHardware;
  env: Record<string, any>;
  tags: string[];
  cached_models: any[];
  cached_datasets: any[];
  cache_updated_ts: string | null;
  cost_per_hour: number;
  elastic_disabled: boolean;
}
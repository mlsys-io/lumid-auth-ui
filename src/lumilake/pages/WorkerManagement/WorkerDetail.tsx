import React, { useState, useEffect, useCallback } from 'react';
import Icon from "../../components/ui/Icon";
import { WorkerService } from "@/lumilake/services/workerService";
import { Worker } from "@/lumilake/types/worker";

interface WorkerDetailProps {
  workerId: string;
  onBack: () => void;
}

export const WorkerDetail: React.FC<WorkerDetailProps> = ({ workerId, onBack }) => {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRebooting, setIsRebooting] = useState(false);

  const fetchWorkerDetail = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await WorkerService.getWorkers();
      const found = data.find(w => w.id === workerId);
      setWorker(found || null);
    } catch (error) {
      console.error("Error fetching worker detail:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    fetchWorkerDetail();
  }, [fetchWorkerDetail]);

  const handleReboot = async () => {
    if (!worker || !window.confirm(`Are you sure you want to reboot ${worker.alias}?`)) return;
    
    setIsRebooting(true);
    try {
      await WorkerService.rebootWorker(worker.id);
      alert("Reboot command sent successfully.");
    } catch (_error) {
      alert("Failed to send reboot command.");
    } finally {
      setIsRebooting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading worker specifications...</div>;
  if (!worker) return <div className="p-10 text-center text-red-500">Worker not found.</div>;

  return (
    <div className="max-w-8xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-blue ml-2">Worker Detail</h1>
        <button
            type="button"
            onClick={(e) => {
                    e.preventDefault();
                    onBack();
                }}
            className="flex items-center text-blue-500 hover:text-blue-200 text-xl mb-8 ml-4"
            >
            <span>← </span>
            Back
            </button>
        <div className="p-6 bg-gray-50 min-h-full rounded-lg">
        {/* Header Navigation */}
        
        <div className="mx-auto mb-6 flex items-center justify-end gap-4">
            
            <div className="flex gap-3">
            <button 
                onClick={handleReboot}
                disabled={isRebooting}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-red-600 text-red-600 rounded-lg text-xl font-bold hover:bg-red-50 transition-colors disabled:opacity-50"
            >
                
                Reboot Node
            </button>
            </div>
        </div>

        <div className="max-w-8xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: Essential Info & Status */}
            <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-blue rounded-xl flex items-center justify-center text-blue-600">
                    <Icon name="user" className="w-6 h-6" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-800">{worker.id}</h2>
                    <p className="text-xs font-mono text-gray-400">{worker.alias}</p>
                </div>
                </div>

                <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-xs font-bold text-gray-400 uppercase">Status</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${worker.status === 'IDLE' ?  'bg-orange-100 text-orange-700' : worker.status === 'BUSY' ? 'bg-red-100 text-red-700' : worker.status === 'UNKNOWN' ? 'bg-gray-100 text-gray-700' : worker.status === 'STARTING' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                    {worker.status}
                    </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-xs font-bold text-gray-400 uppercase">Namespace</span>
                    <span className="text-sm font-semibold text-gray-700">{worker.namespace}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-xs font-bold text-gray-400 uppercase">Cluster</span>
                    <span className="text-sm font-semibold text-gray-700">{worker.cluster}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-xs font-bold text-gray-400 uppercase">Cost / Hour</span>
                    <span className="text-sm font-bold text-blue-600 font-mono">${worker.cost_per_hour.toFixed(2)}</span>
                </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Icon name="shield-check" className="w-4 h-4 text-gray-400" />
                Guardian Details
                </h3>
                <div className="space-y-3">
                <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Alias</label>
                    <p className="text-sm font-medium text-gray-700">{worker.guardian_alias}</p>
                </div>
                <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Guardian ID</label>
                    <p className="text-xs font-mono text-gray-500">{worker.guardian_id}</p>
                </div>
                </div>
            </div>
            </div>

            {/* Right Column: Hardware & Technical Specs */}
            <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-4 uppercase tracking-wider">Processing & RAM</h3>
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-50 rounded-lg text-gray-400 font-mono text-xs">CPU</div>
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-700">{worker.hardware.cpu.model}</span>
                        <span className="text-xs text-gray-400">{worker.hardware.cpu.logical_cores} Logical Cores</span>
                    </div>
                    </div>
                    <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-50 rounded-lg text-gray-400 font-mono text-xs">MEM</div>
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-700">{formatBytes(worker.hardware.memory.total_bytes)}</span>
                        <span className="text-xs text-gray-400">System RAM Total</span>
                    </div>
                    </div>
                </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-4 uppercase tracking-wider">Network</h3>
                <div className="space-y-4">
                    <div className="flex flex-col">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Local IP</label>
                    <span className="text-sm font-mono font-bold text-gray-700">{worker.hardware.network.ip || "N/A"}</span>
                    </div>
                    <div className="flex flex-col">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Elastic Scaling</label>
                    <span className={`text-xs font-bold ${!worker.elastic_disabled ? 'text-green-600' : 'text-gray-400'}`}>
                        {!worker.elastic_disabled ? "Enabled" : "Disabled"}
                    </span>
                    </div>
                </div>
                </div>
            </div>

            {/* GPU Details */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Graphics Acceleration</h3>
                {worker.hardware.gpu.driver_version && (
                    <span className="text-[10px] bg-green-50 text-green-600 px-2 py-1 rounded font-bold border border-green-500">
                    DRIVER: {worker.hardware.gpu.driver_version}
                    </span>
                )}
                </div>

                {worker.hardware.gpu.gpus.length > 0 ? (
                <div className="space-y-4">
                    {worker.hardware.gpu.gpus.map((gpu) => (
                    <div key={gpu.uuid} className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                        <div className="p-3 bg-white rounded-lg shadow-sm">
                            <Icon name="box" className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-800">{gpu.name}</p>
                            <p className="text-[10px] font-mono text-gray-400 uppercase">{gpu.uuid}</p>
                        </div>
                        </div>
                        <div className="text-right">
                        <p className="text-sm font-bold text-gray-700">{formatBytes(gpu.memory_total_bytes)}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">VRAM</p>
                        </div>
                    </div>
                    ))}
                </div>
                ) : (
                <div className="py-8 text-center text-gray-400 text-sm italic bg-gray-50 rounded-xl">
                    No discrete GPU units detected on this worker.
                </div>
                )}
            </div>

            <div className="flex flex-wrap gap-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">
                <span>Started: {new Date(worker.started_at).toLocaleString()}</span>
                <span>•</span>
                <span>Last Seen: {new Date(worker.last_seen).toLocaleString()}</span>
                <span>•</span>
                <span>PID: {worker.pid}</span>
            </div>
            </div>
      </div>
    </div>
    </div>
  );
};
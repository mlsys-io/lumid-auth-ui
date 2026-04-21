import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from "../../components/ui/Icon";
import { WorkerService } from "@/lumilake/services/workerService";
import { Worker } from "@/lumilake/types/worker";
import { WorkerDetail } from "./WorkerDetail";

interface GroupedWorkers {
  [namespace: string]: {
    [clusterName: string]: {
      [guardianAlias: string]: Worker[];
    };
  };
}

export const WorkerManagement: React.FC = () => {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedNamespaces, setExpandedNamespaces] = useState<string[]>([]);
  const [expandedClusters, setExpandedClusters] = useState<string[]>([]);
  
  // NEW: State to track which specific workers have their configuration expanded
  const [expandedConfigs, setExpandedConfigs] = useState<string[]>([]);
  
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
  const [searchNamespace, setSearchNamespace] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchWorkers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await WorkerService.getWorkers();
      setWorkers(data);
      if (data.length > 0) {
        setExpandedNamespaces([data[0].namespace]);
      }
    } catch (error) {
      console.error("Failed to load workers:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
  }, [fetchWorkers]);

  const groupedData = useMemo(() => {
    const grouped: GroupedWorkers = {};
    workers
      .filter(worker => {
        const matchesNamespace = worker.namespace?.toLowerCase().includes(searchNamespace.toLowerCase());
        const matchesStatus = statusFilter === "" || worker.status === statusFilter;
        return matchesNamespace && matchesStatus;
      })
      .forEach(worker => {
        const ns = worker.namespace || "Default";
        const cluster = worker.cluster || "Default Cluster";
        const guardian = worker.guardian_alias || "Guardian";
        if (!grouped[ns]) grouped[ns] = {};
        if (!grouped[ns][cluster]) grouped[ns][cluster] = {};
        if (!grouped[ns][cluster][guardian]) grouped[ns][cluster][guardian] = [];
        grouped[ns][cluster][guardian].push(worker);
      });
    return grouped;
  }, [workers, searchNamespace, statusFilter]);

  const toggleNamespace = (ns: string) => {
    setExpandedNamespaces(prev => prev.includes(ns) ? prev.filter(i => i !== ns) : [...prev, ns]);
  };

  const toggleCluster = (namespace: string, clusterName: string) => {
    const key = `${namespace}-${clusterName}`;
    setExpandedClusters(prev => prev.includes(key) ? prev.filter(i => i !== key) : [...prev, key]);
  };

  // NEW: Toggle function for the Configuration column
  const toggleConfig = (workerId: string) => {
    setExpandedConfigs(prev => 
      prev.includes(workerId) ? prev.filter(id => id !== workerId) : [...prev, workerId]
    );
  };

  const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
  

  if (selectedWorkerId) {
    return <WorkerDetail workerId={selectedWorkerId} onBack={() => setSelectedWorkerId("")} />;
  }

  return (
    <div className="p-6 bg-white min-h-full border rounded-lg">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-4">
        <h1 className="rounded-lg text-3xl font-bold text-[#344293]">Worker Management</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by Namespace..."
              value={searchNamespace}
              onChange={(e) => setSearchNamespace(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-blue-400 mr-2"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <Icon name="search" className="h-4 w-4 text-gray-400 mr-2" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Filter by:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-md bg-white px-2 py-1 text-sm hover:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">STATUS</option>
              <option value="IDLE">IDLE</option>
              <option value="BUSY">BUSY</option>
              <option value="STARTING">STARTING</option>
              <option value="UNKNOWN">UNKNOWN</option>
              <option value="OFFLINE">OFFLINE</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {Object.entries(groupedData).map(([namespace, clusters]) => (
          <div key={namespace} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="p-6 flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors bg-white" onClick={() => toggleNamespace(namespace)}>
              <div className="flex flex-col items-center gap-1">
                <h2 className="text-2xl font-bold text-gray-800 uppercase tracking-tight mr-1">{namespace}</h2>
                <span className="text-sm text-gray-500 font-bold">{Object.keys(clusters).length} Cluster</span>
              </div>
              <Icon name={expandedNamespaces.includes(namespace) ? "cheveron-down" : "cheveron-right"} className={`w-4 h-4 transition-transform ${expandedNamespaces.includes(namespace) ? "text-[#344293]" : "text-gray-400"}`} />
            </div>

            {expandedNamespaces.includes(namespace) && (
              <div className="px-4 pb-4">
                <div className="space-y-4">
                  {Object.entries(clusters).map(([clusterName, guardians]) => {
                    const clusterKey = `${namespace}-${clusterName}`;
                    const isClusterExpanded = expandedClusters.includes(clusterKey);
                    return (
                      <div key={clusterName} className="border-l-2 border rounded-lg border-gray-200 bg-gray-50 p-4 transition-colors">
                        <div className="flex items-center gap-2 cursor-pointer group justify-between ml-2 mt-2 rounded-md transition-colors" onClick={() => toggleCluster(namespace, clusterName)}>
                          <div className="flex flex-col align-items-center gap-1">
                            <h3 className="text-xl font-bold text-gray-800 uppercase tracking-widest group-hover:text-gray-900">{clusterName}</h3>
                            <span className="text-[10px] text-gray-500 font-bold">{Object.keys(guardians).join(', ')}</span>
                          </div>
                          <Icon name={isClusterExpanded ? "cheveron-down" : "cheveron-right"} className={`w-3 h-3 transition-colors ${isClusterExpanded ? "text-blue-500" : "text-gray-400 group-hover:text-blue-500"}`} />
                        </div>
                        
                        {isClusterExpanded && (
                          <div className="space-y-4 border-gray-300 pb-4 mt-2 rounded-lg">
                            {Object.entries(guardians).map(([guardianName, guardianWorkers]) => (
                              <div key={guardianName} className="rounded-md">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-gray-50 border-b border-gray-300 text-gray-600 uppercase text-xs tracking-wide">
                                    <tr>
                                      <th className="px-4 py-2 text-left w-[20%] font-semibold">Node Details </th>
                                      <th className="px-4 py-2 text-left w-[15%] font-semibold">Guardian </th>
                                      <th className="px-4 py-2 text-left w-[15%] font-semibold">Host IP </th>
                                      <th className="px-4 py-2 text-left w-[35%] font-semibold">Configuration </th>
                                      <th className="px-4 py-2 text-left w-[10%] font-semibold">Status</th>
                                      <th className="px-4 py-2 text-center w-[5%] font-semibold">Info</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 bg-white">
                                    {guardianWorkers.map(worker => (
                                      <tr key={worker.id} className="hover:bg-blue-50/20 transition-colors border-b border-gray-50">
                                        {/* NODE DETAILS */}
                                        <td className="px-4 py-4">
                                          <div className="font-bold text-gray-800">{worker.alias}</div>
                                          <div className="text-[10px] text-gray-400">{worker.id}</div>
                                        </td>
                                        
                                        {/* GUARDIAN */}
                                        <td className="px-4 py-4 text-gray-600">{worker.guardian_alias}</td>

                                        {/* HOST IP */}
                                        <td className="px-4 py-4 text-gray-600 font-mono text-xs">{worker.hardware.network.ip || "—"}</td>

                                        {/* CONFIGURATION (Hardware - FIXED COLUMN) */}
                                        <td className="px-4 py-4 align-top">
                                          <div className="flex justify-between items-start group/config">
                                            <div className="flex-1">
                                              <div className="text-gray-800 font-semibold text-sm">
                                                {worker.hardware.gpu.gpus.length > 0 
                                                  ? `${worker.hardware.gpu.gpus[0].name} × ${worker.hardware.gpu.gpus.length}` 
                                                  : "CPU Only"}
                                              </div>
                                              
                                              {expandedConfigs.includes(worker.id) ? (
                                                <div className="mt-2 space-y-1 text-[11px] text-gray-500 leading-relaxed">
                                                  <div><span className="font-bold">GPU memory:</span> {worker.hardware.memory.total_bytes ? `${Math.round(worker.hardware.memory.total_bytes / 1024)}GB` : '—'} | CUDA : {worker.hardware.gpu.cuda_version || "-"} | {worker.hardware.gpu.driver_version || "—"}</div>
                                                  <div><span className="font-bold">CPU:</span> {worker.hardware.cpu.logical_cores} cores </div>
                                                  <div><span className="font-bold">Memory:</span> {formatBytes(worker.hardware.memory.total_bytes)}</div>
                                                </div>
                                              ) : (
                                                <button 
                                                  onClick={() => toggleConfig(worker.id)}
                                                  className="text-[11px] text-gray-400 hover:text-gray-600 underline decoration-dotted mt-1"
                                                >
                                                  See detailed information
                                                </button>
                                              )}
                                            </div>
                                            <button 
                                              onClick={() => toggleConfig(worker.id)}
                                              className="p-1 text-gray-400 hover:text-gray-700 mt-0.5"
                                            >
                                              <Icon 
                                                name={expandedConfigs.includes(worker.id) ? "cheveron-up" : "cheveron-down"} 
                                                className="w-4 h-4" 
                                              />
                                            </button>
                                          </div>
                                        </td>

                                        {/* STATUS */}
                                        <td className="px-4 py-4">
                                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${
                                            worker.status === "IDLE" ? "bg-orange-50 text-orange-400 border-orange-100" :
                                            worker.status === "BUSY" ? "bg-red-50 text-red-500 border-red-100" :
                                            "bg-gray-100 text-gray-500 border-gray-200"
                                          }`}>
                                            {worker.status}
                                          </span>
                                        </td>

                                        {/* INFO */}
                                        <td className="px-4 py-4 text-center">
                                          <button onClick={() => setSelectedWorkerId(worker.id)} className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-500">
                                            <Icon name="file-alt" className="w-4 h-4" />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
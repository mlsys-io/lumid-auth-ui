import React, { useState, useEffect, useCallback } from "react";
import Icon from "../../components/ui/Icon";
import { JobDetail } from "./JobDetail";
import {
  RunningJobService,
  RunningJobFilter,
} from "@/lumilake/services/runningJobService.ts";
import {
  JOB_STATUSES,
  RunningJob,
} from "@/lumilake/types/jobs.ts";
import ConfirmModal from "@/lumilake/components/ui/ConfirmModal.tsx";

type SortField = "id" | "status" | "started_at";
type SortDirection = "asc" | "desc";

export const RunningJobs: React.FC = () => {
  // --- States ---
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("started_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectDeletedJobId, setDeleteJobId] = useState<string>("");
  const [isOpenConfirmModal, setIsOpenConfirmModal] = useState(false);
  
  const [jobs, setJobs] = useState<RunningJob[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPage, setTotalPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  const itemsPerPage = 10;
  const jobStatuses = Object.values(JOB_STATUSES);

  // --- Search Debounce ---
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(searchTerm), 500);
    return () => clearTimeout(handler);
  }, [searchTerm]);

 
const fetchJobs = useCallback(async () => {
  setIsLoading(true);
  
  
  const filter: RunningJobFilter = {
    page: currentPage,
    pageSize: itemsPerPage,
    status: statusFilter === "" ? undefined : (statusFilter as JOB_STATUSES),
    search: debouncedSearch === "" ? undefined : debouncedSearch, 
  };

  try {
    const res = await RunningJobService.getRunningJobs(filter);
    
    
    let filteredItems = res.items;
    if (debouncedSearch) {
      filteredItems = res.items.filter(job => 
        job.id.toLowerCase().includes(debouncedSearch.toLowerCase())
      );
    }

  
    const sortedItems = [...filteredItems].sort((a, b) => {
      const valA = a[sortField] || "";
      const valB = b[sortField] || "";
      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    setJobs(sortedItems);
    setTotalPage(res.total_page);
  } catch (error) {
    console.error("Error fetching jobs:", error);
  } finally {
    setIsLoading(false);
  }
}, [currentPage, debouncedSearch, statusFilter, sortField, sortDirection]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // --- Handlers ---
  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc"); // Default to newest/highest first
    }
  };

  const openConfirmKillModal = (jobId: string) => {
    setDeleteJobId(jobId);
    setIsOpenConfirmModal(true);
  };

  const confirmKillJob = async () => {
    try {
      await RunningJobService.requestKillJob(selectDeletedJobId);
      
      await fetchJobs(); 
      setIsOpenConfirmModal(false);
      setDeleteJobId("");
    } catch (error) {
      console.error("Error killing job:", error);
    }
  };

  // --- Helpers ---
  const getStatusBadge = (status: JOB_STATUSES) => {
    const base = "inline-flex items-center justify-center min-w-[100px] h-7 px-2 rounded-md text-xs font-medium border whitespace-nowrap";
    switch (status) {
      case "pending": return `${base} bg-gray-100 text-gray-600 border-gray-400`;
      case "running": return `${base} bg-yellow-100 text-yellow-700 border-yellow-400 animate-pulse`;
      case "cancelled": return `${base} bg-purple-100 text-purple-700 border-purple-400`;
      case "failed": return `${base} bg-red-100 text-red-700 border-red-400`;
      case "completed": return `${base} bg-green-100 text-green-700 border-green-400`;
      default: return `${base} bg-gray-50 text-gray-500 border-gray-200`;
    }
  };

  if (selectedJobId) {
    return <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId("")} />;
  }

  return (
    <div className="p-6 bg-white rounded-lg min-h-full">
      <div className="max-w-10xl mx-auto">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-4">
          <h1 className="text-3xl font-bold text-blue">Running Jobs</h1>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search by ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-3 pr-10 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 w-64"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <Icon name="search" className="h-4 w-4 text-gray-400" />
              </div>
            </div>

            <span className="text-sm font-semibold text-gray-500">Sort by:</span>
            <select
              value={sortField}
              onChange={(e) => handleSortChange(e.target.value as SortField)}
              className="bg-white border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="started_at">Execution Time</option>
              <option value="id">Job ID</option>
              <option value="status">Status</option>
            </select>

            <span className="text-sm font-semibold text-gray-500 ml-2">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="bg-white border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              {jobStatuses.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          </div>
        </div>

        {/* Table Section */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Name / ID</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Execution Time</th>
                <th className="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={4} className="py-20 text-center text-gray-400">Loading jobs...</td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={4} className="py-20 text-center text-gray-400">No jobs found matching your criteria.</td></tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => setSelectedJobId(job.id)}
                        className="text-sm font-medium text-blue-600 hover:underline text-left"
                      >
                        {job.id}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span className={getStatusBadge(job.status)}>{job.status}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {job.started_at ? new Date(job.started_at).toLocaleString() : "---"}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {(job.status === "running" || job.status === "pending") ? (
                        <button
                          className="px-4 py-1.5 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 active:scale-95 transition-all shadow-sm"
                          onClick={() => openConfirmKillModal(job.id)}
                        >
                          CANCEL
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 font-medium uppercase"></span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-center">
             <div className="flex gap-1">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-white"
                >
                  Prev
                </button>
                <span className="px-4 py-1 text-sm font-medium">Page {currentPage} of {totalPage || 1}</span>
                <button 
                  disabled={currentPage >= totalPage}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-white"
                >
                  Next
                </button>
             </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={isOpenConfirmModal}
        title="Terminate Job?"
        message={`Are you sure you want to stop job ${selectDeletedJobId}? This will stop all current processing immediately.`}
        onConfirm={confirmKillJob}
        onCancel={() => setIsOpenConfirmModal(false)}
      />
    </div>
  );
};
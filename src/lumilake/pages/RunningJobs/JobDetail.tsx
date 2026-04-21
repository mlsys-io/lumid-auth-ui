import React, { useEffect, useState, useCallback } from "react";
import Icon from "../../components/ui/Icon";
import { RunningJobService } from "@/lumilake/services/runningJobService";
import { JOB_STATUSES, RunningJob, BatchProgressNodes, JobProgressOutputDetails, JobProgressBatchProgressDetails, JobResultData } from "@/lumilake/types/jobs";
import ConfirmModal from "@/lumilake/components/ui/ConfirmModal.tsx";
import ScatterPreviewChart from "@/lumilake/components/ui/ScatterPreviewChart";

interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}


export const JobDetail: React.FC<JobDetailProps> = ({ jobId, onBack }) => {
  const [job, setJob] = useState<RunningJob | null>(null);
  const [jobResults, setJobResults] = useState<JobResultData | null>(null);
  const [newJobResultsWithImage, setNewJobResultsWithImage] = useState<JobResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [selectDeletedJobId, setDeleteJobId] = useState<string>("");
  const [isOpenConfirmModal, setIsOpenConfirmModal] = useState(false);
  const [nodeStats, setNodeStats] = useState<BatchProgressNodes | JobProgressOutputDetails | JobProgressBatchProgressDetails |null > (null);


  const getProgressUpdate = async (jobId: string) => {
    const progressRes = await RunningJobService.getJobProgress(jobId);
    const overall = progressRes?.data?.progress?.batch_progress?.overall_progress;
    const overallOutputDetails = progressRes?.data?.progress?.batch_progress?.batches?.[0]?.nodes || progressRes?.data?.progress?.outputs?.details || null;

    setProgress(overall?.percentage ?? 0);
    setNodeStats(overallOutputDetails ?? null);
  }

  

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const jobDetail = await RunningJobService.getJobDetail(jobId);
        setJob(jobDetail);
        getProgressUpdate(jobId);
        const jobResults = await RunningJobService.getJobResult(jobId);
        setJobResults(jobResults?.data || null);
      } catch (error) {
        console.error("Error fetching job details:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [jobId]);

  useEffect(() => {
    if (job?.status !== "running") return;

    const interval = setInterval(async () => {
      getProgressUpdate(jobId);
    }, 5000);

    return () => clearInterval(interval);
  }, [job?.status, jobId]);

  const handleDownload = async (s3Path: string) => {
    if (!job || !s3Path) return;

    try {
      const blob = await RunningJobService.downloadJobArtifact(job.id, s3Path);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const fileName = s3Path.split("/").pop() || `artifact_${jobId}`;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const getAllArtifactPaths = (job: JobResultData | null): string[] => {
  if (!job?.result?.outputs) return [];
  const paths: string[] = [];

  Object.values(job.result.outputs).forEach((node) => {
    Object.values(node).forEach((vals) => {
      vals.forEach((v) => {
        if (v.startsWith("s3://")) paths.push(v);
      });
    });
  });
  return paths;
};

  const openConfirmKillModal = (id: string) => {
    setDeleteJobId(id);
    setIsOpenConfirmModal(true);
  };

  const confirmKillJob = async () => {
    try {
      await RunningJobService.requestKillJob(selectDeletedJobId);
      setIsOpenConfirmModal(false);
      onBack();
    } catch (error) {
      console.error("Error killing job:", error);
    }
  };

  const getDisplayProgress = () => {
    if (!job) return 0;
    if (job.status === "completed") return 100;
    return progress ?? 0;
  };

  const getProgressMeta = () => {
    if (!job) return { label: "", color: "bg-blue-500" };
    switch (job.status) {
      case "completed": return { label: "Completed", color: "bg-green-500" };
      // Rounding the label percentage
      case "running": return { label: `${Math.round(progress ?? 0)}% Running`, color: "bg-blue-500" };
      case "failed": return { label: "Failed ✕", color: "bg-red-500" };
      case "cancelled": return { label: "Cancelled", color: "bg-purple-500" };
      default: return { label: "Pending...", color: "bg-gray-400" };
    }
  };

  const getStatusBadge = (status: JOB_STATUSES) => {
    const base = "inline-flex items-center px-3 py-1 rounded-md text-sm font-medium border";
    switch (status) {
      case "pending": return `${base} bg-gray-100 text-gray-800 border-gray-300`;
      case "running": return `${base} bg-yellow-100 text-yellow-700 border-yellow-400`;
      case "failed": return `${base} bg-red-100 text-red-700 border-red-300`;
      case "completed": return `${base} bg-green-100 text-green-700 border-green-300`;
      case "cancelled": return `${base} bg-purple-100 text-purple-700 border-purple-300`;
      default: return `${base} bg-gray-50 text-gray-500 border-gray-200`;
    }
  };

  const convertS3ToHttp = useCallback(async (s3Path: string) => {
    if (!job || !s3Path) return;

    try {
      const blob = await RunningJobService.downloadJobArtifact(job.id, s3Path);
      const url = window.URL.createObjectURL(blob);
      return url.toString();
    } catch {
      return '';
    }
  }, [job]);

 useEffect(() => {
    if (!jobResults || !job) return;

    const loadImages = async () => {
      const newOutputs: any = {};

      for (const [nodeTitle, nodeData] of Object.entries(jobResults.result.outputs)) {
        const nodeCopy: any = { ...nodeData };
        nodeCopy.newImage = [];

        for (const [, values] of Object.entries(nodeData as object)) {
          for (const val of values as string[]) {
            if (val.startsWith("s3://")) {
              const img = await convertS3ToHttp(val);
              nodeCopy.newImage.push(img);
            }
          }
        }

        newOutputs[nodeTitle] = nodeCopy;
      }

      setNewJobResultsWithImage({
        ...jobResults,
        result: {
          ...jobResults.result,
          outputs: newOutputs,
        },
      });
    };

    loadImages();
  }, [jobResults, job, convertS3ToHttp]);
  
  if (loading) return <div className="p-8 text-center text-gray-500">Loading job details...</div>;
  
  return (
    <div className="max-w-8xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-2 px-2">
        <h1 className="text-xl font-bold text-[#344293]">Job Detail</h1>
        <button
          onClick={() => openConfirmKillModal(jobId)}
          disabled={["completed", "failed", "cancelled"].includes(job?.status || "")}
          className={`px-4 py-2 rounded-md font-semibold border transition-all ${
            job?.status === "pending" || job?.status === "running"
              ? "bg-white border-[#344293] text-[#344293] hover:bg-[#344293] hover:text-white"
              : "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed"
          }`}
        >
          Cancel Job
        </button>
      </div>

      <div className="mb-6 px-2">
        <button onClick={onBack} className="flex items-center text-blue-500 hover:text-blue-700 text-lg">
          <span className="mr-1">←</span> Back
        </button>
      </div>

      {/* Main Info Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-8 mb-6 shadow-sm">
        <h2 className="text-2xl font-bold text-[#344293] mb-6">{job?.id}</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          <div>
            <h3 className="font-bold text-gray-800 text-lg mb-2">Status</h3>
            {job?.status && <span className={getStatusBadge(job.status)}>{job.status}</span>}
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-lg mb-2">Started At</h3>
            <p className="text-gray-600">
              {job?.started_at ? new Date(job.started_at).toLocaleString() : "-"}
            </p>
          </div>
        </div>

        {/* Progress Section */}
        {job && (
          <div className="mt-6">
            <h3 className="text-lg font-bold mb-4 text-[#344293]">Job Progress</h3>
            <div className="flex items-center gap-6">
              <div className="flex-grow bg-gray-100 rounded-full h-4 overflow-hidden flex border border-gray-200">
               <div
                  className={`h-full transition-all duration-500 ${getProgressMeta().color}`}
                  
                  style={{ width: `${(getDisplayProgress().toFixed(2))}%` }} 
                />
              </div>
              <div className="text-right min-w-[80px]">
                
                <span className="text-xl font-black text-gray-800 block">
                  {(getDisplayProgress().toFixed(2))}%
                </span>
                <span
                      className={`text-[10px] uppercase font-bold ${
                        job?.status === "completed"
                          ? "text-green-800"
                          : job?.status === "running"
                          ? "text-yellow-500"
                          : job?.status === "failed"
                          ? "text-red-500"
                          : job?.status === "cancelled"
                          ? "text-purple-500"
                          : "text-gray-400"
                      }`}
                    >
                      {job?.status === "completed"
                        ? "Completed"
                        : job?.status === "running"
                        ? "Running"
                        : job?.status === "failed"
                        ? "Failed"
                        : job?.status === "cancelled"
                        ? "Cancelled"
                        : ""}
                    </span>
              </div>
            </div>
          </div>
        )}

        {/* Node Stats Table */}
        {nodeStats && (
          <div className="mt-10 pt-6">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-2 border-b">Completed</p>
                <p className="text-lg font-bold text-green-600">✓ {nodeStats.succeeded}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-2 border-b">Failed</p>
                <p className="text-lg font-bold text-red-600">✕ {nodeStats.failed}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-2 border-b">Dispatched</p>
                <p className="text-lg font-bold text-orange-500">⚠️ {nodeStats.dispatched}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-2 border-b">Pending</p>
                <p className="text-lg font-bold text-blue-400">ⓘ {nodeStats.pending}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Result Section */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-bold text-blue">Result</h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  const artifacts = getAllArtifactPaths(jobResults);

                  if (artifacts.length === 0) {
                    alert("No artifact available to download.");
                    return;
                  }

                  handleDownload(artifacts[0]);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-blue text-white border border-blue rounded-md text-sm font-semibold hover:bg-gray-100 hover:text-blue transition-colors"
              >
                <Icon name="download" className="w-4 h-4" />
                Download
              </button>
              <Icon name="expand-alt" className="w-5 h-5 text-gray-400 cursor-pointer hover:text-gray-600" />
            </div>
          </div>

          <div className="p-6">
            <div className="mb-6">
              <ScatterPreviewChart />
            </div>
            {newJobResultsWithImage?.result?.outputs ? (
              Object.entries(newJobResultsWithImage.result.outputs).map(([nodeName, nodeData]) => (
                <div key={nodeName} className="border rounded-lg p-6 mb-6 bg-gray-50">
                  <h3 className="text-lg font-bold text-[#344293] mb-4">{nodeName}</h3>
                  {Object.entries(nodeData as object).map(([key, values]) => (
                    <div key={key} className="mb-4">
                      
                      {(values as string[]).map((val, idx) => (
                       
                          <div key={idx} className="mb-4">
                            {val.startsWith("s3://") ? (
                              <div className={`space-y-2 ${nodeName}`}>
                                <img
                                  src={newJobResultsWithImage.result.outputs?.[nodeName]?.newImage?.[idx] || ""}
                                  alt="Output"
                                  className="max-w-md rounded-lg border shadow-sm"
                                />
                              </div>
                            ) : (
                              <p className="bg-white p-3 rounded border text-gray-800 text-sm">{val}</p>
                            )}
                          </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="text-center py-10 text-gray-400 font-medium">No results available.</div>
            )}
          </div>
        </div>

      <ConfirmModal
        isOpen={isOpenConfirmModal}
        title="Terminate Job?"
        message={`Are you sure you want to stop job ${jobId}?`}
        onConfirm={confirmKillJob}
        onCancel={() => setIsOpenConfirmModal(false)}
      />
    </div>
  );
};
import { useState, useEffect } from 'react';
import { usePagination } from '../../hooks/usePagination';
import type { FlowMeshJobItem } from '../../api/types';
import {
	getFlowMeshJobList,
	pauseFlowMeshJob,
	resumeFlowMeshJob,
	stopFlowMeshJob,
	ApiError,
} from '../../api';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Plus, RefreshCw, Pause, Play, Square, History, Zap, Clock, Activity, Trophy, Target } from 'lucide-react';
import { Loading } from '../../components/ui/loading';
import { formatDateTime } from '../../lib/utils';
import { AdminManageLink } from '../../components/admin-manage-link';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Pagination } from '../../components/ui/pagination';
import { CreateJobDialog } from './create-job-dialog';
import { ExecutionHistoryDialog } from './execution-history-dialog';

const statusConfig: Record<string, { color: string; dotColor: string; label: string }> = {
	Active: { color: 'bg-green-50 text-green-700 border-green-200', dotColor: 'bg-green-500', label: 'Running' },
	Paused: { color: 'bg-amber-50 text-amber-700 border-amber-200', dotColor: 'bg-amber-500', label: 'Paused' },
	Stopped: { color: 'bg-gray-50 text-gray-500 border-gray-200', dotColor: 'bg-gray-400', label: 'Stopped' },
};

/** Turn cron expression into human-readable text */
function cronToHuman(cron: string): string {
	const parts = cron.split(' ');
	if (parts.length !== 5) return cron;
	const [min, hour, , , dow] = parts;

	if (min.startsWith('*/')) {
		const n = parseInt(min.slice(2));
		if (n === 1) return 'Every minute';
		return `Every ${n} min`;
	}
	if (hour.startsWith('*/')) {
		return `Every ${parseInt(hour.slice(2))}h`;
	}
	if (min === '0' && hour === '*') return 'Every hour';
	if (min !== '*' && hour !== '*' && dow === '1-5') return `Weekdays ${hour}:${min.padStart(2, '0')}`;
	if (min !== '*' && hour !== '*' && dow === '*') return `Daily ${hour}:${min.padStart(2, '0')}`;
	return cron;
}

const FlowMeshJobs = () => {
	const [jobList, setJobList] = useState<FlowMeshJobItem[]>([]);
	const [refresh, setRefresh] = useState(Date.now());
	const [loading, setLoading] = useState(false);
	const pagination = usePagination({});
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [executionHistoryJob, setExecutionHistoryJob] = useState<{ id: number; name: string } | null>(null);

	useEffect(() => {
		fetchJobList();
	}, [refresh, pagination.currentPage]);

	const fetchJobList = async () => {
		try {
			setLoading(true);
			const res = await getFlowMeshJobList({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setJobList(res.data.jobs || []);
			pagination.setTotal(res.total);
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : 'Failed to load jobs');
		} finally {
			setLoading(false);
		}
	};

	const handlePause = async (id: number) => {
		try {
			await pauseFlowMeshJob(id);
			toast.success('Job paused');
			setRefresh(Date.now());
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : 'Failed to pause');
		}
	};

	const handleResume = async (id: number) => {
		try {
			await resumeFlowMeshJob(id);
			toast.success('Job resumed');
			setRefresh(Date.now());
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : 'Failed to resume');
		}
	};

	const handleStop = async (id: number) => {
		try {
			await stopFlowMeshJob(id);
			toast.success('Job stopped');
			setRefresh(Date.now());
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : 'Failed to stop');
		}
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Automated Jobs</h1>
					<p className="text-sm text-muted-foreground">Schedule trading bots and AI workflows to run automatically</p>
				</div>
				<div className="flex items-center gap-3">
					<AdminManageLink to="/dashboard/admin/flowmesh-jobs" />
					<Button variant="outline" size="sm" className="gap-2 cursor-pointer" onClick={() => setRefresh(Date.now())} disabled={loading}>
						<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
					</Button>
					<Button onClick={() => setCreateDialogOpen(true)} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						New Job
					</Button>
				</div>
			</div>

			{loading && jobList.length === 0 && <Loading text="Loading jobs..." />}

			{/* Empty state */}
			{!loading && jobList.length === 0 && (
				<div className="flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-xl">
					<div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-5">
						<Zap className="w-8 h-8 text-indigo-500" />
					</div>
					<h3 className="text-lg font-semibold mb-2">No automated jobs yet</h3>
					<p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
						Create a trading bot that buys or sells automatically on a schedule,
						or deploy a custom AI workflow.
					</p>
					<Button onClick={() => setCreateDialogOpen(true)} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						Create Your First Job
					</Button>
				</div>
			)}

			{/* Job cards */}
			{jobList.length > 0 && (
				<div className="space-y-3">
					{jobList.map((job) => {
						const cfg = statusConfig[job.status] || statusConfig.Stopped;
						return (
							<Card key={job.id} className={cn('transition-all hover:shadow-md', job.status === 'Stopped' && 'opacity-60')}>
								<CardContent className="p-4">
									<div className="flex items-start justify-between gap-4">
										{/* Left: info */}
										<div className="flex-1 min-w-0 space-y-2">
											<div className="flex items-center gap-2.5">
												<h3 className="font-semibold text-base truncate">{job.name}</h3>
												<Badge className={cn('gap-1.5 shrink-0', cfg.color)}>
													<span className={cn('w-1.5 h-1.5 rounded-full', cfg.dotColor, job.status === 'Active' && 'animate-pulse')} />
													{cfg.label}
												</Badge>
											</div>
											{job.description && (
												<p className="text-sm text-muted-foreground truncate">{job.description}</p>
											)}
											<div className="flex items-center gap-4 text-xs text-muted-foreground">
												<span className="flex items-center gap-1">
													<Trophy className="w-3 h-3" />
													{job.competition_name || `Competition #${job.competition_id}`}
												</span>
												<span className="flex items-center gap-1">
													<Target className="w-3 h-3" />
													{job.strategy_name || `Strategy #${job.simulation_strategy_id}`}
												</span>
												<span className="flex items-center gap-1">
													<Clock className="w-3 h-3" />
													{cronToHuman(job.cron_expression)}
												</span>
												<span className="flex items-center gap-1">
													<Activity className="w-3 h-3" />
													{job.total_executions} run{job.total_executions !== 1 ? 's' : ''}
													{job.max_executions > 0 && ` / ${job.max_executions}`}
												</span>
												{job.last_triggered_at > 0 && (
													<span className="text-xs">
														Last: {formatDateTime(job.last_triggered_at)}
													</span>
												)}
											</div>
										</div>

										{/* Right: actions */}
										<div className="flex items-center gap-1.5 shrink-0">
											{job.status === 'Active' && (
												<Button variant="outline" size="sm" className="cursor-pointer h-8 gap-1.5 text-xs" onClick={() => handlePause(job.id)}>
													<Pause className="h-3 w-3" />
													Pause
												</Button>
											)}
											{job.status === 'Paused' && (
												<Button variant="outline" size="sm" className="cursor-pointer h-8 gap-1.5 text-xs text-green-700 border-green-200 hover:bg-green-50" onClick={() => handleResume(job.id)}>
													<Play className="h-3 w-3" />
													Resume
												</Button>
											)}
											{job.status !== 'Stopped' && (
												<Button variant="outline" size="sm" className="cursor-pointer h-8 gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleStop(job.id)}>
													<Square className="h-3 w-3" />
													Stop
												</Button>
											)}
											<Button variant="outline" size="sm" className="cursor-pointer h-8 gap-1.5 text-xs" onClick={() => setExecutionHistoryJob({ id: job.id, name: job.name })}>
												<History className="h-3 w-3" />
												History
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>
						);
					})}

					{/* Pagination */}
					{pagination.totalPages > 1 && (
						<div className="pt-2">
							<Pagination
								currentPage={pagination.currentPage}
								totalPages={pagination.totalPages}
								total={pagination.total}
								onPageChange={pagination.goToPage}
							/>
						</div>
					)}
				</div>
			)}

			{createDialogOpen && (
				<CreateJobDialog
					open={createDialogOpen}
					onOpenChange={setCreateDialogOpen}
					onSuccess={() => {
						setCreateDialogOpen(false);
						setRefresh(Date.now());
					}}
				/>
			)}

			{executionHistoryJob && (
				<ExecutionHistoryDialog
					open={!!executionHistoryJob}
					onOpenChange={(open) => setExecutionHistoryJob(open ? executionHistoryJob : null)}
					jobId={executionHistoryJob.id}
					jobName={executionHistoryJob.name}
				/>
			)}
		</div>
	);
};

export default FlowMeshJobs;

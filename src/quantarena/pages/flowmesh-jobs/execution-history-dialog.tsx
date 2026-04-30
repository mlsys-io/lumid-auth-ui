import { useState, useEffect } from 'react';
import type { FlowMeshJobExecutionItem } from '../../api/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Badge } from '../../components/ui/badge';
import { Loading } from '../../components/ui/loading';
import { getFlowMeshJobExecutions, ApiError } from '../../api';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

interface ExecutionHistoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	jobId: number;
	jobName: string;
}

export const ExecutionHistoryDialog = ({ open, onOpenChange, jobId, jobName }: ExecutionHistoryDialogProps) => {
	const [executions, setExecutions] = useState<FlowMeshJobExecutionItem[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (open && jobId) fetchExecutions();
	}, [open, jobId]);

	const fetchExecutions = async () => {
		try {
			setLoading(true);
			const res = await getFlowMeshJobExecutions(jobId);
			setExecutions(res.data.executions || []);
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : 'Failed to load history');
		} finally {
			setLoading(false);
		}
	};

	const successCount = executions.filter((e) => e.result.ok).length;
	const failCount = executions.length - successCount;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Execution History</DialogTitle>
					<DialogDescription>{jobName}</DialogDescription>
				</DialogHeader>

				{loading && <Loading text="Loading history..." />}

				{!loading && executions.length === 0 && (
					<div className="flex flex-col items-center justify-center py-12 text-center">
						<Clock className="w-10 h-10 text-muted-foreground/40 mb-3" />
						<p className="text-sm text-muted-foreground">No executions yet. The job will run on its next scheduled time.</p>
					</div>
				)}

				{!loading && executions.length > 0 && (
					<div className="space-y-4">
						{/* Summary */}
						<div className="flex items-center gap-4 text-sm">
							<span className="text-muted-foreground">{executions.length} total</span>
							{successCount > 0 && (
								<span className="flex items-center gap-1 text-green-600">
									<CheckCircle className="w-3.5 h-3.5" /> {successCount} succeeded
								</span>
							)}
							{failCount > 0 && (
								<span className="flex items-center gap-1 text-red-600">
									<XCircle className="w-3.5 h-3.5" /> {failCount} failed
								</span>
							)}
						</div>

						{/* Timeline */}
						<div className="space-y-2">
							{executions.map((exec, i) => (
								<div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
									{exec.result?.ok ? (
										<CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
									) : (
										<XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
									)}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium">
												{new Date(exec.timestamp).toLocaleString()}
											</span>
											<Badge
												variant="outline"
												className={exec.result?.ok
													? 'text-green-700 border-green-200 text-xs'
													: 'text-red-700 border-red-200 text-xs'
												}
											>
												{exec.result?.ok
													? 'Success'
													: `Failed${exec.result?.status_code != null ? ` (${exec.result.status_code})` : ''}`}
											</Badge>
										</div>
										{exec.result?.ok && exec.result?.body != null && (
											<p className="text-xs text-muted-foreground mt-1 truncate">
												{typeof exec.result.body === 'string'
													? exec.result.body
													: (JSON.stringify(exec.result.body) ?? '').slice(0, 120)}
											</p>
										)}
										{!exec.result?.ok && (
											<p className="text-xs text-red-600 mt-1 truncate">
												{(() => {
													const payload =
														exec.result?.body ??
														exec.result?.error ??
														exec.result ?? {};
													const text =
														typeof payload === 'string'
															? payload
															: JSON.stringify(payload);
													return (text ?? '').slice(0, 200) || '(no error detail)';
												})()}
											</p>
										)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};

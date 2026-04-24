import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	Activity,
	ChevronLeft,
	ChevronRight,
	History,
	Pause,
	Play,
	RefreshCw,
	Square,
	Trash2,
	Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatDateTime } from "@/lib/utils";
import {
	deleteFlowMeshJob,
	listFlowMeshJobExecutions,
	listFlowMeshJobs,
	pauseFlowMeshJob,
	resumeFlowMeshJob,
	stopFlowMeshJob,
	type FlowMeshJobExecutionItem,
	type FlowMeshJobItem,
} from "@/api/qa-admin";

const PAGE_SIZE = 20;

function statusBadge(status: string): string {
	switch (status) {
		case "Active":
			return "bg-green-100 text-green-800 border-green-200";
		case "Paused":
			return "bg-yellow-100 text-yellow-800 border-yellow-200";
		case "Stopped":
			return "bg-gray-100 text-gray-800 border-gray-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
}

function ExecutionHistoryDialog({
	open,
	onOpenChange,
	job,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	job: FlowMeshJobItem | null;
}) {
	const [executions, setExecutions] = useState<FlowMeshJobExecutionItem[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open || !job) return;
		(async () => {
			setLoading(true);
			try {
				const r = await listFlowMeshJobExecutions(job.id);
				setExecutions(r.data?.executions || []);
			} catch (e: unknown) {
				toast.error((e as Error)?.message || "Failed to load executions");
			} finally {
				setLoading(false);
			}
		})();
	}, [open, job]);

	function describeResult(e: FlowMeshJobExecutionItem): { ok: boolean; line: string } {
		const r = e.result || {};
		const ok = !!r.ok && (r.status_code === undefined || r.status_code < 400);
		if (r.error) return { ok: false, line: r.error };
		if (r.status_code !== undefined)
			return {
				ok: r.status_code >= 200 && r.status_code < 400,
				line: `HTTP ${r.status_code}`,
			};
		if (r.body !== undefined) return { ok, line: JSON.stringify(r.body).slice(0, 120) };
		return { ok, line: ok ? "ok" : "(no result)" };
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<History className="w-4 h-4 text-indigo-600" />
						Execution history{job ? ` — ${job.name}` : ""}
					</DialogTitle>
				</DialogHeader>
				{loading ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : executions.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No executions recorded yet.
					</p>
				) : (
					<table className="w-full text-sm">
						<thead className="text-xs text-muted-foreground">
							<tr className="border-b">
								<th className="text-left py-2 pr-3 font-medium">When</th>
								<th className="text-left py-2 pr-3 font-medium">Status</th>
								<th className="text-left py-2 pr-3 font-medium">Result</th>
							</tr>
						</thead>
						<tbody>
							{executions.map((e, i) => {
								const d = describeResult(e);
								return (
									<tr key={i} className="border-b last:border-0">
										<td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
											{e.timestamp}
										</td>
										<td className="py-2 pr-3">
											<span
												className={cn(
													"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
													d.ok
														? "bg-green-100 text-green-800 border-green-200"
														: "bg-red-100 text-red-800 border-red-200"
												)}
											>
												{d.ok ? "ok" : "failed"}
											</span>
										</td>
										<td className="py-2 pr-3 font-mono text-xs truncate max-w-[420px]">
											{d.line}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</DialogContent>
		</Dialog>
	);
}

export default function FlowMeshJobManagement() {
	const [jobs, setJobs] = useState<FlowMeshJobItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);

	const [historyTarget, setHistoryTarget] = useState<FlowMeshJobItem | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<FlowMeshJobItem | null>(null);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	async function refresh() {
		setLoading(true);
		try {
			const r = await listFlowMeshJobs({ page, page_size: PAGE_SIZE });
			setJobs(r.data?.jobs || []);
			setTotal(r.total || 0);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Failed to load jobs");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page]);

	async function handlePause(j: FlowMeshJobItem) {
		try {
			await pauseFlowMeshJob(j.id);
			toast.success(`Paused ${j.name}`);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Pause failed");
		}
	}
	async function handleResume(j: FlowMeshJobItem) {
		try {
			await resumeFlowMeshJob(j.id);
			toast.success(`Resumed ${j.name}`);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Resume failed");
		}
	}
	async function handleStop(j: FlowMeshJobItem) {
		try {
			await stopFlowMeshJob(j.id);
			toast.success(`Stopped ${j.name}`);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Stop failed");
		}
	}
	async function handleDelete(j: FlowMeshJobItem) {
		try {
			await deleteFlowMeshJob(j.id);
			toast.success("Job deleted");
			setDeleteTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Delete failed");
		}
	}

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Workflow className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">FlowMesh jobs</h1>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0 ? "No jobs" : `${total} job${total === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Recurring FlowMesh workflows owned by strategies. Creation happens from
								the strategy page; admins only pause / resume / stop / inspect.
							</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={refresh}
							disabled={loading}
						>
							<RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{loading && jobs.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : jobs.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No running jobs. Strategies create jobs from their own pages; this table
							lights up once any user schedules one.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Strategy</th>
										<th className="text-left py-2 px-2 font-medium">Competition</th>
										<th className="text-left py-2 px-2 font-medium">Cron</th>
										<th className="text-right py-2 px-2 font-medium">Runs</th>
										<th className="text-left py-2 px-2 font-medium">Last triggered</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-right py-2 px-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{jobs.map((j) => (
										<tr key={j.id} className="border-b last:border-0">
											<td className="py-2 px-2 max-w-[200px] truncate font-medium">
												{j.name}
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{j.strategy_name || `#${j.simulation_strategy_id}`}
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{j.competition_name || `#${j.competition_id}`}
											</td>
											<td className="py-2 px-2 font-mono text-xs">{j.cron_expression}</td>
											<td className="py-2 px-2 text-right">
												{j.total_executions}
												{j.max_executions > 0 ? ` / ${j.max_executions}` : ""}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{j.last_triggered_at
													? formatDateTime(j.last_triggered_at)
													: "—"}
											</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														statusBadge(j.status)
													)}
												>
													{j.status}
												</span>
											</td>
											<td className="py-2 px-2 text-right">
												<div className="inline-flex items-center gap-1">
													{j.status === "Active" ? (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handlePause(j)}
															title="Pause"
														>
															<Pause className="w-4 h-4" />
														</Button>
													) : j.status === "Paused" ? (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleResume(j)}
															title="Resume"
														>
															<Play className="w-4 h-4 text-green-600" />
														</Button>
													) : null}
													{j.status !== "Stopped" && (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleStop(j)}
															title="Stop"
														>
															<Square className="w-4 h-4 text-orange-600" />
														</Button>
													)}
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setHistoryTarget(j)}
														title="Executions"
													>
														<Activity className="w-4 h-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setDeleteTarget(j)}
														title="Delete"
													>
														<Trash2 className="w-4 h-4 text-destructive" />
													</Button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{totalPages > 1 && (
						<div className="flex items-center justify-between mt-4 text-sm">
							<span className="text-muted-foreground">
								Page {page} of {totalPages}
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
								>
									<ChevronLeft className="w-4 h-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								>
									<ChevronRight className="w-4 h-4" />
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<ExecutionHistoryDialog
				open={!!historyTarget}
				onOpenChange={(v) => !v && setHistoryTarget(null)}
				job={historyTarget}
			/>

			<AlertDialog
				open={!!deleteTarget}
				onOpenChange={(v) => !v && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete job?</AlertDialogTitle>
						<AlertDialogDescription>
							Deletes <strong>{deleteTarget?.name}</strong> and stops further runs.
							Past execution history is retained.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteTarget && handleDelete(deleteTarget)}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

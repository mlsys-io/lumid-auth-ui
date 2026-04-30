import React, { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Pagination } from '../../components/ui/pagination';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Square, Plus, AlertCircle, RefreshCw, Download, Trash } from 'lucide-react';
import { toast } from 'sonner';
import {
	getBacktestingTasks,
	getBacktestingTaskResult,
	cancelBacktestingTask,
	deleteBacktestingTask,
	exportBacktestingResult,
	getStrategies,
	ApiError,
} from '../../api';
import type { BacktestingTaskInfo, BacktestingTaskResultData, StrategyInfo, TemplateInfo } from '../../api';
import { CreateBacktestDialog } from './create-backtest-dialog';
import { StrategySelectorDialog } from './strategy-selector-dialog';
import { BacktestErrorDialog } from './backtest-error-dialog';
import { getFrameworkColor } from '../../lib/tag-colors';
import {
	PAGE_SIZE,
	FILTER_ALL,
	BacktestStatus,
	BACKTEST_STATUS_OPTIONS,
	BACKTEST_STATUS_STYLES,
	Framework,
	ExportFileType,
} from '../../lib/enum';
import { formatDate, formatDateTime } from '../../lib/utils';
import { usePagination } from '../../hooks/usePagination';
import { useFileDownload } from '../../hooks/useFileDownload';
import { getTemplateList } from '../../api/template';
import EmptyData from '../../components/empty-data';
import ModalConfirm from '../../components/modal-confirm';

// Memoized table row component
const BacktestingTaskRow = memo(function BacktestingTaskRow({
	task,
	onViewError,
	onCancelTask,
	onDeleteTask,
	onExportResult,
}: {
	task: BacktestingTaskInfo;
	onViewError: (task: BacktestingTaskInfo) => void;
	onCancelTask: (taskId: number) => void;
	onDeleteTask: (task: BacktestingTaskInfo) => void;
	onExportResult: (taskId: number, nameSuffix: string, fileType: 'csv' | 'pdf' | 'json') => void;
}) {
	return (
		<TableRow>
			<TableCell>
				<div>
					<p className="font-medium">
						{task.strategy_name}
						<span className="inline-flex items-center rounded bg-muted px-1 py-0.5 text-xs font-medium ml-2">
							v{task.strategy_version}
						</span>
					</p>
					<Tooltip>
						<TooltipTrigger asChild>
							<p className="text-sm text-muted-foreground truncate max-w-xs cursor-default">
								{task.strategy_description}
							</p>
						</TooltipTrigger>
						<TooltipContent className="max-w-sm whitespace-pre-line">
							<p>{task.strategy_description}</p>
						</TooltipContent>
					</Tooltip>
				</div>
			</TableCell>
			<TableCell>
				<span
					className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors ${getFrameworkColor(
						task.framework
					)}`}
				>
					{task.framework}
				</span>
			</TableCell>
			<TableCell className="whitespace-nowrap">
				{formatDate(task.start_date)} ~ {formatDate(task.end_date)}
			</TableCell>
			<TableCell>
				<Badge variant="outline" className={BACKTEST_STATUS_STYLES[task.status as BacktestStatus]}>
					{task.status}
				</Badge>
			</TableCell>
			<TableCell
				className={`font-medium ${task.results && task.results.cagr != null ? (task.results.cagr > 0 ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground'}`}
			>
				{task.results && task.results.cagr != null ? (
					<>
						{task.results.cagr > 0 ? '+' : ''}
						{(task.results.cagr * 100).toFixed(2)}%
					</>
				) : (
					'-'
				)}
			</TableCell>
			<TableCell className="font-medium">
				{task.results && task.results.sharpe_ratio != null ? task.results.sharpe_ratio.toFixed(2) : '-'}
			</TableCell>
			<TableCell
				className={`font-medium ${task.results && task.results.max_drawdown != null ? (task.results.max_drawdown > 0 ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground'}`}
			>
				{task.results && task.results.max_drawdown != null ? (
					<>{(task.results.max_drawdown * 100).toFixed(2)}%</>
				) : (
					'-'
				)}
			</TableCell>
			<TableCell
				className={`font-medium ${task.results && task.results.cumulative_return != null ? (task.results.cumulative_return > 0 ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground'}`}
			>
				{task.results && task.results.cumulative_return != null ? (
					<>
						{task.results.cumulative_return > 0 ? '+' : ''}
						{(task.results.cumulative_return * 100).toFixed(2)}%
					</>
				) : (
					'-'
				)}
			</TableCell>
			<TableCell className="whitespace-nowrap">{formatDateTime(task.create_time)}</TableCell>
			<TableCell className="text-right">
				<div className="flex items-center justify-end gap-1">
					{task.status === BacktestStatus.FINISHED && (
						<>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="icon" className="cursor-pointer">
										<Download className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{task.framework === Framework.FREQTRADE ? (
										<DropdownMenuItem
											onClick={() =>
												onExportResult(
													task.id,
													`${task.strategy_name}_v${task.strategy_version}`,
													ExportFileType.JSON
												)
											}
										>
											Export as JSON
										</DropdownMenuItem>
									) : (
										<>
											<DropdownMenuItem
												onClick={() =>
													onExportResult(
														task.id,
														`${task.strategy_name}_v${task.strategy_version}`,
														ExportFileType.CSV
													)
												}
											>
												Export as CSV
											</DropdownMenuItem>
											{task.framework === Framework.MOONSHOT && (
												<DropdownMenuItem
													onClick={() =>
														onExportResult(
															task.id,
															`${task.strategy_name}_v${task.strategy_version}`,
															ExportFileType.PDF
														)
													}
												>
													Export as PDF
												</DropdownMenuItem>
											)}
										</>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					)}
					{task.status === BacktestStatus.FAILED && (
						<Button
							variant="ghost"
							size="icon"
							onClick={() => onViewError(task)}
							className="cursor-pointer"
						>
							<AlertCircle className="h-4 w-4 text-destructive cursor-pointer" />
						</Button>
					)}
					{task.status === BacktestStatus.PENDING && (
						<Button variant="ghost" size="icon" onClick={() => onCancelTask(task.id)}>
							<Square className="h-4 w-4" />
						</Button>
					)}
					{task.status !== BacktestStatus.RUNNING && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => onDeleteTask(task)}
									className="cursor-pointer"
								>
									<Trash className="h-4 w-4 text-destructive" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>Delete</p>
							</TooltipContent>
						</Tooltip>
					)}
				</div>
			</TableCell>
		</TableRow>
	);
});

export const Backtesting = memo(function Backtesting() {
	const [tasks, setTasks] = useState<BacktestingTaskInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [statusFilter, setStatusFilter] = useState(FILTER_ALL);

	// Use pagination hook for tasks
	const pagination = usePagination({ pageSize: PAGE_SIZE });

	// Use file download hook
	const { download } = useFileDownload();

	const [showStrategySelector, setShowStrategySelector] = useState(false);
	const [showBacktestDialog, setShowBacktestDialog] = useState(false);
	const [showErrorDialog, setShowErrorDialog] = useState(false);

	const [selectedTask, setSelectedTask] = useState<BacktestingTaskInfo | null>(null);
	const [selectedTaskResult, setSelectedTaskResult] = useState<BacktestingTaskResultData | null>(null);
	const [resultLoading, setResultLoading] = useState(false);
	const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
	const [strategiesLoading, setStrategiesLoading] = useState(false);

	// Use pagination hook for strategies
	const strategiesPagination = usePagination({ pageSize: PAGE_SIZE });

	const [selectedStrategyId, setSelectedStrategyId] = useState<number>(0);
	const [selectedStrategyName, setSelectedStrategyName] = useState<string>('');
	const [templateList, setTemplateList] = useState<TemplateInfo[]>([]);

	const fetchTemplateList = useCallback(async () => {
		const response = await getTemplateList({ type: 'all', page: 1, page_size: 9999 });
		setTemplateList(response.data.templates);
	}, []);

	useEffect(() => {
		fetchTemplateList();
	}, [fetchTemplateList]);

	const fetchTasks = useCallback(async () => {
		setLoading(true);
		try {
			const response = await getBacktestingTasks({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
				status: statusFilter !== FILTER_ALL ? [statusFilter] : undefined,
			});
			setTasks(response.data.tasks);
			pagination.setTotal(response.total);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load backtesting tasks');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	}, [pagination.currentPage, pagination.pageSize, statusFilter, pagination.setTotal]);

	useEffect(() => {
		fetchTasks();
	}, [fetchTasks]);

	// Polling logic: poll every 600ms if there are Pending or Running tasks
	useEffect(() => {
		const hasPendingOrRunning = tasks.some(
			(task) => task.status === BacktestStatus.PENDING || task.status === BacktestStatus.RUNNING
		);

		if (!hasPendingOrRunning) {
			return;
		}

		const intervalId = setInterval(() => {
			fetchTasks();
		}, 5000);

		return () => {
			clearInterval(intervalId);
		};
	}, [tasks, fetchTasks]);

	const fetchStrategies = useCallback(
		async (page: number = 1) => {
			setStrategiesLoading(true);
			try {
				const response = await getStrategies({
					page: page,
					page_size: PAGE_SIZE,
				});
				setStrategies(response.data.strategies);
				strategiesPagination.setTotal(response.total);
				strategiesPagination.goToPage(page);
			} catch (error) {
				if (error instanceof ApiError) {
					toast.error(error.message || 'Failed to load strategies');
				} else {
					toast.error('Network error. Please check your connection.');
				}
			} finally {
				setStrategiesLoading(false);
			}
		},
		[strategiesPagination.setTotal, strategiesPagination.goToPage]
	);

	const handleCreateBacktest = useCallback(() => {
		fetchStrategies(1);
		setShowStrategySelector(true);
	}, [fetchStrategies]);

	const handleRetryBacktest = useCallback((strategyId?: number, strategyName?: string) => {
		if (strategyId && strategyName) {
			setSelectedStrategyId(strategyId);
			setSelectedStrategyName(strategyName);
			setShowBacktestDialog(true);
		}
	}, []);

	const handleStrategyPageChange = useCallback(
		(page: number) => {
			fetchStrategies(page);
		},
		[fetchStrategies]
	);

	const handleStrategySelect = useCallback(
		(strategyId: number) => {
			const strategy = strategies.find((s) => s.id === strategyId);
			if (strategy) {
				setSelectedStrategyId(strategyId);
				setSelectedStrategyName(strategy.name);
				setShowStrategySelector(false);
				setShowBacktestDialog(true);
			}
		},
		[strategies]
	);

	const handleViewError = useCallback(async (task: BacktestingTaskInfo) => {
		setSelectedTask(task);
		setResultLoading(true);

		try {
			const result = await getBacktestingTaskResult(task.id);
			setSelectedTaskResult(result);
			setShowErrorDialog(true);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load error details');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setResultLoading(false);
		}
	}, []);

	const handleCancelTask = useCallback(
		async (taskId: number) => {
			try {
				await cancelBacktestingTask(taskId);
				toast.success('Task cancelled successfully');
				fetchTasks();
			} catch (error) {
				if (error instanceof ApiError) {
					toast.error(error.message || 'Failed to cancel task');
				} else {
					toast.error('Network error. Please check your connection.');
				}
			}
		},
		[fetchTasks]
	);

	const [deleteTask, setDeleteTask] = useState<BacktestingTaskInfo | null>(null);

	const handleDeleteTask = useCallback(
		async () => {
			if (!deleteTask) return;
			try {
				await deleteBacktestingTask(deleteTask.id);
				toast.success('Task deleted successfully');
				setDeleteTask(null);
				fetchTasks();
			} catch (error) {
				if (error instanceof ApiError) {
					toast.error(error.message || 'Failed to delete task');
				} else {
					toast.error('Network error. Please check your connection.');
				}
			}
		},
		[deleteTask, fetchTasks]
	);

	const handleExportResult = useCallback(
		async (taskId: number, nameSuffix: string, fileType: 'csv' | 'pdf' | 'json') => {
			await download(
				() => exportBacktestingResult(taskId, fileType),
				`backtest_result_${nameSuffix}.${fileType}`,
				{
					successMessage: `Result exported as ${fileType.toUpperCase()}`,
					errorMessage: 'Failed to export result',
				}
			);
		},
		[download]
	);

	const handleBacktestSuccess = useCallback(() => {
		toast.success('Backtest task created successfully');
		fetchTasks();
	}, [fetchTasks]);

	// Memoize table content
	const taskTableContent = useMemo(
		() => (
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Strategy Info</TableHead>
						<TableHead>Framework</TableHead>
						<TableHead>Time Range</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>CAGR %</TableHead>
						<TableHead>Sharpe Ratio</TableHead>
						<TableHead>Max Drawdown %</TableHead>
						<TableHead>Cumulative Return %</TableHead>
						<TableHead>Created</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{tasks.length === 0 ? (
						<TableRow>
							<TableCell colSpan={10} className="text-center text-muted-foreground py-8">
								{loading ? (
									'Loading tasks...'
								) : (
									<EmptyData
										title="No tasks found"
										buttonText="Create Your First Task"
										ButtonIcon={Plus}
										buttonOnClick={handleCreateBacktest}
									/>
								)}
							</TableCell>
						</TableRow>
					) : (
						tasks.map((task) => (
							<BacktestingTaskRow
								key={task.id}
								task={task}
								onViewError={handleViewError}
								onCancelTask={handleCancelTask}
								onDeleteTask={setDeleteTask}
								onExportResult={handleExportResult}
							/>
						))
					)}
				</TableBody>
			</Table>
		),
		[tasks, loading, handleViewError, handleCancelTask, handleExportResult, handleCreateBacktest]
	);

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
				<div>
					<h1>Backtesting</h1>
					<p className="text-muted-foreground">
						Test and validate your trading strategies with historical data
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" onClick={fetchTasks} disabled={loading} className="cursor-pointer">
						<RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
						Refresh
					</Button>
					<Button onClick={handleCreateBacktest} className="cursor-pointer">
						<Plus className="h-4 w-4 mr-2" />
						New Backtest
					</Button>
				</div>
			</div>

			<div className="space-y-6">
				<div className="flex items-center gap-4 p-3 rounded-lg border">
					<label className="text-sm font-medium text-muted-foreground">Status:</label>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className="w-48">
							<SelectValue placeholder="Status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={FILTER_ALL}>All Status</SelectItem>
							{BACKTEST_STATUS_OPTIONS.map((status) => (
								<SelectItem key={status} value={status}>
									{status}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<Card>
				<CardContent className="p-0">
					{taskTableContent}
					{/* Pagination */}
					{tasks.length > 0 && (
						<div className="p-4 border-t">
							<Pagination
								currentPage={pagination.currentPage}
								totalPages={pagination.totalPages}
								total={pagination.total}
								onPageChange={pagination.goToPage}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Dialogs */}
			<BacktestErrorDialog
				open={showErrorDialog}
				onOpenChange={setShowErrorDialog}
				task={selectedTask}
				errMsg={selectedTaskResult?.error_message}
				loading={resultLoading}
				onRetry={handleRetryBacktest}
			/>

			<StrategySelectorDialog
				open={showStrategySelector}
				onOpenChange={setShowStrategySelector}
				strategies={strategies}
				loading={strategiesLoading}
				onStrategySelect={handleStrategySelect}
				currentPage={strategiesPagination.currentPage}
				totalPages={strategiesPagination.totalPages}
				total={strategiesPagination.total}
				onPageChange={handleStrategyPageChange}
			/>

			<CreateBacktestDialog
				open={showBacktestDialog}
				onOpenChange={setShowBacktestDialog}
				strategyId={selectedStrategyId}
				strategyName={selectedStrategyName}
				onSuccess={handleBacktestSuccess}
				templateList={templateList ?? []}
			/>

			{deleteTask && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the backtesting task for "${deleteTask.strategy_name} v${deleteTask.strategy_version}". This action cannot be undone.`}
					onConfirm={handleDeleteTask}
					open={!!deleteTask}
					onOpenChange={() => setDeleteTask(null)}
				/>
			)}
		</div>
	);
});

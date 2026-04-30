import { memo, useCallback, Fragment } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Edit } from 'lucide-react';
import type { StrategyInfo, StrategyVersionInfo, BacktestTaskInfo } from '../../api';

// Get the best backtest result from tasks
const getBestBacktestResult = (tasks: BacktestTaskInfo[]): BacktestTaskInfo | null => {
	const finishedTasks = tasks.filter((t) => t.status === 'Finished' && t.cagr !== undefined);
	if (finishedTasks.length === 0) return null;
	return finishedTasks.reduce((best, current) => ((current.cagr || 0) > (best.cagr || 0) ? current : best));
};

interface VersionHistoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	strategy: StrategyInfo | null;
	versions: StrategyVersionInfo[];
	onViewCode: (strategy: StrategyInfo, version: StrategyVersionInfo) => void;
}

export const VersionHistoryDialog = memo(function VersionHistoryDialog({
	open,
	onOpenChange,
	strategy,
	versions,
	onViewCode,
}: VersionHistoryDialogProps) {
	const handleViewCode = useCallback(
		(version: StrategyVersionInfo) => {
			onOpenChange(false);
			if (strategy) {
				onViewCode(strategy, version);
			}
		},
		[onOpenChange, strategy, onViewCode]
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl max-h-[80vh]">
				<DialogHeader>
					<DialogTitle>Version History - {strategy?.name}</DialogTitle>
					<DialogDescription>View all versions and their best backtesting result</DialogDescription>
				</DialogHeader>

				<div className="overflow-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Version</TableHead>
								<TableHead>Note</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{versions.map((version) => {
								const bestResult = getBestBacktestResult(version.backtest_tasks || []);
								return (
									<Fragment key={version.id}>
										<TableRow>
											<TableCell>
												<Badge variant="outline">v{version.version}</Badge>
											</TableCell>
											<TableCell>
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="truncate max-w-[200px] block cursor-default">
															{version.note || '-'}
														</span>
													</TooltipTrigger>
													{version.note && (
														<TooltipContent className="max-w-sm">
															<p>{version.note}</p>
														</TooltipContent>
													)}
												</Tooltip>
											</TableCell>
											<TableCell className="whitespace-nowrap text-sm">
												{new Date(version.create_time * 1000).toLocaleDateString()}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="secondary"
													size="sm"
													onClick={() => handleViewCode(version)}
												>
													<Edit className="w-4 h-4" />
												</Button>
											</TableCell>
										</TableRow>
										{bestResult && (
											<TableRow key={`${version.id}-result`}>
												<TableCell colSpan={4} className="py-2 px-4">
													<div className="flex items-center gap-3">
														<span className="text-xs text-muted-foreground px-2.5 py-1 rounded-md bg-amber-100">
															Best Result
														</span>
														<div className="flex items-center gap-1 px-2.5 py-1 rounded-full">
															<span className="text-xs">CAGR</span>
															<span
																className={`text-xs font-semibold ${
																	bestResult.cagr! >= 0
																		? 'text-green-600 dark:text-green-400'
																		: 'text-red-600 dark:text-red-400'
																}`}
															>
																{bestResult.cagr! >= 0 ? '+' : ''}
																{(bestResult.cagr! * 100).toFixed(2)}%
															</span>
														</div>
														<div className="flex items-center gap-1 px-2.5 py-1 rounded-full">
															<span className="text-xs">Sharpe</span>
															<span className="text-xs font-semibold">
																{bestResult.sharpe_ratio?.toFixed(2) || '-'}
															</span>
														</div>
														<div className="flex items-center gap-1 px-2.5 py-1 rounded-full">
															<span className="text-xs">Max Drawdown</span>
															<span
																className={`text-xs font-semibold ${
																	bestResult.max_drawdown! >= 0
																		? 'text-green-600 dark:text-green-400'
																		: 'text-red-600 dark:text-red-400'
																}`}
															>
																{bestResult.max_drawdown! >= 0 ? '+' : ''}
																{(bestResult.max_drawdown! * 100).toFixed(2)}%
															</span>
														</div>
														<div className="flex items-center gap-1 px-2.5 py-1 rounded-full">
															<span className="text-xs">Return</span>
															<span
																className={`text-xs font-semibold ${
																	bestResult.cumulative_return! >= 0
																		? 'text-green-600 dark:text-green-400'
																		: 'text-red-600 dark:text-red-400'
																}`}
															>
																{bestResult.cumulative_return! >= 0 ? '+' : ''}
																{(bestResult.cumulative_return! * 100).toFixed(2)}%
															</span>
														</div>
													</div>
												</TableCell>
											</TableRow>
										)}
									</Fragment>
								);
							})}
						</TableBody>
					</Table>
				</div>
			</DialogContent>
		</Dialog>
	);
});

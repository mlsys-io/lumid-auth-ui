import { memo } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { RefreshCw } from 'lucide-react';
import type { BacktestingTaskInfo, BacktestingTaskResultData } from '../../api';
import { formatDate } from '../../lib/utils';

// Memoized metric card component
const MetricCard = memo(function MetricCard({
	label,
	value,
	colorClass,
	prefix = '',
	suffix = '',
}: {
	label: string;
	value: number | undefined;
	colorClass?: string;
	prefix?: string;
	suffix?: string;
}) {
	return (
		<Card>
			<CardContent className="pt-6">
				<p className="text-sm text-muted-foreground">{label}</p>
				<p className={`text-2xl font-semibold ${colorClass || ''}`}>
					{prefix}
					{value !== undefined ? value.toFixed(2) : ''}
					{suffix}
				</p>
			</CardContent>
		</Card>
	);
});

interface BacktestResultDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	task: BacktestingTaskInfo | null;
	result: BacktestingTaskResultData | null;
	loading: boolean;
}

export const BacktestResultDialog = memo(function BacktestResultDialog({
	open,
	onOpenChange,
	task,
	result,
	loading,
}: BacktestResultDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl">
				<DialogHeader>
					<DialogTitle>Backtest Results - {task?.strategy_name}</DialogTitle>
					<DialogDescription>
						Version {task?.strategy_version} • {task && formatDate(task.start_date)} ~{' '}
						{task && formatDate(task.end_date)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : result?.results ? (
						<div className="grid grid-cols-4 gap-4">
							<MetricCard
								label="CAGR"
								value={result.results?.cagr ? result.results.cagr * 100 : undefined}
								colorClass={result.results?.cagr >= 0 ? 'text-green-600' : 'text-red-600'}
								prefix={result.results?.cagr >= 0 ? '+' : ''}
								suffix="%"
							/>
							<MetricCard label="Sharpe Ratio" value={result.results?.sharpe_ratio} />
							<MetricCard
								label="Max Drawdown"
								value={result.results?.max_drawdown ? result.results.max_drawdown * 100 : undefined}
								colorClass={result.results?.max_drawdown >= 0 ? 'text-green-600' : 'text-red-600'}
								suffix="%"
							/>
							<MetricCard
								label="Cumulative Return"
								value={
									result.results?.cumulative_return
										? result.results.cumulative_return * 100
										: undefined
								}
								colorClass={result.results?.cumulative_return >= 0 ? 'text-green-600' : 'text-red-600'}
								prefix={result.results?.cumulative_return >= 0 ? '+' : ''}
								suffix="%"
							/>
						</div>
					) : (
						<div className="text-center text-muted-foreground py-8">
							<p>No results available</p>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
});

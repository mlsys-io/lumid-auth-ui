import { memo, useCallback } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Pagination } from '../../components/ui/pagination';
import { RefreshCw } from 'lucide-react';
import type { StrategyInfo } from '../../api';
import { getFrameworkColor } from '../../lib/tag-colors';
import { Badge } from '../../components/ui/badge';

// Memoized strategy card component
const StrategyCard = memo(function StrategyCard({
	strategy,
	onSelect,
}: {
	strategy: StrategyInfo;
	onSelect: (strategyId: number) => void;
}) {
	const handleClick = useCallback(() => {
		onSelect(strategy.id);
	}, [onSelect, strategy.id]);

	return (
		<Card className="cursor-pointer hover:bg-accent transition-colors" onClick={handleClick}>
			<CardContent className="p-4">
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<h4 className="font-medium mb-1">
							{strategy.name}(v{strategy.current_version})
						</h4>
						<p className="text-sm text-muted-foreground mb-2">{strategy.description}</p>
						<div className="flex items-center gap-3 text-xs text-muted-foreground">
							<span
								className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium transition-colors ${getFrameworkColor(
									strategy.framework
								)}`}
							>
								{strategy.framework}
							</span>
							<Badge variant={strategy.visibility === 'Public' ? 'default' : 'secondary'}>
								{strategy.visibility}
							</Badge>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
});

interface StrategySelectorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	strategies: StrategyInfo[];
	loading: boolean;
	onStrategySelect: (strategyId: number) => void;
	currentPage: number;
	totalPages: number;
	total: number;
	onPageChange: (page: number) => void;
}

export const StrategySelectorDialog = memo(function StrategySelectorDialog({
	open,
	onOpenChange,
	strategies,
	loading,
	onStrategySelect,
	currentPage,
	totalPages,
	total,
	onPageChange,
}: StrategySelectorDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Select Strategy</DialogTitle>
					<DialogDescription>Choose a strategy to backtest</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{loading ? (
						<div className="flex items-center justify-center py-8">
							<RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : strategies.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-muted-foreground mb-4">
								No strategies available. Please create a strategy first.
							</p>
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Close
							</Button>
						</div>
					) : (
						<>
							<div className="grid gap-3 max-h-[400px] overflow-y-auto">
								{strategies.map((strategy) => (
									<StrategyCard
										key={strategy.id}
										strategy={strategy}
										onSelect={onStrategySelect}
									/>
								))}
							</div>
							{strategies.length > 0 && (
								<Pagination
									currentPage={currentPage}
									totalPages={totalPages}
									total={total}
									onPageChange={onPageChange}
								/>
							)}
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
});

import React, { useEffect, useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { CompetitionInfo, SimulationStrategyInfo } from '../../api/types';
import { getSimulationStrategies } from '../../api/strategy';
import { formatDate, formatCurrency, formatPercentage } from '../../lib/utils';
import { AlertTriangle } from 'lucide-react';
import { Loading } from '../../components/ui/loading';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { PAGE_SIZE } from '../../lib/enum';
import { usePagination } from '../../hooks/usePagination';
import { Pagination } from '../../components/ui/pagination';

interface RegisterCompetitionDialogProps {
	open: boolean;
	competitionInfo: CompetitionInfo;
	onClose: () => void;
	onConfirmRegister?: (competitionId: number, strategyId: number) => void;
}

const RegisterCompetitionDialog = (props: RegisterCompetitionDialogProps) => {
	const { open, competitionInfo, onClose, onConfirmRegister } = props;
	const [strategies, setStrategies] = useState<SimulationStrategyInfo[]>([]);
	const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const pagination = usePagination({ pageSize: PAGE_SIZE });

	useEffect(() => {
		if (open) {
			fetchStrategies();
			setSelectedStrategyId(null);
		}
	}, [open, pagination.currentPage]);

	const fetchStrategies = async () => {
		setLoading(true);
		try {
			const response = await getSimulationStrategies({
				status: ['Idle'],
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setStrategies(response.data.strategies);
			pagination.setTotal(response.total);
		} catch (error) {
			toast.error('Failed to load strategies');
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	const handleRegister = () => {
		if (!selectedStrategyId) {
			toast.error('Please select a strategy');
			return;
		}
		onConfirmRegister?.(competitionInfo.id, selectedStrategyId);
	};

	return (
		<Dialog open={open} onOpenChange={onClose}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="text-xl font-semibold">Register for Competition</DialogTitle>
					<DialogDescription>Select a strategy to participate in this competition</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					{/* Competition Information */}
					<div className="space-y-4">
						<h3 className="text-lg font-semibold">Competition Information</h3>
						<div className="grid grid-cols-2 gap-12 p-4 border rounded-lg bg-muted/20">
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">Competition Name:</span>
									<span className="text-sm font-medium">{competitionInfo.name}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">Initial Funding:</span>
									<span className="text-sm font-medium">
										{formatCurrency(competitionInfo.initial_funding)}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">Market:</span>
									<span className="text-sm font-medium">{competitionInfo.market_name}</span>
								</div>
							</div>
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">Trading Fees:</span>
									<span className="text-sm font-medium">
										{formatPercentage(competitionInfo.trading_fees)}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">Competition Time:</span>
									<span className="text-sm font-medium">
										{formatDate(competitionInfo.start_time)} ~{' '}
										{formatDate(competitionInfo.end_time)}
									</span>
								</div>
							</div>
						</div>

						{/* Important Notes */}
						<div className="p-4 border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900 rounded-lg">
							<div className="flex items-start gap-2">
								<AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
								<div className="space-y-1 text-sm">
									<p className="font-medium text-yellow-900 dark:text-yellow-100">Important Notes:</p>
									<ul className="space-y-1 text-yellow-800 dark:text-yellow-200 list-disc list-inside">
										<li>Cannot withdraw midway during the competition, please choose carefully</li>
										<li>The same strategy can only participate in one competition at a time</li>
										<li>Only strategies with "Idle" status are supported for participation</li>
									</ul>
								</div>
							</div>
						</div>
					</div>

					{/* Select Competition Strategy */}
					<div className="space-y-4">
						<h3 className="text-lg font-semibold">Select Competition Strategy</h3>
						{loading ? (
							<Loading text="Loading strategies..." />
						) : strategies.length === 0 ? (
							<div className="text-center py-8 border rounded-lg bg-muted/20">
								<p className="text-muted-foreground">
									No available strategies. Please create a strategy first.
								</p>
							</div>
						) : (
							<>
								<div className="space-y-3 max-h-[300px] overflow-y-auto">
									{strategies.map((strategy) => (
										<Card
											key={strategy.id}
											className={cn(
												'cursor-pointer transition-colors',
												selectedStrategyId === strategy.id
													? 'border-green-500 border-2'
													: 'hover:bg-green-50'
											)}
											onClick={() => setSelectedStrategyId(strategy.id)}
										>
											<CardContent className="px-4 py-2">
												<div className="flex items-start justify-between gap-4">
													<div className="flex-1 space-y-2">
														<div className="flex items-center justify-between">
															<h4 className="font-medium">{strategy.name}</h4>
															<Badge
																variant="secondary"
																className="shrink-0 bg-green-100 text-green-800 border-green-200"
															>
																{strategy.status}
															</Badge>
														</div>
														{strategy.description && (
															<p className="text-sm text-muted-foreground">
																{strategy.description}
															</p>
														)}
														<div className="flex items-center gap-2 text-xs text-muted-foreground">
															<span>Created: {formatDate(strategy.create_time)}</span>
														</div>
													</div>
												</div>
											</CardContent>
										</Card>
									))}
								</div>
								<Pagination
									currentPage={pagination.currentPage}
									totalPages={pagination.totalPages}
									total={pagination.total}
									onPageChange={pagination.goToPage}
								/>
							</>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={handleRegister}
						className="cursor-pointer"
						disabled={!selectedStrategyId || loading}
					>
						Confirm
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default RegisterCompetitionDialog;

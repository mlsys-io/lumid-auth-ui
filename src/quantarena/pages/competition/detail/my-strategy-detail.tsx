import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useParams } from 'react-router-dom';
import { ApiError, getMyStrategies, getStrategyDetail } from '../../../api';
import { MyStrategyInfo, PositionInfo, RecentTradeInfo } from '../../../api/types';
import { toast } from 'sonner';
import { Wallet, Currency, TrendingUp, Trophy, CircleQuestionMark, Scale, TrendingDown } from 'lucide-react';
import { cn, formatPercentage, formatCurrency } from '../../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Loading } from '../../../components/ui/loading';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { useIsMobile } from '../../../components/ui/use-mobile';
import PositionTable from './position-table';
import RecentTradesTable from './recent-trades-table';

const HELP_TEXTS: Record<string, string> = {
	availableCash: 'Funds currently available to place new trades..',
	totalEquity: 'Cash plus the market value of open positions.',
	returnRate: 'Percentage gain or loss relative to initial capital.',
	sharpeRatio: 'Risk-adjusted return. Higher means more stable performance.',
	maxDrawdown: 'Largest percentage drop from a historical equity peak.',
};

const StrategyOverviewMobileContent = ({ baseInfo }: { baseInfo: MyStrategyInfo }) => {
	const [openHelpKey, setOpenHelpKey] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-3">
			{/* Row: label + value on same line */}
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Currency className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Available Cash</span>
					<Popover open={openHelpKey === 'availableCash'} onOpenChange={(o) => setOpenHelpKey(o ? 'availableCash' : null)}>
						<PopoverTrigger asChild>
							<button type="button" className="touch-manipulation shrink-0">
								<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
							<p className="text-sm">{HELP_TEXTS.availableCash}</p>
						</PopoverContent>
					</Popover>
				</div>
				<span className="text-base text-black font-medium shrink-0">{formatCurrency(baseInfo.available_cash)}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Wallet className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Total Equity</span>
					<Popover open={openHelpKey === 'totalEquity'} onOpenChange={(o) => setOpenHelpKey(o ? 'totalEquity' : null)}>
						<PopoverTrigger asChild>
							<button type="button" className="touch-manipulation shrink-0">
								<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
							<p className="text-sm">{HELP_TEXTS.totalEquity}</p>
						</PopoverContent>
					</Popover>
				</div>
				<span className="text-base text-black font-medium shrink-0">{formatCurrency(baseInfo.total_equity)}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Trophy className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Rank</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">{`${baseInfo.rank ? `#${baseInfo.rank}` : '-'}`}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<TrendingUp className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Return Rate</span>
					<Popover open={openHelpKey === 'returnRate'} onOpenChange={(o) => setOpenHelpKey(o ? 'returnRate' : null)}>
						<PopoverTrigger asChild>
							<button type="button" className="touch-manipulation shrink-0">
								<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
							<p className="text-sm">{HELP_TEXTS.returnRate}</p>
						</PopoverContent>
					</Popover>
				</div>
				<span
					className={cn(
						baseInfo.return_rate >= 0 ? 'text-green-600' : 'text-red-600',
						'text-base font-medium shrink-0'
					)}
				>
					{baseInfo.return_rate ? formatPercentage(baseInfo.return_rate) : '-'}
				</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Scale className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Sharpe Ratio</span>
					<Popover open={openHelpKey === 'sharpeRatio'} onOpenChange={(o) => setOpenHelpKey(o ? 'sharpeRatio' : null)}>
						<PopoverTrigger asChild>
							<button type="button" className="touch-manipulation shrink-0">
								<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
							<p className="text-sm">{HELP_TEXTS.sharpeRatio}</p>
						</PopoverContent>
					</Popover>
				</div>
				<span className="text-base text-black font-medium shrink-0">{baseInfo.sharpe_ratio}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<TrendingDown className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Max Drawdown</span>
					<Popover open={openHelpKey === 'maxDrawdown'} onOpenChange={(o) => setOpenHelpKey(o ? 'maxDrawdown' : null)}>
						<PopoverTrigger asChild>
							<button type="button" className="touch-manipulation shrink-0">
								<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
							<p className="text-sm">{HELP_TEXTS.maxDrawdown}</p>
						</PopoverContent>
					</Popover>
				</div>
				<span className="text-base text-black font-medium shrink-0">{baseInfo.max_drawdown}</span>
			</div>
		</div>
	);
};

const MyStrategyDetail = () => {
	const { competitionId } = useParams();
	const isMobile = useIsMobile();
	const [strategyId, setStrategyId] = useState<string | null>(null);
	const [baseInfo, setBaseInfo] = useState<MyStrategyInfo | null>(null);
	const [positions, setPositions] = useState<PositionInfo[]>([]);
	const [recentTrades, setRecentTrades] = useState<RecentTradeInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [strategyList, setStrategyList] = useState<MyStrategyInfo[]>([]);

	useEffect(() => {
		fetchStrategyList();
	}, [competitionId]);

	const fetchStrategyList = async () => {
		try {
			setLoading(true);
			const response = await getMyStrategies(Number(competitionId));
			setStrategyList(response.data.strategies || []);
			setStrategyId(response.data.strategies?.[0]?.simulation_strategy_id.toString() || null);
		} catch (error) {
			const errorMessage = error instanceof ApiError ? error.message : 'Failed to fetch strategy list';
			toast.error(errorMessage);
		} finally {
			setLoading(false);
		}
	};
	useEffect(() => {
		if (competitionId && strategyId) {
			fetchStrategyDetail();
		}
	}, [competitionId, strategyId]);

	const fetchStrategyDetail = async () => {
		try {
			setLoading(true);
			const response = await getStrategyDetail(Number(competitionId), Number(strategyId));
			setBaseInfo(response.data.participant_info);
			setPositions(response.data.positions);
			setRecentTrades(response.data.recent_trades);
		} catch (error) {
			const errorMessage = error instanceof ApiError ? error.message : 'Failed to fetch strategy detail';
			toast.error(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="p-4">
			<div className="flex items-center mb-4">
				<label className="text-sm font-medium text-muted-foreground mr-2">Strategy:</label>
				<Select value={strategyId || undefined} onValueChange={setStrategyId}>
					<SelectTrigger className="w-[200px]">
						<SelectValue placeholder="Select a strategy" />
					</SelectTrigger>
					<SelectContent>
						{strategyList.map((strategy) => (
							<SelectItem
								key={strategy.simulation_strategy_id}
								value={strategy.simulation_strategy_id.toString()}
							>
								{strategy.strategy_name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{loading && <Loading text="Loading strategy details..." />}
			{baseInfo && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base font-semibold">
							Account Overview
						</CardTitle>
					</CardHeader>
					<CardContent>
						{isMobile ? (
							<StrategyOverviewMobileContent baseInfo={baseInfo} />
						) : (
							<>
								<div className="grid grid-cols-4 gap-4">
									<div className="flex items-start gap-2">
										<Currency className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Available Cash
												<Tooltip>
													<TooltipTrigger>
														<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
													</TooltipTrigger>
													<TooltipContent>
														<p>Funds currently available to place new trades..</p>
													</TooltipContent>
												</Tooltip>
											</div>
											<div className="text-base text-black font-medium">
												{formatCurrency(baseInfo.available_cash)}
											</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<Wallet className="w-5 h-5 text-muted-foreground" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Total Equity
												<Tooltip>
													<TooltipTrigger>
														<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
													</TooltipTrigger>
													<TooltipContent>
														<p>Cash plus the market value of open positions.</p>
													</TooltipContent>
												</Tooltip>
											</div>
											<div className="text-base text-black font-medium">
												{formatCurrency(baseInfo.total_equity)}
											</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<Trophy className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1">Rank</div>
											<div className="text-base text-black font-medium">{`${baseInfo.rank ? `#${baseInfo.rank}` : '-'}`}</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<TrendingUp className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Return Rate
												<Tooltip>
													<TooltipTrigger>
														<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
													</TooltipTrigger>
													<TooltipContent>
														<p>Percentage gain or loss relative to initial capital.</p>
													</TooltipContent>
												</Tooltip>
											</div>
											<div
												className={cn(
													baseInfo.return_rate >= 0 ? 'text-green-600' : 'text-red-600',
													'text-base font-medium'
												)}
											>
												{baseInfo.return_rate ? formatPercentage(baseInfo.return_rate) : '-'}
											</div>
										</div>
									</div>
								</div>
								<div className="grid grid-cols-4 gap-4 mt-4">
									<div className="flex items-start gap-2">
										<Scale className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Sharpe Ratio
												<Tooltip>
													<TooltipTrigger>
														<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
													</TooltipTrigger>
													<TooltipContent>
														<p>Risk-adjusted return. Higher means more stable performance.</p>
													</TooltipContent>
												</Tooltip>
											</div>
											<div className="text-base text-black font-medium">{baseInfo.sharpe_ratio}</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<TrendingDown className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Max Drawdown
												<Tooltip>
													<TooltipTrigger>
														<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
													</TooltipTrigger>
													<TooltipContent>
														<p>Largest percentage drop from a historical equity peak.</p>
													</TooltipContent>
												</Tooltip>
											</div>
											<div className="text-base text-black font-medium">{baseInfo.max_drawdown}</div>
										</div>
									</div>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			)}
			{positions.length > 0 && <PositionTable positions={positions} />}
			{recentTrades.length > 0 && <RecentTradesTable recentTrades={recentTrades} />}
		</div>
	);
};

export default MyStrategyDetail;

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MyStrategyInfo } from '../../../api/types';
import { ApiError, getCompetitionLeaderboard } from '../../../api';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar';
import { Eye, ArrowDownUp, ChartBarDecreasing, MoveDown, MoveUp } from 'lucide-react';
import { formatPercentage, getUserInitials, formatCurrency, cn } from '../../../lib/utils';
import { Loading } from '../../../components/ui/loading';
import { useNavigate } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';

type SortField = 'TotalEquity' | 'ReturnRate' | 'MaxDrawdown' | 'SharpeRatio' | 'TradingTimes';
const DEFAULT_SORT: { sort_by: SortField; order: 'asc' | 'desc' } = {
	sort_by: 'TotalEquity',
	order: 'desc',
};
const renderSortIcon = (field: SortField, sortInfo: { sort_by: SortField; order: 'asc' | 'desc' }) => {
	return (
		<div className="flex items-center">
			{sortInfo.sort_by !== field && <ArrowDownUp className="text-gray-500 w-3 h-3 hover:text-blue-500" />}
			{sortInfo.sort_by === field && sortInfo.order === 'asc' && (
				<MoveUp className="text-blue-500 w-3 h-3 ml-[-4px]" />
			)}
			{sortInfo.sort_by === field && sortInfo.order === 'desc' && (
				<MoveDown className="text-blue-500 w-3 h-3 ml-[-4px]" />
			)}
		</div>
	);
};
const LeaderboardUser = ({
	competitionId,
	status,
}: {
	competitionId: number;
	onRefreshMyStrategies: () => void;
	status?: 'Upcoming' | 'Ongoing' | 'Completed';
}) => {
	const navigate = useNavigate();
	const [leaderboard, setLeaderboard] = useState<MyStrategyInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [sortInfo, setSortInfo] = useState<{ sort_by: SortField; order: 'asc' | 'desc' }>(DEFAULT_SORT);
	const [refresh] = useState(Date.now());
	const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isInitialMount = useRef(true);

	const fetchLeaderboard = useCallback(async (isPolling = false) => {
		if (!isPolling) {
			setLoading(true);
		}
		try {
			const response = await getCompetitionLeaderboard(competitionId, { ...sortInfo });
			setLeaderboard(response?.data?.participants || []);
		} catch (error) {
			const errorMessage = error instanceof ApiError ? error.message : 'Failed to fetch leaderboard';
			toast.error(errorMessage);
			if (!isPolling) {
				setLeaderboard([]);
			}
		} finally {
			if (!isPolling) {
				setLoading(false);
			}
		}
	}, [competitionId, sortInfo]);

	useEffect(() => {
		if (competitionId) {
			isInitialMount.current = true;
			fetchLeaderboard(false);
		}

		// Set up polling interval
		if (status === 'Ongoing' && competitionId) {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
			intervalRef.current = setInterval(() => {
				isInitialMount.current = false;
				fetchLeaderboard(true);
			}, 300000); // 5 minutes
		} else {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		}

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [competitionId, fetchLeaderboard, refresh, status]);

	const getRankDisplay = (rank: number) => {
		if (rank === 1) {
			return <span className="text-3xl">🥇</span>;
		}
		if (rank === 2) {
			return <span className="text-3xl">🥈</span>;
		}
		if (rank === 3) {
			return <span className="text-3xl">🥉</span>;
		}
		return (
			<span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs font-medium">{rank}</span>
		);
	};

	const handleSortChange = (field: SortField) => {
		setSortInfo((prev) => {
			if (prev.sort_by !== field) {
				return { sort_by: field, order: 'desc' };
			}
			if (prev.order === 'desc') {
				return { sort_by: field, order: 'asc' };
			}
			return DEFAULT_SORT;
		});
	};

	if (loading && leaderboard.length === 0) {
		return <Loading text="Loading leaderboard..." />;
	}

	if (!loading && leaderboard.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 px-4">
				<div className="relative mb-6">
					{/* 背景光晕效果 */}
					<div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 to-orange-500/20 rounded-full blur-2xl"></div>
					{/* 图标容器 */}
					<div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 flex items-center justify-center border border-amber-200/50 dark:border-amber-800/50">
						<ChartBarDecreasing
							className="w-10 h-10 text-amber-500 dark:text-amber-400"
							strokeWidth={1.5}
						/>
					</div>
				</div>
				<h3 className="text-lg font-semibold text-foreground mb-2">No Leaderboard Data Yet</h3>
				<p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
					The competition hasn't started or no participants have submitted strategies yet. Check back soon to
					see the rankings!
				</p>
			</div>
		);
	}

	return (
		<div className="w-full overflow-x-auto max-h-[284px] overflow-y-auto">
			<Table>
				<TableHeader className="sticky top-0 z-10 bg-background">
					<TableRow>
						<TableHead className="w-20 text-center bg-background">Rank</TableHead>
						<TableHead className="text-left bg-background">User</TableHead>
						<TableHead className="bg-background">Strategy</TableHead>
						<TableHead className="bg-background w-[40px]">Strategy ID</TableHead>
						<TableHead className="text-center bg-background">
							<div className="flex justify-center gap-1 items-center">
								<div>Total Equity</div>
								<div className="flex cursor-pointer" onClick={() => handleSortChange('TotalEquity')}>
									{renderSortIcon('TotalEquity', sortInfo)}
								</div>
							</div>
						</TableHead>
						<TableHead className="text-center bg-background">
							<div className="flex gap-1 justify-center items-center">
								Return Rate
								<div className="flex cursor-pointer" onClick={() => handleSortChange('ReturnRate')}>
									{renderSortIcon('ReturnRate', sortInfo)}
								</div>
							</div>
						</TableHead>
						<TableHead className="text-center bg-background">
							<div className="flex gap-1 justify-center items-center">
								Max Drawdown
								<div className="flex cursor-pointer" onClick={() => handleSortChange('MaxDrawdown')}>
									{renderSortIcon('MaxDrawdown', sortInfo)}
								</div>
							</div>
						</TableHead>
						<TableHead className="text-center bg-background">
							<div className="flex justify-center gap-1 items-center">
								Sharpe Ratio
								<div className="flex cursor-pointer" onClick={() => handleSortChange('SharpeRatio')}>
									{renderSortIcon('SharpeRatio', sortInfo)}
								</div>
							</div>
						</TableHead>
						<TableHead className="text-center bg-background">
							<div className="flex justify-center gap-1 items-center">
								Trading Times
								<div className="flex cursor-pointer" onClick={() => handleSortChange('TradingTimes')}>
									{renderSortIcon('TradingTimes', sortInfo)}
								</div>
							</div>
						</TableHead>
						<TableHead className="text-center bg-background">Action</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{leaderboard.map((item) => (
						<TableRow
							key={item.id}
							className="hover:bg-muted/50 cursor-pointer"
							onClick={() =>
								navigate(`/dashboard/quant/competition/${competitionId}/strategy/${item.simulation_strategy_id}`)
							}
						>
							<TableCell className="text-center">
								<div className="flex items-center justify-center">{getRankDisplay(item.rank)}</div>
							</TableCell>
							<TableCell className="text-left">
								<div className="flex gap-1 justify-start items-center">
									<Avatar className="h-8 w-8">
										<AvatarImage src={item.user_avatar} alt={item.username} />
										<AvatarFallback className="text-xs">
											{getUserInitials(item.username)}
										</AvatarFallback>
									</Avatar>
									<Tooltip>
										<TooltipTrigger>
											<span className="font-medium text-ellipsis overflow-hidden whitespace-nowrap max-w-[100px] block">
												{item.username}
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p>{item.username}</p>
										</TooltipContent>
									</Tooltip>
								</div>
							</TableCell>
							<TableCell>
								<div className="w-[150px] break-words whitespace-normal">{item.strategy_name}</div>
							</TableCell>
							<TableCell className="text-center w-[40px]">
								<span className="font-medium">{item.simulation_strategy_id}</span>
							</TableCell>
							<TableCell className="text-center">
								<span className="font-medium">{formatCurrency(item.total_equity)}</span>
							</TableCell>
							<TableCell className="text-center">
								<span
									className={cn(
										item.return_rate >= 0 ? 'text-green-600' : 'text-red-600',
										'font-medium'
									)}
								>
									{item.return_rate ? `${formatPercentage(item.return_rate)}` : '-'}
								</span>
							</TableCell>
							<TableCell className="text-center">
								<span className="font-medium">
									{item.max_drawdown ? `${formatPercentage(item.max_drawdown)}` : '-'}
								</span>
							</TableCell>
							<TableCell className="text-center">
								<span className="font-medium">{item.sharpe_ratio ? item.sharpe_ratio : '-'}</span>
							</TableCell>
							<TableCell className="text-center">
								<span className="font-medium">{item.trading_times}</span>
							</TableCell>
							<TableCell colSpan={10} className="text-center">
								{/* <Tooltip>
									<TooltipTrigger>
										<BookCopy
											className={cn(
												'w-4 h-4 text-blue-500 cursor-pointer',
												(!canFollow(item.user_id) || item.is_follower_strategy) &&
													'text-gray-500 cursor-not-allowed'
											)}
											onClick={(e) => {
												e.stopPropagation();
												canFollow(item.user_id) &&
													!item.is_follower_strategy &&
													handleFollow(item.simulation_strategy_id);
											}}
										/>
									</TooltipTrigger>
									<TooltipContent>
										<p>Follow this strategy</p>
									</TooltipContent>
								</Tooltip> */}
								<Tooltip>
									<TooltipTrigger>
										<Eye
											className="w-4 h-4 text-indigo-500 cursor-pointer ml-2"
											onClick={() =>
												navigate(
													`/competition/${competitionId}/strategyDetail/${item.simulation_strategy_id}`
												)
											}
										/>
									</TooltipTrigger>
									<TooltipContent>
										<p>View this strategy</p>
									</TooltipContent>
								</Tooltip>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
};

export default LeaderboardUser;
